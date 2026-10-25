/* Dark Forest Finance — transaction engine.
   Pure data + calculation layer: no DOM access. Amounts are integer cents,
   dates are local "YYYY-MM-DD" strings (lexicographic order == date order). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Finance = api;
})(this, function () {
  const STORAGE_KEY = 'darkForestFinance';
  const SCHEMA_VERSION = 2; // v1: transactions only · v2: + budgets, goals, settings
  const MAX_AMOUNT = 100000000000; // $1B in cents

  const CATEGORIES = {
    income: ['Salary', 'Freelance', 'Interest', 'Gifts', 'Refunds', 'Other income'],
    expense: ['Housing', 'Groceries', 'Dining out', 'Transport', 'Utilities', 'Subscriptions',
      'Shopping', 'Health', 'Entertainment', 'Travel', 'Other'],
  };
  const ACCOUNTS = ['Checking', 'Savings', 'Visa •4021', 'Cash'];
  const GOAL_TAGS = ['HP', 'XP', 'GG', 'LV', 'MP', 'UP'];
  const FREQUENCIES = ['weekly', 'monthly', 'yearly'];
  const CURRENCIES = {
    USD: { symbol: '$', decimals: 2, label: 'USD ($)' },
    EUR: { symbol: '€', decimals: 2, label: 'EUR (€)' },
    GBP: { symbol: '£', decimals: 2, label: 'GBP (£)' },
    JPY: { symbol: '¥', decimals: 0, label: 'JPY (¥)' },
    KRW: { symbol: '₩', decimals: 0, label: 'KRW (₩)' },
    CAD: { symbol: 'CA$', decimals: 2, label: 'CAD (CA$)' },
    AUD: { symbol: 'A$', decimals: 2, label: 'AUD (A$)' },
    KZT: { symbol: '₸', decimals: 0, label: 'KZT (₸)' },
  };
  const DATE_FORMATS = ['short', 'iso', 'dmy', 'mdy'];
  const FX_STORAGE_KEY = 'darkForestFinance.fxRates';
  const FX_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
  const DEFAULT_FX_RATES = {
    base: 'USD',
    date: '2026-10-24',
    fetchedAt: '2026-10-24T00:00:00.000Z',
    source: 'reference',
    rates: {
      USD: 1,
      EUR: 0.92,
      GBP: 0.79,
      JPY: 154.80,
      KRW: 1385.00,
      CAD: 1.38,
      AUD: 1.52,
      KZT: 485.00,
    },
  };

  function defaultAccountCurrencies() {
    return Object.fromEntries(ACCOUNTS.map(a => [a, 'USD']));
  }
  function accountCurrency(account, settings) {
    const map = settings && settings.accountCurrencies;
    const code = map && typeof map === 'object' ? map[account] : null;
    return code && CURRENCIES[code] ? code : 'USD';
  }
  function txCurrency(t, settings) {
    if (t && typeof t.currency === 'string' && CURRENCIES[t.currency]) return t.currency;
    return accountCurrency(t && t.account, settings);
  }
  function validateFxSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const ratesObj = raw.rates && typeof raw.rates === 'object' && !Array.isArray(raw.rates) ? raw.rates : null;
    if (!ratesObj) return null;
    const cleanRates = { USD: 1 };
    for (const [k, v] of Object.entries(ratesObj)) {
      const n = Number(v);
      if (CURRENCIES[k] && Number.isFinite(n) && n > 0) cleanRates[k] = n;
    }
    if (Object.keys(cleanRates).length < 2) return null;
    const date = isValidDate(raw.date) ? raw.date : DEFAULT_FX_RATES.date;
    const fetchedAt = typeof raw.fetchedAt === 'string' && !Number.isNaN(Date.parse(raw.fetchedAt))
      ? raw.fetchedAt : DEFAULT_FX_RATES.fetchedAt;
    const source = ['live', 'cached', 'reference'].includes(raw.source) ? raw.source : 'cached';
    return { base: 'USD', date, fetchedAt, source, rates: cleanRates };
  }
  function isFxStale(snapshot, nowMs = Date.now()) {
    if (!snapshot || !snapshot.fetchedAt) return true;
    const ts = Date.parse(snapshot.fetchedAt);
    if (Number.isNaN(ts)) return true;
    return (nowMs - ts) > FX_STALE_MS;
  }
  function getExchangeRate(fromCurrency = 'USD', toCurrency = 'USD', fxSnapshot = DEFAULT_FX_RATES) {
    if (!CURRENCIES[fromCurrency] || !CURRENCIES[toCurrency]) return null;
    if (fromCurrency === toCurrency) return 1;
    if (!fxSnapshot || !fxSnapshot.rates || typeof fxSnapshot.rates !== 'object') return null;
    const rFrom = Number(fxSnapshot.rates[fromCurrency]);
    const rTo = Number(fxSnapshot.rates[toCurrency]);
    if (!Number.isFinite(rFrom) || rFrom <= 0 || !Number.isFinite(rTo) || rTo <= 0) return null;
    return rTo / rFrom;
  }
  // Converts an integer centi-unit amount from `fromCurrency` to `toCurrency`.
  // Never converts twice when fromCurrency === toCurrency, and rounds to target currency decimals.
  function convertAmount(cents, fromCurrency = 'USD', toCurrency = 'USD', fxSnapshot = DEFAULT_FX_RATES) {
    if (!Number.isFinite(cents)) return NaN;
    if (fromCurrency === toCurrency) return Math.round(cents);
    const rate = getExchangeRate(fromCurrency, toCurrency, fxSnapshot);
    if (rate === null) return null;
    const raw = cents * rate;
    const cfg = CURRENCIES[toCurrency] || CURRENCIES.USD;
    if (cfg.decimals === 0) {
      return Math.round(raw / 100) * 100;
    }
    return Math.round(raw);
  }
  function saveFxRates(storage, snapshot) {
    if (!storage) return false;
    const valid = validateFxSnapshot(snapshot);
    if (!valid) return false;
    try {
      storage.setItem(FX_STORAGE_KEY, JSON.stringify(valid));
      return true;
    } catch (e) {
      return false;
    }
  }
  function loadFxRates(storage, nowMs = Date.now()) {
    if (storage) {
      try {
        const raw = storage.getItem(FX_STORAGE_KEY);
        if (raw) {
          const v = validateFxSnapshot(JSON.parse(raw));
          if (v) {
            const stale = isFxStale(v, nowMs);
            return { ...v, stale, status: stale ? 'stale' : v.source };
          }
        }
      } catch (e) { /* fall through to reference rates */ }
    }
    return { ...DEFAULT_FX_RATES, stale: true, status: 'reference' };
  }
  async function fetchExchangeRates(fetchImpl, storage = null, nowMs = Date.now()) {
    const fn = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fn) {
      const fallback = loadFxRates(storage, nowMs);
      return { ok: false, status: fallback.status, error: 'Network fetch unavailable.', fx: fallback, snapshot: fallback };
    }
    try {
      const res = await fn('https://open.er-api.com/v6/latest/USD');
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'error'}`);
      const data = await res.json();
      const rawRates = data && data.rates;
      let dateStr = todayISO(new Date(nowMs));
      if (data && typeof data.time_last_update_utc === 'string') {
        const dt = new Date(data.time_last_update_utc);
        if (!Number.isNaN(dt.getTime())) dateStr = dt.toISOString().slice(0, 10);
      } else if (data && isValidDate(data.date)) {
        dateStr = data.date;
      }
      const snap = validateFxSnapshot({
        base: 'USD',
        date: dateStr,
        fetchedAt: new Date(nowMs).toISOString(),
        source: 'live',
        rates: rawRates,
      });
      if (!snap) throw new Error('Invalid exchange rate payload.');
      saveFxRates(storage, snap);
      const liveSnap = { ...snap, stale: false, status: 'live' };
      return { ok: true, status: 'live', error: null, fx: liveSnap, snapshot: liveSnap };
    } catch (err) {
      const fallback = loadFxRates(storage, nowMs);
      return {
        ok: false,
        status: fallback.status,
        error: (err && err.message) || 'Exchange rate service unavailable.',
        fx: fallback,
        snapshot: fallback,
      };
    }
  }

  // Starting values for new users and for v1 → v2 upgrades (same as the old hard-coded ones).
  function defaultBudgets() {
    return [['Groceries', 60000], ['Dining out', 25000], ['Transport', 25000], ['Shopping', 40000], ['Entertainment', 15000]]
      .map(([category, limit]) => ({ id: createId(), category, limit }));
  }
  function defaultGoals(today = todayISO()) {
    return [['Emergency fund', 1800000, 1420000, 'HP'], ['Tokyo trip', 600000, 315000, 'XP'], ['New laptop', 240000, 228000, 'GG'], ['Home deposit', 6000000, 980000, 'LV']]
      .map(([name, target, saved, tag]) => ({ id: createId(), name, target, saved, deadline: '', tag, createdAt: today }));
  }
  const defaultSettings = () => ({ monthlyBudget: 420000 });

  function allCategories(type, settings) {
    if (type !== 'income' && type !== 'expense') return [];
    const base = CATEGORIES[type] || [];
    const custom = settings && settings.customCategories && Array.isArray(settings.customCategories[type])
      ? settings.customCategories[type].filter(c => typeof c === 'string' && c.trim() && !base.includes(c.trim()))
      : [];
    return [...base, ...custom];
  }

  function validateCategoryName(rawName, type, settings) {
    if (type !== 'income' && type !== 'expense') return { ok: false, error: 'Choose income or expense.' };
    const name = String(rawName ?? '').trim();
    if (!name) return { ok: false, error: 'Enter a category name.' };
    if (name.length > 30) return { ok: false, error: 'Keep the category name under 30 characters.' };
    const all = [...allCategories('income', settings), ...allCategories('expense', settings)];
    if (all.some(c => c.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: `"${name}" already exists.` };
    }
    return { ok: true, value: name };
  }

  function formatCurrency(cents, currency = 'USD', decimalsOverride) {
    const cfg = CURRENCIES[currency] || CURRENCIES.USD;
    const d = decimalsOverride !== undefined ? decimalsOverride : cfg.decimals;
    const n = Number.isFinite(cents) ? cents : 0;
    return (n < 0 ? '−' : '') + cfg.symbol + (Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function formatDate(iso, format = 'short', today = todayISO()) {
    if (!isValidDate(iso)) return String(iso ?? '');
    if (format === 'iso') return iso;
    const [y, m, d] = iso.split('-');
    if (format === 'dmy') return `${d}/${m}/${y}`;
    if (format === 'mdy') return `${m}/${d}/${y}`;
    return new Date(iso + 'T00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: y === String(today).slice(0, 4) ? undefined : 'numeric',
    });
  }

  /* ---------- money & dates ---------- */
  function toCents(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN;
    const s = String(v ?? '').trim().replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }
  const pad = n => String(n).padStart(2, '0');
  function todayISO(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return y >= 1900 && y <= 2100 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  // First day of the month `offset` months from the month containing iso.
  function monthStart(iso, offset = 0) {
    const [y, m] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + offset, 1));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-01`;
  }
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  const monthEnd = iso => addDays(monthStart(iso, 1), -1);

  // A period of n months = the current calendar month plus the n-1 before it, up to today.
  function periodRange(months, today) {
    return { start: monthStart(today, -(months - 1)), end: today };
  }
  function previousRange(months, today) {
    const start = monthStart(today, -(2 * months - 1));
    return { start, end: addDays(monthStart(today, -(months - 1)), -1) };
  }

  /* ---------- validation ---------- */
  function validate(input, settings) {
    const errors = {};
    const type = input && input.type;
    if (type !== 'income' && type !== 'expense') errors.type = 'Choose income or expense.';
    const amount = toCents(input && input.amount);
    if (String((input && input.amount) ?? '').trim() === '') errors.amount = 'Enter an amount.';
    else if (/^\s*-/.test(String(input.amount))) errors.amount = 'Amount must be greater than zero. Choose Expense to record money going out.';
    else if (!Number.isFinite(amount)) errors.amount = 'Use a number with up to 2 decimals, e.g. 42.50.';
    else if (amount <= 0) errors.amount = 'Amount must be greater than zero.';
    else if (amount > MAX_AMOUNT) errors.amount = 'Amount is too large.';
    const description = String((input && input.description) ?? '').trim();
    if (!description) errors.description = 'Enter a description or merchant.';
    else if (description.length > 80) errors.description = 'Keep it under 80 characters.';
    const category = input && input.category;
    const validCats = !errors.type ? allCategories(type, settings) : [];
    if (!errors.type && !validCats.includes(category)) errors.category = 'Pick a category.';
    if (!isValidDate(input && input.date)) errors.date = 'Enter a valid date between 1900 and 2100.';
    const account = (input && input.account) || ACCOUNTS[0];
    if (!ACCOUNTS.includes(account)) errors.account = 'Pick an account.';
    const note = String((input && input.note) ?? '').trim();
    if (note.length > 140) errors.note = 'Keep the note under 140 characters.';
    const currency = input && typeof input.currency === 'string' && input.currency.trim() ? input.currency.trim() : null;
    if (currency && !CURRENCIES[currency]) errors.currency = 'Unsupported currency.';
    const ok = Object.keys(errors).length === 0;
    if (!ok) return { ok, errors, value: null };
    const val = { type, amount, description, category, date: input.date, account, note };
    if (currency) val.currency = currency;
    return { ok, errors, value: val };
  }

  function createId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'tx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Coerce a stored record into a valid transaction, or null if it can't be trusted.
  function normalize(raw, settings) {
    if (!raw || typeof raw !== 'object') return null;
    const amount = Number.isInteger(raw.amount) ? raw.amount / 100 : NaN;
    const r = validate({ ...raw, amount: Number.isFinite(amount) ? amount.toFixed(2) : '' }, settings);
    if (!r.ok) return null;
    const out = { id: typeof raw.id === 'string' && raw.id ? raw.id : createId(), ...r.value };
    if (typeof raw.recurringId === 'string' && raw.recurringId) {
      out.recurringId = raw.recurringId;
      if (isValidDate(raw.occurrenceDate)) out.occurrenceDate = raw.occurrenceDate;
    }
    if (Number.isInteger(raw.originalAmount) && raw.originalAmount > 0 && raw.originalAmount <= MAX_AMOUNT &&
        typeof raw.originalCurrency === 'string' && CURRENCIES[raw.originalCurrency]) {
      out.originalAmount = raw.originalAmount;
      out.originalCurrency = raw.originalCurrency;
    }
    return out;
  }

  function parseAmount(v, { allowZero = false, emptyMsg = 'Enter an amount.' } = {}) {
    const s = String(v ?? '').trim();
    if (!s) return { error: emptyMsg };
    if (s.startsWith('-')) return { error: allowZero ? 'Amount can’t be negative.' : 'Amount must be greater than zero.' };
    const c = toCents(s);
    if (!Number.isFinite(c)) return { error: 'Use a number with up to 2 decimals, e.g. 42.50.' };
    if (c === 0 && !allowZero) return { error: 'Amount must be greater than zero.' };
    if (c > MAX_AMOUNT) return { error: 'Amount is too large.' };
    return { cents: c };
  }
  const centsToInput = c => (Number.isInteger(c) ? (c / 100).toFixed(2) : '');

  // One budget per expense category; editingId lets a budget keep its own category.
  function validateBudget(input, budgets = [], editingId = null, settings) {
    const errors = {};
    const category = input && input.category;
    const validExp = allCategories('expense', settings);
    if (!validExp.includes(category)) errors.category = 'Pick an expense category.';
    else if (budgets.some(b => b.category === category && b.id !== editingId)) errors.category = `${category} already has a budget. Edit that one instead.`;
    const limit = parseAmount(input && input.limit, { emptyMsg: 'Enter a monthly limit.' });
    if (limit.error) errors.limit = limit.error;
    const ok = Object.keys(errors).length === 0;
    return { ok, errors, value: ok ? { category, limit: limit.cents } : null };
  }

  function validateGoal(input) {
    const errors = {};
    const name = String(input.name ?? '').trim();
    if (!name) errors.name = 'Give the goal a name.';
    else if (name.length > 40) errors.name = 'Keep it under 40 characters.';
    const target = parseAmount(input.target, { emptyMsg: 'Enter a target amount.' });
    if (target.error) errors.target = target.error;
    const savedRaw = String(input.saved ?? '').trim();
    const saved = savedRaw ? parseAmount(savedRaw, { allowZero: true }) : { cents: 0 };
    if (saved.error) errors.saved = saved.error;
    const deadline = String(input.deadline ?? '').trim();
    if (deadline && !isValidDate(deadline)) errors.deadline = 'Enter a valid date, or leave it empty.';
    const tag = GOAL_TAGS.includes(input.tag) ? input.tag : GOAL_TAGS[0];
    const ok = Object.keys(errors).length === 0;
    return { ok, errors, value: ok ? { name, target: target.cents, saved: saved.cents, deadline, tag } : null };
  }

  function validateRecurring(input, settings) {
    const errors = {};
    const type = input && input.type;
    if (type !== 'income' && type !== 'expense') errors.type = 'Choose income or expense.';
    const amt = parseAmount(input && input.amount, { emptyMsg: 'Enter an amount.' });
    if (amt.error) errors.amount = amt.error;
    const description = String((input && input.description) ?? '').trim();
    if (!description) errors.description = 'Enter a description or merchant.';
    else if (description.length > 80) errors.description = 'Keep it under 80 characters.';
    const category = input && input.category;
    const validCats = !errors.type ? allCategories(type, settings) : [];
    if (!errors.type && !validCats.includes(category)) errors.category = 'Pick a category.';
    const account = (input && input.account) || ACCOUNTS[0];
    if (!ACCOUNTS.includes(account)) errors.account = 'Pick an account.';
    const frequency = input && input.frequency;
    if (!FREQUENCIES.includes(frequency)) errors.frequency = 'Choose weekly, monthly, or yearly.';
    const startDate = String((input && input.startDate) ?? '').trim();
    if (!isValidDate(startDate)) errors.startDate = 'Enter a valid start date between 1900 and 2100.';
    const endDate = String((input && input.endDate) ?? '').trim();
    if (endDate) {
      if (!isValidDate(endDate)) errors.endDate = 'Enter a valid end date, or leave it empty.';
      else if (isValidDate(startDate) && endDate < startDate) errors.endDate = 'End date must be on or after the start date.';
    }
    const note = String((input && input.note) ?? '').trim();
    if (note.length > 140) errors.note = 'Keep the note under 140 characters.';
    const paused = Boolean(input && input.paused);
    const ok = Object.keys(errors).length === 0;
    return {
      ok,
      errors,
      value: ok ? { type, amount: amt.cents, description, category, account, frequency, startDate, endDate, paused, note } : null,
    };
  }

  const idOf = raw => (typeof raw.id === 'string' && raw.id ? raw.id : createId());
  function normalizeBudget(raw, settings) {
    if (!raw || typeof raw !== 'object') return null;
    const r = validateBudget({ ...raw, limit: centsToInput(raw.limit) }, [], null, settings);
    return r.ok ? { id: idOf(raw), ...r.value } : null;
  }
  function normalizeGoal(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const r = validateGoal({ ...raw, target: centsToInput(raw.target), saved: centsToInput(raw.saved) || (raw.saved === undefined ? '' : 'x') });
    return r.ok ? { id: idOf(raw), ...r.value, createdAt: isValidDate(raw.createdAt) ? raw.createdAt : '' } : null;
  }
  function normalizeContribution(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const goalId = typeof raw.goalId === 'string' ? raw.goalId.trim() : '';
    const goalName = typeof raw.goalName === 'string' ? raw.goalName.trim().slice(0, 40) : 'Goal';
    const type = raw.type;
    if (!goalId || (type !== 'deposit' && type !== 'withdraw')) return null;
    if (!Number.isInteger(raw.amount) || raw.amount <= 0 || raw.amount > MAX_AMOUNT) return null;
    const date = isValidDate(raw.date) ? raw.date : '';
    if (!date) return null;
    return { id: idOf(raw), goalId, goalName: goalName || 'Goal', type, amount: raw.amount, date };
  }
  function normalizeRecurring(raw, settings) {
    if (!raw || typeof raw !== 'object') return null;
    const r = validateRecurring({ ...raw, amount: centsToInput(raw.amount) }, settings);
    if (!r.ok) return null;
    return {
      id: idOf(raw),
      ...r.value,
      lastGeneratedDate: isValidDate(raw.lastGeneratedDate) ? raw.lastGeneratedDate : '',
    };
  }
  function normalizeSettings(raw) {
    const base = defaultSettings();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const mb = Number.isInteger(raw.monthlyBudget) && raw.monthlyBudget > 0 && raw.monthlyBudget <= MAX_AMOUNT
      ? raw.monthlyBudget : base.monthlyBudget;
    const out = { ...base, monthlyBudget: mb };
    if (typeof raw.currency === 'string' && CURRENCIES[raw.currency]) out.currency = raw.currency;
    if (typeof raw.dateFormat === 'string' && DATE_FORMATS.includes(raw.dateFormat)) out.dateFormat = raw.dateFormat;
    if (raw.customCategories && typeof raw.customCategories === 'object' && !Array.isArray(raw.customCategories)) {
      const cleanCustom = type => Array.isArray(raw.customCategories[type])
        ? [...new Set(raw.customCategories[type].filter(s => typeof s === 'string' && s.trim() && s.trim().length <= 30 && !CATEGORIES[type].includes(s.trim())).map(s => s.trim()))]
        : [];
      const inc = cleanCustom('income'), exp = cleanCustom('expense');
      if (inc.length || exp.length) out.customCategories = { income: inc, expense: exp };
    }
    if (Array.isArray(raw.recentCategories)) {
      const rec = [...new Set(raw.recentCategories.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()))].slice(0, 8);
      if (rec.length) out.recentCategories = rec;
    }
    if (raw.accountCurrencies && typeof raw.accountCurrencies === 'object' && !Array.isArray(raw.accountCurrencies)) {
      const ac = {};
      for (const a of ACCOUNTS) {
        const c = raw.accountCurrencies[a];
        if (typeof c === 'string' && CURRENCIES[c]) ac[a] = c;
      }
      if (Object.keys(ac).length) out.accountCurrencies = { ...defaultAccountCurrencies(), ...ac };
    }
    return out;
  }

  /* ---------- recurring schedule date arithmetic & materialization ---------- */
  // Computes the k-th occurrence date anchored to startDate without month-end drift (e.g., Jan 31 -> Feb 28/29 -> Mar 31).
  function occurrenceDate(startDate, frequency, stepIndex = 0) {
    if (!isValidDate(startDate) || stepIndex <= 0) return startDate;
    if (frequency === 'weekly') return addDays(startDate, stepIndex * 7);
    const [y, m, d] = startDate.split('-').map(Number);
    if (frequency === 'monthly') {
      const dt = new Date(Date.UTC(y, m - 1 + stepIndex, 1));
      const ym = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
      const maxDay = Number(monthEnd(`${ym}-01`).slice(8));
      return `${ym}-${pad(Math.min(d, maxDay))}`;
    }
    if (frequency === 'yearly') {
      const targetYear = y + stepIndex;
      const ym = `${targetYear}-${pad(m)}`;
      const maxDay = Number(monthEnd(`${ym}-01`).slice(8));
      return `${ym}-${pad(Math.min(d, maxDay))}`;
    }
    return startDate;
  }

  // Materializes due occurrences up to `today` idempotently. Never duplicates occurrences across refreshes.
  function materializeRecurring(txs = [], recurringList = [], today = todayISO()) {
    if (!Array.isArray(txs) || !Array.isArray(recurringList) || !isValidDate(today)) {
      return { transactions: Array.isArray(txs) ? txs : [], recurring: Array.isArray(recurringList) ? recurringList : [], added: [] };
    }
    const existingKeys = new Set();
    for (const t of txs) {
      if (t && t.recurringId) {
        const occ = t.occurrenceDate || t.date;
        if (occ) existingKeys.add(`${t.recurringId}:${occ}`);
      }
    }
    const added = [];
    const updatedRecurring = recurringList.map(rule => {
      if (!rule || rule.paused || !isValidDate(rule.startDate) || !FREQUENCIES.includes(rule.frequency)) return rule;
      let lastGen = isValidDate(rule.lastGeneratedDate) ? rule.lastGeneratedDate : '';
      for (let k = 0; k < 1000; k++) {
        const d = occurrenceDate(rule.startDate, rule.frequency, k);
        if (d > today) break;
        if (rule.endDate && isValidDate(rule.endDate) && d > rule.endDate) break;
        const key = `${rule.id}:${d}`;
        if ((lastGen && d <= lastGen) || existingKeys.has(key)) {
          if (d > lastGen) lastGen = d;
          continue;
        }
        const newTx = {
          id: createId(),
          type: rule.type,
          amount: rule.amount,
          description: rule.description,
          category: rule.category,
          date: d,
          account: rule.account || ACCOUNTS[0],
          note: rule.note || `Recurring (${rule.frequency})`,
          recurringId: rule.id,
          occurrenceDate: d,
        };
        added.push(newTx);
        existingKeys.add(key);
        if (d > lastGen) lastGen = d;
      }
      return lastGen !== (rule.lastGeneratedDate || '') ? { ...rule, lastGeneratedDate: lastGen } : rule;
    });
    return { transactions: added.length ? [...txs, ...added] : txs, recurring: updatedRecurring, added };
  }

  function nextOccurrence(rule, today = todayISO()) {
    if (!rule || !isValidDate(rule.startDate) || !FREQUENCIES.includes(rule.frequency)) return null;
    const lastGen = isValidDate(rule.lastGeneratedDate) ? rule.lastGeneratedDate : '';
    for (let k = 0; k < 1000; k++) {
      const d = occurrenceDate(rule.startDate, rule.frequency, k);
      if (rule.endDate && isValidDate(rule.endDate) && d > rule.endDate) return null;
      if (d > today || (d === today && lastGen < today && rule.paused)) return d;
    }
    return null;
  }

  function upcomingOccurrences(recurringList = [], today = todayISO(), horizonDays = 90, maxPerRule = 6) {
    if (!Array.isArray(recurringList) || !isValidDate(today)) return [];
    const limitDate = addDays(today, horizonDays);
    const out = [];
    for (const rule of recurringList) {
      if (!rule || rule.paused || !isValidDate(rule.startDate) || !FREQUENCIES.includes(rule.frequency)) continue;
      let count = 0;
      for (let k = 0; k < 1000 && count < maxPerRule; k++) {
        const d = occurrenceDate(rule.startDate, rule.frequency, k);
        if (d <= today) continue;
        if (d > limitDate) break;
        if (rule.endDate && isValidDate(rule.endDate) && d > rule.endDate) break;
        out.push({
          recurringId: rule.id,
          type: rule.type,
          amount: rule.amount,
          description: rule.description,
          category: rule.category,
          account: rule.account || ACCOUNTS[0],
          frequency: rule.frequency,
          date: d,
          note: rule.note || '',
        });
        count++;
      }
    }
    return out.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  }

  /* ---------- storage ---------- */
  // Normalises a list, dropping invalid records and fixing duplicate ids. `unique` drops later duplicates by key.
  function cleanList(list, fn, unique) {
    if (!Array.isArray(list)) return { out: [], dropped: 0 };
    const ids = new Set(), keys = new Set(), out = [];
    for (const raw of list) {
      const x = fn(raw);
      if (!x || (unique && keys.has(x[unique]))) continue;
      if (ids.has(x.id)) x.id = createId();
      ids.add(x.id); if (unique) keys.add(x[unique]);
      out.push(x);
    }
    return { out, dropped: list.length - out.length };
  }

  function migrate(parsed, today = todayISO()) {
    let list, budgets = null, goals = null, contributions = null, recurring = null, rawSettings = null, upgraded = false;
    if (Array.isArray(parsed)) { list = parsed; upgraded = true; } // pre-versioned format: bare array
    else if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.version)) {
      if (parsed.version < 1 || parsed.version > SCHEMA_VERSION) return null; // invalid or newer app version
      if (!Array.isArray(parsed.transactions)) return null;
      list = parsed.transactions;
      if (parsed.version < 2) upgraded = true; // v1 → v2: add budgets, goals, settings
      else {
        budgets = Array.isArray(parsed.budgets) ? parsed.budgets : null;
        goals = Array.isArray(parsed.goals) ? parsed.goals : null;
        contributions = Array.isArray(parsed.contributions) ? parsed.contributions : null;
        recurring = Array.isArray(parsed.recurring) ? parsed.recurring : null;
        rawSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : null;
      }
    } else return null;
    const normSettings = normalizeSettings(rawSettings);
    const t = cleanList(list, x => normalize(x, normSettings));
    const b = budgets ? cleanList(budgets, x => normalizeBudget(x, normSettings), 'category') : { out: defaultBudgets(), dropped: 0 };
    const g = goals ? cleanList(goals, normalizeGoal) : { out: upgraded ? defaultGoals(today) : [], dropped: 0 };
    const c = contributions ? cleanList(contributions, normalizeContribution) : { out: [], dropped: 0 };
    const r = recurring ? cleanList(recurring, x => normalizeRecurring(x, normSettings)) : { out: [], dropped: 0 };
    const mat = materializeRecurring(t.out, r.out, today);
    return {
      transactions: mat.transactions, budgets: b.out, goals: g.out, contributions: c.out, recurring: mat.recurring, settings: normSettings,
      dropped: t.dropped + b.dropped + g.dropped + c.dropped + r.dropped, upgraded,
    };
  }

  let backupSeq = 0;
  function backup(storage, raw) {
    try { storage.setItem(`${STORAGE_KEY}.backup.${Date.now()}_${++backupSeq}`, raw); } catch (e) { /* storage full or blocked */ }
  }

  // status: seeded | ok | upgraded | partial | corrupt | incompatible | unavailable
  function load(storage, seedFn, today = todayISO()) {
    const fresh = () => ({ transactions: seedFn(), budgets: defaultBudgets(), goals: defaultGoals(today), contributions: [], recurring: [], settings: defaultSettings() });
    const empty = () => ({ transactions: [], budgets: defaultBudgets(), goals: [], contributions: [], recurring: [], settings: defaultSettings() });
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); } catch (e) { return { ...fresh(), status: 'unavailable', dropped: 0 }; }
    if (raw === null) {
      const data = fresh();
      save(storage, data);
      return { ...data, status: 'seeded', dropped: 0 };
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { backup(storage, raw); return { ...empty(), status: 'corrupt', dropped: 0 }; }
    const m = migrate(parsed, today);
    if (!m) { backup(storage, raw); return { ...empty(), status: 'incompatible', dropped: 0 }; }
    if (m.dropped || m.upgraded) backup(storage, raw);
    const { upgraded, ...data } = m;
    if (upgraded) save(storage, data);
    return { ...data, status: m.dropped ? 'partial' : upgraded ? 'upgraded' : 'ok' };
  }

  function save(storage, { transactions = [], budgets = [], goals = [], contributions = [], recurring = [], settings = defaultSettings() }) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, savedAt: new Date().toISOString(), transactions, budgets, goals, contributions, recurring, settings }));
      return true;
    } catch (e) { return false; }
  }

  /* ---------- calculations (single source of truth) ---------- */
  const isValidTx = t => Boolean(
    t && typeof t === 'object' &&
    (t.type === 'income' || t.type === 'expense') &&
    Number.isInteger(t.amount) && t.amount > 0 && t.amount <= MAX_AMOUNT &&
    typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
  );
  const signed = t => (!isValidTx(t) ? 0 : t.type === 'income' ? t.amount : -t.amount);
  const inRange = (t, r) => Boolean(r && isValidTx(t) && t.date >= r.start && t.date <= r.end);

  // Resolves a transaction's amount in the active reporting currency.
  // When no currency conversion is active (from === rep), returns t.amount directly (never converts twice).
  function resolveTxAmount(t, opts) {
    if (!isValidTx(t)) return 0;
    if (!opts && (!t.currency || t.currency === 'USD')) return t.amount;
    const settings = (opts && opts.settings) || null;
    const rep = (opts && opts.reportingCurrency) || (settings && settings.currency) || 'USD';
    const fx = (opts && opts.fx) || DEFAULT_FX_RATES;
    const from = txCurrency(t, settings);
    if (from === rep) return t.amount;
    const conv = convertAmount(t.amount, from, rep, fx);
    return conv === null ? NaN : conv;
  }
  function signedInReporting(t, opts) {
    if (!isValidTx(t)) return 0;
    const amt = resolveTxAmount(t, opts);
    if (!Number.isFinite(amt)) return 0;
    return t.type === 'income' ? amt : -amt;
  }

  function summarize(txs, range, opts) {
    let income = 0, expense = 0;
    if (Array.isArray(txs)) {
      for (const t of txs) {
        if (inRange(t, range)) {
          const amt = resolveTxAmount(t, opts);
          if (!Number.isFinite(amt)) continue;
          if (t.type === 'income') income += amt;
          else if (t.type === 'expense') expense += amt;
        }
      }
    }
    const net = income - expense;
    return { income, expense, net, savingsRate: income > 0 ? (net / income) * 100 : null };
  }
  // Net balance of recorded transactions up to and including `asOf` (no opening balances).
  function netBalance(txs, asOf, opts) {
    let s = 0;
    if (!Array.isArray(txs)) return 0;
    for (const t of txs) if (isValidTx(t) && t.date <= asOf) s += signedInReporting(t, opts);
    return s;
  }
  function balanceByAccount(txs, asOf, opts) {
    const out = Object.fromEntries(ACCOUNTS.map(a => [a, 0]));
    if (!Array.isArray(txs)) return out;
    for (const t of txs) if (isValidTx(t) && t.date <= asOf) out[t.account] = (out[t.account] || 0) + signedInReporting(t, opts);
    return out;
  }
  // Returns each account's balance in its own native currency (converting any cross-currency txs in that account to the account's currency).
  function balanceByAccountNative(txs, asOf, settings, fxSnapshot = DEFAULT_FX_RATES) {
    const out = {};
    for (const a of ACCOUNTS) {
      out[a] = { amount: 0, balance: 0, currency: accountCurrency(a, settings) };
    }
    if (!Array.isArray(txs)) return out;
    for (const t of txs) {
      if (!isValidTx(t) || t.date > asOf) continue;
      const acct = ACCOUNTS.includes(t.account) ? t.account : ACCOUNTS[0];
      const acctCurr = out[acct].currency;
      const fromCurr = txCurrency(t, settings);
      const conv = fromCurr === acctCurr ? t.amount : convertAmount(t.amount, fromCurr, acctCurr, fxSnapshot);
      if (conv !== null && Number.isFinite(conv)) {
        const delta = t.type === 'income' ? conv : -conv;
        out[acct].amount += delta;
        out[acct].balance += delta;
      }
    }
    return out;
  }
  // Preview changing an account's denomination currency without mutating any records.
  function previewAccountCurrencyChange(txs, settings, account, toCurrency, fxSnapshot = DEFAULT_FX_RATES, asOf = todayISO()) {
    if (!ACCOUNTS.includes(account)) return { ok: false, error: 'Invalid account.' };
    if (!CURRENCIES[toCurrency]) return { ok: false, error: 'Unsupported target currency.' };
    const fromCurrency = accountCurrency(account, settings);
    const rate = getExchangeRate(fromCurrency, toCurrency, fxSnapshot);
    if (rate === null) {
      return { ok: false, error: `Exchange rate from ${fromCurrency} to ${toCurrency} is unavailable.` };
    }
    const acctTxs = Array.isArray(txs) ? txs.filter(t => isValidTx(t) && t.account === account) : [];
    let oldBalance = 0, newBalance = 0;
    for (const t of acctTxs) {
      if (t.date > asOf) continue;
      const tCurr = txCurrency(t, settings);
      const oldAmt = tCurr === fromCurrency ? t.amount : convertAmount(t.amount, tCurr, fromCurrency, fxSnapshot);
      const origAmt = Number.isInteger(t.originalAmount) && t.originalAmount > 0 ? t.originalAmount : t.amount;
      const origCurr = (t.originalCurrency && CURRENCIES[t.originalCurrency]) ? t.originalCurrency : tCurr;
      const newAmt = origCurr === toCurrency ? origAmt : convertAmount(origAmt, origCurr, toCurrency, fxSnapshot);
      if (oldAmt === null || newAmt === null) {
        return { ok: false, error: `Exchange rate unavailable for transaction in ${origCurr}.` };
      }
      oldBalance += t.type === 'income' ? oldAmt : -oldAmt;
      newBalance += t.type === 'income' ? newAmt : -newAmt;
    }
    const rDate = (fxSnapshot && fxSnapshot.date) || DEFAULT_FX_RATES.date;
    const rSrc = (fxSnapshot && fxSnapshot.source) || 'reference';
    return {
      ok: true,
      account,
      fromCurrency,
      toCurrency,
      rate,
      rateDate: rDate,
      rateSource: rSrc,
      fxDate: rDate,
      fxSource: rSrc,
      txCount: acctTxs.length,
      oldBalance,
      newBalance,
    };
  }
  // Applies an account denomination change: converts existing transactions in that account from their preserved originalAmount/originalCurrency (never converting twice) and updates settings.accountCurrencies.
  function convertAccountCurrency(txs, settings, account, toCurrency, fxSnapshot = DEFAULT_FX_RATES) {
    const prev = previewAccountCurrencyChange(txs, settings, account, toCurrency, fxSnapshot);
    if (!prev.ok) return prev;
    const fromCurrency = prev.fromCurrency;
    if (fromCurrency === toCurrency) {
      return {
        ok: true,
        unchanged: true,
        fromCurrency,
        toCurrency,
        rate: prev.rate,
        transactions: Array.isArray(txs) ? [...txs] : [],
        settings: { ...settings },
        preview: prev,
      };
    }
    const nextTxs = (Array.isArray(txs) ? txs : []).map(t => {
      if (!isValidTx(t) || t.account !== account) return t;
      const origAmt = Number.isInteger(t.originalAmount) && t.originalAmount > 0 ? t.originalAmount : t.amount;
      const origCurr = (t.originalCurrency && CURRENCIES[t.originalCurrency]) ? t.originalCurrency : txCurrency(t, settings);
      const converted = origCurr === toCurrency ? origAmt : convertAmount(origAmt, origCurr, toCurrency, fxSnapshot);
      if (converted === null || !Number.isFinite(converted) || converted <= 0) return t;
      return {
        ...t,
        amount: Math.min(MAX_AMOUNT, Math.max(1, converted)),
        currency: toCurrency,
        originalAmount: origAmt,
        originalCurrency: origCurr,
      };
    });
    const nextAcctMap = { ...defaultAccountCurrencies(), ...((settings && settings.accountCurrencies) || {}), [account]: toCurrency };
    const nextSettings = { ...(settings || defaultSettings()), accountCurrencies: nextAcctMap };
    return {
      ok: true,
      unchanged: false,
      fromCurrency,
      toCurrency,
      rate: prev.rate,
      transactions: nextTxs,
      settings: nextSettings,
      preview: prev,
    };
  }

  function byCategory(txs, range, type = 'expense', opts) {
    const m = {};
    if (!Array.isArray(txs)) return [];
    for (const t of txs) {
      if (t && t.type === type && inRange(t, range)) {
        const amt = resolveTxAmount(t, opts);
        if (Number.isFinite(amt)) m[t.category] = (m[t.category] || 0) + amt;
      }
    }
    return Object.entries(m).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }
  function monthlySeries(txs, today, months, opts) {
    return Array.from({ length: months }, (_, i) => {
      const start = monthStart(today, i - months + 1);
      const end = i === months - 1 ? today : monthEnd(start);
      return { month: start.slice(0, 7), ...summarize(txs, { start, end }, opts) };
    });
  }
  function balanceHistory(txs, today, months, opts) {
    return Array.from({ length: months }, (_, i) => {
      const start = monthStart(today, i - months + 1);
      return netBalance(txs, i === months - 1 ? today : monthEnd(start), opts);
    });
  }
  // Consecutive completed months (most recent first) with savings rate >= target.
  function savingStreak(txs, today, target = 30, opts) {
    let n = 0;
    for (let i = 1; i <= 120; i++) {
      const start = monthStart(today, -i);
      const s = summarize(txs, { start, end: monthEnd(start) }, opts);
      if (s.savingsRate === null || s.savingsRate < target) break;
      n++;
    }
    return n;
  }
  // This month's spending per budgeted category, ordered like the category list.
  function budgetStatus(txs, budgets = [], today = todayISO(), opts) {
    if (!Array.isArray(budgets)) return [];
    const spentBy = Object.fromEntries(byCategory(txs, { start: monthStart(today), end: today }, 'expense', opts).map(c => [c.category, c.amount]));
    const settings = (opts && opts.settings) || null;
    const rep = (opts && opts.reportingCurrency) || (settings && settings.currency) || 'USD';
    const fx = (opts && opts.fx) || DEFAULT_FX_RATES;
    return budgets.filter(b => b && typeof b === 'object' && Number.isFinite(b.limit) && b.limit > 0).map(b => {
      const bCurr = (b.currency && CURRENCIES[b.currency]) ? b.currency : 'USD';
      const limitConv = bCurr === rep ? b.limit : convertAmount(b.limit, bCurr, rep, fx);
      const limit = (limitConv !== null && Number.isFinite(limitConv) && limitConv > 0) ? limitConv : b.limit;
      const spent = spentBy[b.category] || 0;
      const remaining = limit - spent;
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      const over = spent > limit;
      const warning = !over && pct >= 80;
      const status = over ? 'danger' : warning ? 'warning' : 'ok';
      return { ...b, limit, baseLimit: b.limit, spent, remaining, pct, over, warning, status };
    }).sort((a, b) => {
      const ia = CATEGORIES.expense.indexOf(a.category), ib = CATEGORIES.expense.indexOf(b.category);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }
  function monthlyBudgetStatus(txs, settings = defaultSettings(), today = todayISO(), fxSnapshot = DEFAULT_FX_RATES) {
    const rep = (settings && settings.currency) || 'USD';
    const opts = { reportingCurrency: rep, fx: fxSnapshot, settings };
    const spent = summarize(txs, { start: monthStart(today), end: today }, opts).expense;
    const baseLimit = settings && Number.isFinite(settings.monthlyBudget) && settings.monthlyBudget > 0 ? settings.monthlyBudget : defaultSettings().monthlyBudget;
    const convLimit = rep === 'USD' ? baseLimit : convertAmount(baseLimit, 'USD', rep, fxSnapshot);
    const limit = (convLimit !== null && Number.isFinite(convLimit) && convLimit > 0) ? convLimit : baseLimit;
    const remaining = limit - spent;
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    const over = spent > limit;
    const warning = !over && pct >= 80;
    const status = over ? 'danger' : warning ? 'warning' : 'ok';
    return { spent, limit, baseLimit, remaining, pct, over, warning, status };
  }
  // monthsLeft counts calendar months from the current one through the deadline month, inclusive.
  function goalProgress(goal, today = todayISO()) {
    const target = goal && Number.isFinite(goal.target) && goal.target > 0 ? goal.target : 0;
    const saved = goal && Number.isFinite(goal.saved) && goal.saved >= 0 ? goal.saved : 0;
    const remaining = Math.max(0, target - saved), done = saved >= target;
    const pct = target > 0 ? Math.min(100, saved / target * 100) : 100;
    let overdue = false, monthsLeft = null, perMonth = null;
    if (goal && goal.deadline && isValidDate(goal.deadline) && !done) {
      if (goal.deadline < today) overdue = true;
      else {
        const [y1, m1] = today.split('-').map(Number), [y2, m2] = goal.deadline.split('-').map(Number);
        monthsLeft = (y2 - y1) * 12 + (m2 - m1) + 1;
        perMonth = monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : remaining;
      }
    }
    return { remaining, pct, done, overdue, monthsLeft, perMonth };
  }
  function suggestedContribution(goal, today = todayISO(), fallbackMonths = 12) {
    const p = goalProgress(goal, today);
    if (p.done) return 0;
    if (p.perMonth !== null) return p.perMonth;
    return Math.ceil(p.remaining / Math.max(1, fallbackMonths));
  }
  function validateGoalAction(input, currentSaved = 0) {
    const errors = {};
    const type = input && input.type;
    if (type !== 'deposit' && type !== 'withdraw') errors.type = 'Choose deposit or withdraw.';
    const amt = parseAmount(input && input.amount, { emptyMsg: 'Enter an amount.' });
    if (amt.error) errors.amount = amt.error;
    else if (type === 'withdraw' && amt.cents > currentSaved) {
      errors.amount = 'Cannot withdraw more than currently saved.';
    } else if (type === 'deposit' && currentSaved + amt.cents > MAX_AMOUNT) {
      errors.amount = 'Amount is too large.';
    }
    const ok = Object.keys(errors).length === 0;
    return { ok, errors, value: ok ? { type, amount: amt.cents } : null };
  }
  function filterTransactions(txs, { query = '', type = 'all', category = 'all' } = {}) {
    if (!Array.isArray(txs)) return [];
    const q = String(query ?? '').trim().toLowerCase();
    return txs.filter(t => isValidTx(t) &&
      (type === 'all' || t.type === type) &&
      (category === 'all' || t.category === category) &&
      (!q || `${t.description} ${t.category} ${t.account} ${t.note || ''}`.toLowerCase().includes(q)));
  }
  function sortTransactions(txs, key = 'date', dir = -1) {
    if (!Array.isArray(txs)) return [];
    const val = t => (key === 'amount' ? signed(t) : String(t[key] ?? '').toLowerCase());
    return [...txs].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x > y ? 1 : x < y ? -1 : 0) * dir || (b.date > a.date ? 1 : b.date < a.date ? -1 : 0);
    });
  }

  /* ---------- export, backup & restore ---------- */
  // Escapes a CSV cell per RFC 4180 and neutralizes spreadsheet formula injection (=, +, -, @, \t, \r).
  function sanitizeCSVCell(val, { protectFormula = true } = {}) {
    let s = String(val ?? '');
    if (protectFormula && /^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(txs = []) {
    const headers = ['Date', 'Type', 'Category', 'Description', 'Amount', 'Account', 'Note'];
    const lines = [headers.join(',')];
    if (!Array.isArray(txs)) return lines.join('\r\n');
    const sorted = sortTransactions(txs.filter(isValidTx), 'date', -1);
    for (const t of sorted) {
      const amt = (t.amount / 100).toFixed(2);
      const row = [
        sanitizeCSVCell(t.date, { protectFormula: false }),
        sanitizeCSVCell(t.type, { protectFormula: false }),
        sanitizeCSVCell(t.category),
        sanitizeCSVCell(t.description),
        sanitizeCSVCell(amt, { protectFormula: false }),
        sanitizeCSVCell(t.account),
        sanitizeCSVCell(t.note || ''),
      ];
      lines.push(row.join(','));
    }
    return lines.join('\r\n');
  }

  function createBackup({ transactions = [], budgets = [], goals = [], contributions = [], recurring = [], settings = defaultSettings() } = {}, exportedAt = new Date().toISOString()) {
    const normSettings = normalizeSettings(settings);
    const t = cleanList(transactions, x => normalize(x, normSettings));
    const b = cleanList(budgets, x => normalizeBudget(x, normSettings), 'category');
    const g = cleanList(goals, normalizeGoal);
    const c = cleanList(contributions, normalizeContribution);
    const r = cleanList(recurring, x => normalizeRecurring(x, normSettings));
    return {
      app: 'dark-forest-finance',
      version: SCHEMA_VERSION,
      exportedAt,
      transactions: t.out,
      budgets: b.out,
      goals: g.out,
      contributions: c.out,
      recurring: r.out,
      settings: normSettings,
    };
  }

  function validateBackup(raw, today = todayISO()) {
    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      return { ok: false, status: 'empty', error: 'Backup file is empty.', issues: ['The selected file contains no data.'], warnings: [], preview: null, data: null };
    }
    let parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch (e) {
        return { ok: false, status: 'corrupt', error: 'Malformed JSON file. The backup could not be parsed.', issues: ['File is not valid JSON syntax.'], warnings: [], preview: null, data: null };
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 'invalid', error: 'Invalid backup format: expected a JSON backup object.', issues: ['Root value must be a JSON object.'], warnings: [], preview: null, data: null };
    }
    if ('app' in parsed && parsed.app !== 'dark-forest-finance') {
      return { ok: false, status: 'incompatible', error: 'Incompatible backup file: created by another application.', issues: [`Unrecognized app identifier: "${String(parsed.app).slice(0, 40)}".`], warnings: [], preview: null, data: null };
    }
    if (!Number.isInteger(parsed.version) || parsed.version < 1) {
      return { ok: false, status: 'incomplete', error: 'Incomplete backup file: missing or invalid schema version.', issues: ['Missing required integer "version" field.'], warnings: [], preview: null, data: null };
    }
    if (parsed.version > SCHEMA_VERSION) {
      return { ok: false, status: 'incompatible', error: `Incompatible schema version (v${parsed.version}). This app supports up to v${SCHEMA_VERSION}.`, issues: [`Backup version v${parsed.version} was created by a newer version of the application.`], warnings: [], preview: null, data: null };
    }
    if (!Array.isArray(parsed.transactions)) {
      return { ok: false, status: 'incomplete', error: 'Incomplete backup file: missing "transactions" list.', issues: ['Required "transactions" array is missing or invalid.'], warnings: [], preview: null, data: null };
    }

    const issues = [], warnings = [];
    if ('budgets' in parsed && parsed.budgets !== undefined && !Array.isArray(parsed.budgets)) issues.push('"budgets" field must be an array.');
    if ('goals' in parsed && parsed.goals !== undefined && !Array.isArray(parsed.goals)) issues.push('"goals" field must be an array.');
    if ('contributions' in parsed && parsed.contributions !== undefined && !Array.isArray(parsed.contributions)) issues.push('"contributions" field must be an array.');
    if ('recurring' in parsed && parsed.recurring !== undefined && !Array.isArray(parsed.recurring)) issues.push('"recurring" field must be an array.');
    if ('settings' in parsed && parsed.settings !== undefined && (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings))) issues.push('"settings" field must be an object.');
    if (issues.length) {
      return { ok: false, status: 'invalid', error: 'Invalid backup structure: ' + issues[0], issues, warnings, preview: null, data: null };
    }

    if (parsed.settings && parsed.settings.monthlyBudget !== undefined) {
      const rawMb = parsed.settings.monthlyBudget;
      if (!Number.isInteger(rawMb) || rawMb <= 0 || rawMb > MAX_AMOUNT) {
        issues.push('Invalid monthlyBudget setting (must be positive integer cents).');
      }
    }
    const normSettings = normalizeSettings(parsed.settings);

    const t = cleanList(parsed.transactions, x => normalize(x, normSettings));
    if (t.dropped > 0) issues.push(`${t.dropped} transaction record(s) are malformed or invalid.`);

    let bOut = [], gOut = [], cOut = [], rOut = [];
    if (Array.isArray(parsed.budgets)) {
      const b = cleanList(parsed.budgets, x => normalizeBudget(x, normSettings), 'category');
      if (b.dropped > 0) issues.push(`${b.dropped} budget record(s) are invalid or duplicate.`);
      bOut = b.out;
    } else if (parsed.version === 1) {
      bOut = defaultBudgets();
      warnings.push('Schema v1 backup: default category budgets will be initialized.');
    } else {
      warnings.push('No category budgets found in backup; budgets list will be empty.');
    }

    if (Array.isArray(parsed.goals)) {
      const g = cleanList(parsed.goals, normalizeGoal);
      if (g.dropped > 0) issues.push(`${g.dropped} savings goal record(s) are invalid.`);
      gOut = g.out;
    } else if (parsed.version === 1) {
      gOut = defaultGoals(today);
      warnings.push('Schema v1 backup: default savings goals will be initialized.');
    } else {
      warnings.push('No savings goals found in backup; goals list will be empty.');
    }

    if (Array.isArray(parsed.contributions)) {
      const c = cleanList(parsed.contributions, normalizeContribution);
      if (c.dropped > 0) issues.push(`${c.dropped} goal contribution record(s) are invalid.`);
      cOut = c.out;
    }

    if (Array.isArray(parsed.recurring)) {
      const r = cleanList(parsed.recurring, x => normalizeRecurring(x, normSettings));
      if (r.dropped > 0) issues.push(`${r.dropped} recurring schedule record(s) are invalid.`);
      rOut = r.out;
    }

    if (issues.length) {
      return { ok: false, status: 'invalid', error: issues[0], issues, warnings, preview: null, data: null };
    }

    const exportedAt = typeof parsed.exportedAt === 'string' && parsed.exportedAt ? parsed.exportedAt
      : (typeof parsed.savedAt === 'string' && parsed.savedAt ? parsed.savedAt : '');
    if (!exportedAt) warnings.push('Backup creation timestamp was not included in the file.');

    const mat = materializeRecurring(t.out, rOut, today);
    const data = {
      transactions: mat.transactions,
      budgets: bOut,
      goals: gOut,
      contributions: cOut,
      recurring: mat.recurring,
      settings: normSettings,
    };
    const totals = summarize(mat.transactions, { start: '1900-01-01', end: '2100-12-31' });
    const preview = {
      version: parsed.version,
      exportedAt,
      transactionCount: mat.transactions.length,
      budgetCount: bOut.length,
      goalCount: gOut.length,
      contributionCount: cOut.length,
      recurringCount: mat.recurring.length,
      monthlyBudget: normSettings.monthlyBudget,
      totalIncome: totals.income,
      totalExpense: totals.expense,
      netBalance: netBalance(mat.transactions, today),
    };
    return { ok: true, status: 'ok', error: null, issues: [], warnings, preview, data };
  }

  function restoreBackup(storage, rawBackup, today = todayISO()) {
    const v = validateBackup(rawBackup, today);
    if (!v.ok) return v;
    if (storage) {
      let prevRaw = null;
      try { prevRaw = storage.getItem(STORAGE_KEY); } catch (e) {
        return { ok: false, status: 'unavailable', error: 'Browser storage is unavailable. Existing data was not modified.', issues: ['Cannot read from browser localStorage.'], warnings: v.warnings, preview: v.preview, data: null };
      }
      if (prevRaw !== null) backup(storage, prevRaw);
      if (!save(storage, v.data)) {
        if (prevRaw !== null) {
          try { storage.setItem(STORAGE_KEY, prevRaw); } catch (e) { /* ignore rollback error */ }
        }
        return { ok: false, status: 'quota', error: 'Could not restore backup — browser storage is full or blocked. Existing data was preserved.', issues: ['Storage write failed (quota exceeded or blocked).'], warnings: v.warnings, preview: v.preview, data: null };
      }
    }
    return { ...v, restored: true };
  }

  /* ---------- sample data (only used when storage is empty) ---------- */
  function seed(today = todayISO()) {
    let s = 42;
    const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100);
    const pick = a => a[Math.floor(rnd() * a.length)];
    const out = [];
    const add = (type, description, category, ym, day, amount, account = 'Checking', note = '') => {
      const date = `${ym}-${pad(Math.min(day, Number(monthEnd(ym + '-01').slice(8))))}`;
      if (date <= today) out.push({ id: createId(), type, amount, description, category, date, account, note });
    };
    for (let i = -11; i <= 0; i++) {
      const ym = monthStart(today, i).slice(0, 7), mo = Number(ym.slice(5));
      add('income', 'Acme Corp payroll', 'Salary', ym, 1, 642000, 'Checking');
      if (rnd() < 0.8) add('income', `Upwork — ${pick(['Lumen Studio', 'Northwind', 'Pixel & Co'])}`, 'Freelance', ym, 12 + Math.floor(rnd() * 8), between(600, 2400), 'Checking');
      add('income', 'Savings interest', 'Interest', ym, 28, between(60, 90), 'Savings');
      add('expense', 'Rent', 'Housing', ym, 3, 185000, 'Checking');
      add('expense', 'City Power & Water', 'Utilities', ym, 8, between(110, 190), 'Checking');
      for (let k = 0; k < 4; k++) add('expense', pick(['Whole Foods', "Trader Joe's", 'Green Market', 'Costco']), 'Groceries', ym, 2 + k * 7, between(60, 165));
      for (let k = 0; k < 3; k++) add('expense', pick(['Sushi Bar Koi', 'Blue Bottle Coffee', 'Taqueria Sol', 'Bistro 21']), 'Dining out', ym, 5 + k * 9, between(18, 85), 'Visa •4021');
      add('expense', 'Shell', 'Transport', ym, 10, between(40, 70));
      add('expense', 'Metro card', 'Transport', ym, 2, 9000, 'Checking');
      add('expense', 'Spotify', 'Subscriptions', ym, 21, 1199, 'Visa •4021');
      add('expense', 'Netflix', 'Subscriptions', ym, 14, 1549, 'Visa •4021');
      add('expense', pick(['Uniqlo', 'IKEA', 'Apple Store', 'Zara']), 'Shopping', ym, 17, between(50, 320));
      if (rnd() < 0.35) add('expense', 'Pharmacy+', 'Health', ym, 16, between(20, 120), 'Checking');
      add('expense', pick(['Cinema City', 'Steam', 'Concert tickets']), 'Entertainment', ym, 19, between(15, 80));
      if (mo === 12 || mo === 7) add('expense', pick(['Airbnb', 'Turkish Airlines']), 'Travel', ym, 22, between(900, 1600), 'Visa •4021', 'Holiday trip');
      add('expense', 'Farmers market', 'Groceries', ym, 26, between(20, 45), 'Cash');
      if (i === -11) add('income', 'Cash gift', 'Gifts', ym, 5, 50000, 'Cash');
    }
    // One scheduled (future) payment to show that future items are excluded from totals.
    const next = monthStart(today, 1);
    out.push({ id: createId(), type: 'expense', amount: 185000, description: 'Rent', category: 'Housing', date: addDays(next, 2), account: 'Checking', note: 'Scheduled' });
    return out;
  }

  return {
    STORAGE_KEY, SCHEMA_VERSION, CATEGORIES, ACCOUNTS, GOAL_TAGS, FREQUENCIES, CURRENCIES, DATE_FORMATS,
    FX_STORAGE_KEY, FX_STALE_MS, DEFAULT_FX_RATES,
    defaultBudgets, defaultGoals, defaultSettings, defaultAccountCurrencies, accountCurrency, txCurrency,
    validateFxSnapshot, isFxStale, getExchangeRate, convertAmount, saveFxRates, loadFxRates, fetchExchangeRates,
    resolveTxAmount, signedInReporting, balanceByAccountNative, previewAccountCurrencyChange, convertAccountCurrency,
    allCategories, validateCategoryName, formatCurrency, formatDate,
    toCents, todayISO, isValidDate, monthStart, monthEnd, addDays, periodRange, previousRange,
    validate, validateBudget, validateGoal, validateRecurring,
    normalize, normalizeBudget, normalizeGoal, normalizeContribution, normalizeRecurring, normalizeSettings,
    occurrenceDate, materializeRecurring, nextOccurrence, upcomingOccurrences,
    parseAmount, createId, migrate, load, save,
    signed, summarize, netBalance, balanceByAccount, byCategory, monthlySeries, balanceHistory, savingStreak, budgetStatus, monthlyBudgetStatus, goalProgress,
    filterTransactions, sortTransactions, seed, validateGoalAction, suggestedContribution,
    sanitizeCSVCell, toCSV, createBackup, validateBackup, restoreBackup,
  };
});
