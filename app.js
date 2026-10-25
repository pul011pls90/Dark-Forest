/* Dark Forest Finance — UI layer. All figures derive from `state.txs` via Finance.* */
(function () {
  const F = window.Finance;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (cents, d) => F.formatCurrency(cents, (state.settings && state.settings.currency) || 'USD', d);
  const fmtDate = iso => F.formatDate(iso, (state.settings && state.settings.dateFormat) || 'short', state.today);
  const monthName = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  const monthLong = iso => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const sum = a => a.reduce((x, y) => x + y, 0);

  // Colors come from CSS custom properties in index.html; SVG uses them via style="fill:var(...)".
  const CAT_TOKENS = { Housing: 1, Groceries: 2, 'Dining out': 3, Transport: 4, Utilities: 5, Subscriptions: 6,
    Shopping: 7, Health: 8, Entertainment: 9, Travel: 10, Other: 11 };
  const catColor = c => {
    if (CAT_TOKENS[c]) return `var(--cat-${CAT_TOKENS[c]})`;
    let h = 0;
    for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 11;
    return `var(--cat-${h + 1})`;
  };
  const PAGE = 8;

  const state = {
    txs: [], budgets: [], goals: [], contributions: [], recurring: [], settings: F.defaultSettings(),
    fx: F.DEFAULT_FX_RATES, storageStatus: 'ok',
    today: F.todayISO(), period: 6, view: 'overview',
    filter: { query: '', type: 'all', category: 'all' }, sortKey: 'date', sortDir: -1,
    activeCat: null, editingId: null,
  };

  const repCurr = () => (state.settings && state.settings.currency) || 'USD';
  const calcOpts = () => ({ reportingCurrency: repCurr(), fx: state.fx, settings: state.settings });
  const convFromUSD = cents => {
    const rep = repCurr();
    if (rep === 'USD') return cents;
    const c = F.convertAmount(cents, 'USD', rep, state.fx);
    return c !== null && Number.isFinite(c) ? c : cents;
  };

  function syncCurrencySymbols() {
    const code = repCurr();
    const sym = (F.CURRENCIES && F.CURRENCIES[code] && F.CURRENCIES[code].symbol) || '$';
    document.querySelectorAll('.money span').forEach(el => { el.textContent = sym; });
    document.querySelectorAll('#gaChips .qchip').forEach(el => {
      if (el.dataset.val) {
        const baseCents = Number(el.dataset.val) * 100;
        const conv = convFromUSD(baseCents);
        el.textContent = `+${fmt(conv, 0)}`;
      }
    });
    const topSel = $('#topCurrencySelect');
    if (topSel && F.CURRENCIES) {
      if (!topSel.options.length) {
        topSel.innerHTML = Object.entries(F.CURRENCIES).map(([c, m]) => `<option value="${esc(c)}">${esc(m.label)}</option>`).join('');
      }
      topSel.value = code;
    }
    const fxBadge = $('#fxBadge');
    if (fxBadge) {
      if (code === 'USD') {
        fxBadge.hidden = true;
      } else {
        const rate = F.getExchangeRate('USD', code, state.fx);
        if (rate === null) {
          fxBadge.textContent = `FX: USD→${code} unavailable`;
          fxBadge.className = 'fx-pill warn';
        } else {
          const rStr = rate >= 10 ? rate.toFixed(2) : rate.toFixed(4);
          const src = (state.fx && state.fx.source) || 'ref';
          fxBadge.textContent = `1 USD = ${rStr} ${code} (${(state.fx && state.fx.date) || state.today} · ${src})`;
          fxBadge.className = 'fx-pill' + (state.fx && state.fx.stale && src !== 'live' ? ' warn' : '');
        }
        fxBadge.hidden = false;
      }
    }
    updateSystemStatus();
  }

  function updateSystemStatus() {
    const dot = $('#footerSysDot'), txt = $('#footerSysText');
    if (!txt) return;
    const online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    const fxSrc = (state.fx && state.fx.source) || 'reference';
    const fxLabel = fxSrc === 'live' ? `Live FX (${state.fx.date})` : fxSrc === 'cached' ? `Cached FX (${state.fx.date})` : `Ref FX (${(state.fx && state.fx.date) || state.today})`;
    const stLabel = state.storageStatus === 'unavailable' ? 'Storage: Unavailable' : 'Storage: Local v2 OK';
    txt.textContent = `${stLabel} · ${fxLabel} · ${online ? 'Online' : 'Offline'}`;
    if (dot) dot.className = 'sys-dot' + (!online || state.storageStatus === 'unavailable' ? ' warn' : '');
  }

  function recordRecentCategory(cat) {
    if (!cat) return;
    const prev = Array.isArray(state.settings.recentCategories) ? state.settings.recentCategories : [];
    state.settings.recentCategories = [cat, ...prev.filter(x => x !== cat)].slice(0, 6);
  }

  /* ---------- persistence ---------- */
  let storage;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  function loadData() {
    const r = storage ? F.load(storage, () => F.seed(state.today), state.today)
      : { transactions: F.seed(state.today), budgets: F.defaultBudgets(), goals: F.defaultGoals(state.today), contributions: [], recurring: [], settings: F.defaultSettings(), status: 'unavailable' };
    const fxSnap = F.loadFxRates(storage);
    Object.assign(state, { txs: r.transactions, budgets: r.budgets, goals: r.goals, contributions: r.contributions || [], recurring: r.recurring || [], settings: r.settings, fx: fxSnap, storageStatus: r.status });
    const msg = {
      corrupt: 'Saved data could not be read, so the app started empty. The original was kept as a backup in browser storage.',
      incompatible: 'Saved data was created by a newer or unknown version. It was kept as a backup and the app started empty.',
      partial: `${r.dropped} invalid saved record(s) were skipped. The original data was kept as a backup.`,
      unavailable: 'Browser storage is unavailable, so changes will not be saved after you close this page. Use Backup JSON to save your data to a file.',
    }[r.status];
    if (msg) { $('#notice').textContent = msg; $('#notice').hidden = false; }
  }
  function persist() {
    dataVersion++;
    if (!storage) {
      toast('Storage unavailable — export a JSON backup to save changes.');
      return false;
    }
    if (!F.save(storage, { transactions: state.txs, budgets: state.budgets, goals: state.goals, contributions: state.contributions, recurring: state.recurring, settings: state.settings })) {
      const errMsg = 'Could not save changes — browser storage is full or blocked. Export a JSON backup so your work is not lost.';
      toast('Could not save — browser storage is full or blocked.');
      if ($('#notice')) { $('#notice').textContent = errMsg; $('#notice').hidden = false; }
      return false;
    }
    return true;
  }

  /* ---------- rendering ---------- */
  function renderAll() { syncCurrencySymbols(); renderKPIs(); renderPixelGrid(); renderChart(); renderCats(); renderBudget(); renderGoals(); renderStreak(); renderQuickAdd(); renderRecurring(); renderTable(); renderFilterBar(); renderInsights(); }

  function change(el, cur, prev, goodWhenUp) {
    if (prev === 0) { el.textContent = cur === 0 ? '— no change' : 'New'; el.className = 'badge'; el.style.color = 'var(--muted)'; return; }
    const d = (cur - prev) / prev * 100, good = goodWhenUp ? d >= 0 : d <= 0;
    el.style.color = ''; el.textContent = `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%`; el.className = 'badge ' + (good ? 'up' : 'down');
  }

  function renderKPIs() {
    const { txs, today, period: n } = state;
    const opts = calcOpts(), rep = repCurr();
    const range = F.periodRange(n, today), prev = F.previousRange(n, today);
    const cur = F.summarize(txs, range, opts), old = F.summarize(txs, prev, opts);
    const bal = F.netBalance(txs, today, opts), balBefore = F.netBalance(txs, F.addDays(range.start, -1), opts);
    setMoney($('#bal'), bal);
    const diff = bal - balBefore;
    $('#balDelta').innerHTML = `<span class="badge ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${fmt(Math.abs(diff), 0)}</span> since ${monthLong(range.start)}`;
    const acctsRep = F.balanceByAccount(txs, today, opts);
    const acctsNative = F.balanceByAccountNative(txs, today, state.settings, state.fx);
    $('#accounts').innerHTML = F.ACCOUNTS.map((a, i) => {
      const nat = acctsNative[a] || { amount: 0, currency: 'USD' };
      const nativeStr = F.formatCurrency(nat.amount, nat.currency);
      const diffCurr = nat.currency !== rep;
      const convSub = diffCurr ? `<div class="sub mono" style="font-size:10.5px">≈ ${fmt(acctsRep[a])}</div>` : '';
      return `<div style="${nat.amount < 0 ? 'border-color:var(--danger)' : i % 2 ? 'border-color:var(--pos)' : ''};min-width:105px">
        <div class="lbl" style="display:flex;align-items:center;gap:4px"><span>${esc(a)}</span><button type="button" class="acct-card-btn" data-acct-open="${esc(a)}" title="Change ${esc(a)} account currency (${esc(nat.currency)})">${esc(nat.currency)}</button></div>
        <div class="mono ${nat.amount < 0 ? 'neg' : ''}" style="font-weight:600;margin-top:2px">${nativeStr}</div>
        ${convSub}
      </div>`;
    }).join('');

    $('#incPeriod').textContent = n === 1 ? monthLong(today) : `${monthLong(range.start)} – ${monthLong(today)}`;
    setMoney($('#inc'), cur.income);
    setMoney($('#exp'), cur.expense);
    change($('#incBadge'), cur.income, old.income, true);
    change($('#expBadge'), cur.expense, old.expense, false);
    const top = F.byCategory(txs, range, 'income', opts).slice(0, 2);
    $('#incSplit').innerHTML = top.length ? top.map((c, i) => `<div style="${i ? 'border-color:var(--pos)' : ''}"><div class="lbl">${esc(c.category)}</div><div class="mono">${fmt(c.amount, 0)}</div></div>`).join('')
      : '<div style="border:0;padding:0" class="sub">No income recorded in this period.</div>';

    setMoney($('#net'), cur.net); $('#net').classList.toggle('neg', cur.net < 0);
    const rate = cur.savingsRate;
    $('#rate').textContent = rate === null ? '— (no income)' : rate.toFixed(1) + '%';
    $('#rate').classList.toggle('neg', rate !== null && rate < 0);
    const rb = $('#rateBadge');
    rb.textContent = rate === null ? 'No income' : rate >= 30 ? 'On target' : 'Below target';
    rb.className = 'badge ' + (rate !== null && rate >= 30 ? 'up' : 'down');
    const on = rate === null ? 0 : Math.max(0, Math.min(20, Math.round(rate / 5)));
    const meterCls = rate === null ? 'on' : rate >= 30 ? 'on' : rate >= 0 ? 'warn' : 'over';
    $('#meter').innerHTML = segCells('meter', 20, on, meterCls, i => (i === 5 ? 'tgt' : ''));
  }

  // 10 columns = last 10 month-end balances; columns inside the selected period are bright.
  function renderPixelGrid() {
    const s = F.balanceHistory(state.txs, state.today, 10, calcOpts());
    const mx = Math.max(...s), mn = Math.min(0, Math.min(...s)), span = mx - mn || 1;
    const hs = s.map(v => Math.max(1, Math.round((v - mn) / span * 10)));
    const hl = Math.min(state.period, 10);
    let h = '', aIdx = 0;
    for (let r = 9; r >= 0; r--) for (let c = 0; c < 10; c++) {
      const inPer = c >= 10 - hl, on = r < hs[c];
      const cls = on ? (r === hs[c] - 1 ? (inPer ? 'a' : 'c') : (inPer ? 'b' : 'c')) : '';
      const pi = cls === 'a' ? ` style="--pi:${aIdx++}"` : '';
      h += `<i class="${cls}"${pi}></i>`;
    }
    $('#pxgrid').innerHTML = h;
  }

  /* ---------- motion helpers ---------- */
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const motion = () => !reducedMotion.matches;
  const EASE = 'cubic-bezier(.22,.61,.36,1)';

  // Rolls a money figure from its previous value to the new one. First paint and reduced motion are instant,
  // and the final frame always prints the exact value.
  function setMoney(el, cents, decimals) {
    if (!el) return;
    const from = el._v, fromCurr = el._curr, curCode = repCurr();
    el._v = cents; el._curr = curCode;
    cancelAnimationFrame(el._raf);
    if (from === undefined || from === cents || fromCurr !== curCode || !motion()) { el.textContent = fmt(cents, decimals); return; }
    const t0 = performance.now(), d = 520;
    const step = t => {
      const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(k < 1 ? Math.round(from + (cents - from) * e) : cents, decimals);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  // Pixel-segment progress: cells that newly turn on fill in sequence (CSS .fresh); cells turning off are instant.
  const segPrev = new Map();
  function segCells(key, count, on, onCls = 'on', extra = () => '') {
    const prev = segPrev.has(key) ? Math.min(segPrev.get(key), on) : 0;
    segPrev.set(key, on);
    return Array.from({ length: count }, (_, i) => {
      const fresh = i < on && i >= prev;
      return `<i class="${i < on ? onCls : ''} ${extra(i)}${fresh ? ' fresh' : ''}"${fresh ? ` style="--k:${i - prev}"` : ''}></i>`;
    }).join('');
  }

  /* ---------- chart ---------- */
  let geo = null;        // geometry of the last render, used by the crosshair
  let barPrev = null;    // month → { inc, exp } bar heights in px from the last render
  let active = null;     // { i, y } currently inspected month
  let chartSig = '';     // skip redraws when size, period and data are unchanged
  let dataVersion = 0;

  function renderChart({ animate = true } = {}) {
    const el = $('#chart');
    if (!el.offsetParent) return; // hidden in current view
    const W = el.clientWidth, H = el.clientHeight, pl = W < 420 ? 38 : 52, pb = 24, pt = 10;
    const currCode = repCurr();
    const currSym = (F.CURRENCIES && F.CURRENCIES[currCode] && F.CURRENCIES[currCode].symbol) || '$';
    const fxDate = (state.fx && state.fx.date) || '';
    const sig = `${W}x${H}|${state.period}|${dataVersion}|${currCode}|${fxDate}`;
    if (sig === chartSig && el.querySelector('svg')) return;
    chartSig = sig;
    const n = Math.max(state.period, 3), S = F.monthlySeries(state.txs, state.today, n, calcOpts());
    const rawTop = Math.max(10000, ...S.map(m => Math.max(m.income, m.expense)));
    const mag = Math.pow(10, Math.max(3, Math.floor(Math.log10(rawTop / 4))));
    const halfMag = Math.max(1000, mag / 2);
    const step = Math.max(1000, Math.ceil((rawTop / 4) / halfMag) * halfMag), max = step * 4;
    const lo = Math.min(0, ...S.map(m => m.net)), loR = lo < 0 ? -Math.ceil(-lo / step) * step : 0;
    const y = v => pt + (H - pt - pb) * (1 - (v - loR) / (max - loR));
    const cw = (W - pl) / n, bw = Math.min(18, cw / 3.2), blk = 6;
    const entering = !barPrev; // first draw: staggered rise; afterwards bars move from their previous heights
    const fmtAxis = v => {
      const absMajor = Math.abs(v) / 100;
      const sign = v < 0 ? '−' : '';
      if (absMajor === 0) return `${currSym}0`;
      if (absMajor >= 1000000) return `${sign}${currSym}${(absMajor / 1000000).toFixed(absMajor % 1000000 === 0 ? 0 : 1)}M`;
      if (absMajor >= 1000) return `${sign}${currSym}${(absMajor / 1000).toFixed(absMajor % 1000 === 0 ? 0 : 1)}k`;
      return `${sign}${currSym}${Math.round(absMajor)}`;
    };
    const mBudgetRep = convFromUSD((state.settings && state.settings.monthlyBudget) || 350000);
    let s = `<svg width="${W}" height="${H}" class="${entering && animate ? 'enter' : ''}" aria-hidden="true">`;
    for (let v = loR; v <= max; v += step) s += `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-dasharray="${v ? '2 4' : ''}"/><text x="0" y="${y(v) + 4}">${fmtAxis(v)}</text>`;
    s += `<rect class="xh-band" x="0" y="${pt}" width="${cw}" height="${H - pt - pb}" style="display:none"/>`;
    const heights = {};
    const showEvery = (W < 420 && n > 6) ? 2 : 1;
    S.forEach((m, i) => {
      const cx = pl + cw * i + cw / 2, cur = i === n - 1;
      heights[m.month] = {};
      const expColor = (m.expense > mBudgetRep || m.net < 0) ? 'var(--danger)' : (m.expense >= mBudgetRep * 0.8 ? 'var(--warn)' : 'var(--danger)');
      [['inc', m.income, cx - bw - 1, cur ? 'var(--accent)' : 'var(--pos)'], ['exp', m.expense, cx + 1, expColor]].forEach(([k, v, x, c], j) => {
        const t = y(v), b = y(0);
        heights[m.month][k] = v ? b - t : 0;
        if (!v) return;
        s += `<g class="cbar${cur ? ' cur' : ''}" data-m="${m.month}" data-k="${k}" style="--i:${i * 2 + j}">`;
        let segIdx = 0;
        for (let yy = b - blk; yy >= t - blk + 0.5; yy -= blk) {
          const topSeg = yy - blk < t - blk + 0.5;
          const segColor = (k === 'exp' && m.expense >= mBudgetRep * 0.8 && m.expense <= mBudgetRep && topSeg) ? 'var(--warn)' : c;
          s += `<rect class="px-seg" x="${x}" y="${Math.max(yy, t) + 1}" width="${bw}" height="${Math.min(blk, b - Math.max(yy, t)) - 1}" style="--seg-i:${segIdx++};fill:${segColor}" opacity="${cur ? 1 : .78}"/>`;
        }
        s += '</g>';
      });
      const isLabelVisible = (n <= 6) || (i % showEvery === 0) || cur;
      const labelText = isLabelVisible ? monthName(m.month) : '';
      s += `<text x="${cx}" y="${H - 6}" text-anchor="middle" ${cur ? 'style="fill:var(--text);font-weight:600"' : ''}>${labelText}</text>`;
    });
    const netPoints = S.map((m, i) => `${pl + cw * i + cw / 2},${y(m.net)}`).join(' ');
    s += `<g class="netl" style="--n:${n * 2}">`;
    s += `<polyline class="net-track" points="${netPoints}" fill="none" style="stroke:var(--text)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    s += `<polyline class="net-pulse" points="${netPoints}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>`;
    S.forEach((m, i) => {
      const cur = i === n - 1;
      s += `<rect class="nm${cur ? ' cur' : ''}" data-m="${m.month}" x="${pl + cw * i + cw / 2 - 3}" y="${y(m.net) - 3}" width="6" height="6" style="fill:var(--bg);stroke:${m.net < 0 ? 'var(--danger)' : 'var(--text)'}"/>`;
    });
    s += `</g><g class="xh" style="display:none"><line class="xh-v" y1="${pt}" y2="${H - pb}"/><line class="xh-h" x1="${pl}" x2="${W}"/><rect class="xh-lbl" x="0" width="${pl - 4}" height="16" rx="3"/><text class="xh-t" x="2"></text></g></svg>`;
    el.querySelectorAll('svg').forEach(x => x.remove());
    el.insertAdjacentHTML('beforeend', s);

    // Value changes: each bar scales from its previous pixel height to the new one (never past either end).
    if (animate && !entering && motion()) {
      el.querySelectorAll('.cbar').forEach(g => {
        const h = heights[g.dataset.m][g.dataset.k], ph = (barPrev[g.dataset.m] || {})[g.dataset.k] || 0;
        if (Math.abs(ph - h) > 0.5 && h > 0) g.animate([{ transform: `scaleY(${ph / h})` }, { transform: 'scaleY(1)' }], { duration: 420, easing: EASE });
      });
      el.querySelector('.netl').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 250, easing: 'ease-out', fill: 'backwards' });
    }
    barPrev = heights;
    geo = { S, W, H, pl, pt, pb, cw, y, loR, max };
    if (active) showCrosshair(Math.min(active.i, n - 1), active.y);
    $('#chartSummary').textContent = S.map(m => `${monthName(m.month)} ${m.month.slice(0, 4)}: income ${fmt(m.income)}, expenses ${fmt(m.expense)}, net ${fmt(m.net)}`).join('. ');
  }

  function showCrosshair(i, py) {
    if (!geo) return;
    const { S, W, H, pl, pt, pb, cw, y, loR, max } = geo, m = S[i], el = $('#chart'), svg = el.querySelector('svg');
    const cx = pl + cw * i + cw / 2;
    py = Math.max(pt, Math.min(H - pb, py ?? y(m.net)));
    active = { i, y: py };
    const band = svg.querySelector('.xh-band'); band.style.display = ''; band.setAttribute('x', pl + cw * i);
    const xh = svg.querySelector('.xh'); xh.style.display = '';
    xh.querySelector('.xh-v').setAttribute('x1', cx); xh.querySelector('.xh-v').setAttribute('x2', cx);
    xh.querySelector('.xh-h').setAttribute('y1', py); xh.querySelector('.xh-h').setAttribute('y2', py);
    const v = loR + (1 - (py - pt) / (H - pt - pb)) * (max - loR); // axis readout at the pointer
    xh.querySelector('.xh-lbl').setAttribute('y', py - 8);
    const t = xh.querySelector('.xh-t'); t.setAttribute('y', py + 4); t.textContent = fmt(Math.round(v / 100) * 100, 0);
    const rate = m.savingsRate === null ? '—' : m.savingsRate.toFixed(1) + '%';
    const tip = $('#tip');
    tip.innerHTML = `<b>${monthName(m.month)} ${m.month.slice(0, 4)}</b><div><span>Income</span><span>${fmt(m.income)}</span></div><div><span>Expenses</span><span>${fmt(m.expense)}</span></div><div><span>Net</span><span style="color:${m.net < 0 ? 'var(--danger)' : 'var(--pos)'}">${fmt(m.net)}</span></div><div><span>Savings rate</span><span>${rate}</span></div>`;
    const tw = Math.min(tip.offsetWidth || 170, W - 16), th = tip.offsetHeight || 96;
    let left = cx + 14;
    if (left + tw > W - 8) left = cx - 14 - tw;
    if (left < 6) left = 6;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(4, Math.min(H - th - 4, (py ?? y(m.net)) - th / 2)) + 'px';
    tip.classList.add('show');
    $('#chartLive').textContent = `${monthName(m.month)} ${m.month.slice(0, 4)}: income ${fmt(m.income)}, expenses ${fmt(m.expense)}, net ${fmt(m.net)}`;
  }
  function hideCrosshair() {
    active = null;
    const svg = $('#chart svg'); if (!svg) return;
    svg.querySelector('.xh').style.display = 'none'; svg.querySelector('.xh-band').style.display = 'none';
    $('#tip').classList.remove('show');
  }
  function bindChart() {
    const el = $('#chart');
    const at = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pick = p => geo && p.x >= geo.pl && Math.max(0, Math.min(geo.S.length - 1, Math.floor((p.x - geo.pl) / geo.cw)));
    const onPoint = e => { const p = at(e), i = pick(p); if (i === false) return hideCrosshair(); showCrosshair(i, p.y); };
    el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) onPoint(e); });
    el.addEventListener('pointerdown', e => { el.dataset.pointer = '1'; onPoint(e); });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideCrosshair(); });
    document.addEventListener('pointerdown', e => { if (!el.contains(e.target)) hideCrosshair(); });
    el.addEventListener('focus', () => { if (!active && geo) showCrosshair(geo.S.length - 1); });
    el.addEventListener('blur', () => { delete el.dataset.pointer; hideCrosshair(); });
    el.addEventListener('keydown', e => {
      delete el.dataset.pointer;
      if (!geo) return;
      const n = geo.S.length, i = active ? active.i : n - 1;
      const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
      if (e.key === 'Escape') return hideCrosshair();
      if (next === undefined) return;
      e.preventDefault(); showCrosshair(Math.max(0, Math.min(n - 1, next)));
    });
  }

  function renderCats() {
    const cats = F.byCategory(state.txs, F.periodRange(state.period, state.today), 'expense', calcOpts());
    const tot = sum(cats.map(c => c.amount));
    $('#catTotal').innerHTML = `<span class="mono" style="color:var(--text)">${fmt(tot, 0)}</span> in period`;
    const active = state.filter.category !== 'all' ? state.filter.category : null;
    $('#stack').className = 'stack' + (active ? ' f' : '');
    $('#stack').innerHTML = cats.map(c => `<i style="flex:${c.amount};background:${catColor(c.category)}" class="${c.category === active ? 'on' : ''}"></i>`).join('');
    $('#cats').innerHTML = cats.length ? cats.map(c => {
      const share = tot > 0 ? c.amount / tot : 0;
      const onSegs = Math.max(1, Math.round(share * 12));
      return `<div class="cat ${c.category === active ? 'on' : ''}" role="button" tabindex="0" aria-pressed="${c.category === active}" data-c="${esc(c.category)}" title="${esc(c.category)}: ${fmt(c.amount)} (${(share * 100).toFixed(1)}%)"><span class="sw" style="background:${catColor(c.category)}"></span><span class="nm">${esc(c.category)}</span><span class="px-bar sm" aria-hidden="true">${segCells('cat:' + c.category, 12, onSegs, 'on')}</span><span class="mono sub pct">${(share * 100).toFixed(0)}%</span><span class="mono val">${fmt(c.amount, 0)}</span></div>`;
    }).join('')
      : '<p class="sub">No expenses in this period.</p>';
  }

  const ra = (kind, id, label) => `<div class="ra"><button data-${kind}edit="${esc(id)}" aria-label="Edit ${esc(label)}" title="Edit">✎</button><button class="del" data-${kind}del="${esc(id)}" aria-label="Delete ${esc(label)}" title="Delete">✕</button></div>`;

  function renderBudget() {
    const m = F.monthlyBudgetStatus(state.txs, state.settings, state.today, state.fx), p = m.pct / 100;
    const curMonthName = monthLong(state.today);
    $('#budMonth').textContent = monthName(state.today.slice(0, 7));
    $('#budMonth').title = curMonthName;
    if ($('#budMonthFull')) $('#budMonthFull').textContent = curMonthName;
    $('#budLabel').textContent = `Spent of ${fmt(m.limit, 0)}`;
    const N = 40, on = Math.min(N, Math.ceil(p * N - 1e-9)), prev = Math.min(segPrev.get('ring') ?? 0, on); let s = '';
    segPrev.set('ring', on);
    const ringColor = m.over ? 'var(--danger)' : m.warning ? 'var(--warn)' : 'var(--pos)';
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2, r = 62, x = 75 + r * Math.cos(a), yy = 75 + r * Math.sin(a), fresh = i < on && i >= prev;
      const isLead = i === on - 1;
      const cls = (fresh ? 'fresh ' : '') + (isLead ? 'lead ' : '');
      const clsAttr = cls ? ` class="${cls.trim()}"` : '';
      s += `<rect x="${x - 4}" y="${yy - 4}" width="8" height="8"${clsAttr}${fresh ? ` style="--k:${i - prev};fill:` : ' style="fill:'}${i < on ? ringColor : 'var(--surface-2)'}" transform="rotate(${i / N * 360} ${x} ${yy})"/>`;
    }
    const ringAmt = fmt(m.spent, 0);
    const ringFs = ringAmt.length > 9 ? 14 : ringAmt.length > 7 ? 16 : 19;
    s += `<text x="75" y="72" text-anchor="middle" style="fill:var(--text);font:600 ${ringFs}px var(--font-mono)">${ringAmt}</text>`
      + `<text x="75" y="89" text-anchor="middle" style="font-size:10.5px;fill:${m.over ? 'var(--danger)' : m.warning ? 'var(--warn)' : 'var(--muted)'}">${m.pct.toFixed(0)}% used</text>`
      + `<text x="75" y="103" text-anchor="middle" style="font-size:10.5px">${m.over ? fmt(-m.remaining, 0) + ' over' : fmt(m.remaining, 0) + ' left'}</text>`;
    $('#ring').innerHTML = s;
    $('#ring').setAttribute('aria-label', `${fmt(m.spent, 0)} spent of ${fmt(m.limit, 0)} monthly budget`);

    const rows = F.budgetStatus(state.txs, state.budgets, state.today, calcOpts());
    $('#budgets').innerHTML = rows.length ? rows.map(b => {
      const statusCls = b.over ? 'danger' : b.warning ? 'warning' : 'ok';
      const statusText = b.over ? 'Over budget' : b.warning ? 'Near limit' : 'On track';
      const remText = b.over ? `<span class="neg">${fmt(-b.remaining, 0)} over</span>` : `${fmt(b.remaining, 0)} left`;
      const rSegCls = b.over ? 'over' : b.warning ? 'warn' : 'on';
      return `<div class="brow st-${statusCls}" title="${esc(b.category)}: ${fmt(b.spent)} of ${fmt(b.limit, 0)}">
        <div class="brow-top">
          <span class="nm">${esc(b.category)}</span>
          <span class="b-status ${statusCls}">${statusText}</span>
          <span class="mono pct ${b.over ? 'neg' : 'sub'}">${Math.round(b.pct)}%</span>
          ${ra('b', b.id, b.category + ' budget')}
        </div>
        <div class="brow-bot">
          <span class="px-bar" aria-hidden="true">${segCells('b:' + b.category, 16, Math.min(16, Math.round((b.pct / 100) * 16)), rSegCls)}</span>
          <span class="mono sub amt-lbl">${fmt(b.spent, 0)} / ${fmt(b.limit, 0)}<span class="full"> · ${remText}</span></span>
        </div>
      </div>`;
    }).join('') : '<p class="sub" style="padding:10px 0;border-top:1px solid var(--line)">No category budgets yet. Add one to track a category against a monthly limit.</p>';

    const allExpCats = F.allCategories('expense', state.settings);
    const fullCats = state.budgets.length >= allExpCats.length;
    $('#addBudget').hidden = fullCats;
    if ($('#addBudgetFull')) {
      $('#addBudgetFull').disabled = fullCats;
      $('#addBudgetFull').title = fullCats ? 'All categories have budgets' : '';
    }

    // Dedicated Budgets View
    const totalBudgeted = sum(rows.map(b => b.limit));
    const totalSpentBudgeted = sum(rows.map(b => b.spent));
    const totalRemainingBudgeted = totalBudgeted - totalSpentBudgeted;
    const overallPct = totalBudgeted > 0 ? (totalSpentBudgeted / totalBudgeted) * 100 : 0;
    const overallStatus = totalSpentBudgeted > totalBudgeted ? 'danger' : overallPct >= 80 ? 'warn' : 'ok';

    if ($('#bmTotalBudget')) {
      setMoney($('#bmTotalBudget'), totalBudgeted, 0);
      setMoney($('#bmTotalSpent'), totalSpentBudgeted, 0);
      $('#bmTotalRemaining').textContent = totalRemainingBudgeted >= 0 ? fmt(totalRemainingBudgeted, 0) : `−${fmt(-totalRemainingBudgeted, 0)}`;
      $('#bmTotalRemaining').classList.toggle('neg', totalRemainingBudgeted < 0);
      $('#bmPercentUsed').textContent = `${Math.round(overallPct)}%`;
      $('#bmPercentUsed').classList.toggle('neg', totalSpentBudgeted > totalBudgeted);
      if ($('#budOverallBar')) {
        const segCls = overallStatus === 'danger' ? 'over' : overallStatus === 'warn' ? 'warn' : 'on';
        const onSegs = totalBudgeted > 0 ? Math.min(24, Math.round((overallPct / 100) * 24)) : 0;
        $('#budOverallBar').innerHTML = segCells('bud-overall', 24, onSegs, segCls);
      }
      $('#budCountFull').textContent = `${state.budgets.length} of ${allExpCats.length} categories budgeted`;
    }

    if ($('#budgetsGrid')) {
      $('#budgetsGrid').innerHTML = rows.length ? rows.map(b => {
        const statusCls = b.over ? 'danger' : b.warning ? 'warning' : 'ok';
        const statusText = b.over ? 'Over budget' : b.warning ? 'Near limit' : 'On track';
        const remText = b.over ? `<span class="neg">${fmt(-b.remaining, 0)} over limit</span>` : `${fmt(b.remaining, 0)} remaining`;
        const bSegCls = b.over ? 'over' : b.warning ? 'warn' : 'on';
        const bSegOn = Math.min(16, Math.round((b.pct / 100) * 16));
        return `<div class="bcard st-${statusCls}">
          <div class="bcard-head">
            <div class="bcard-ico" style="background:${catColor(b.category)}">${esc(b.category.slice(0, 1))}</div>
            <div class="bcard-name">${esc(b.category)}</div>
            <span class="b-status ${statusCls}">${statusText}</span>
          </div>
          <div class="bcard-amounts">
            <div>
              <div class="bcard-spent mono ${b.over ? 'neg' : ''}">${fmt(b.spent, 0)}</div>
              <div class="bcard-limit mono">Budget: ${fmt(b.limit, 0)}</div>
            </div>
            <div class="mono" style="font-weight:700;font-size:16px;color:${b.over ? 'var(--danger)' : b.warning ? 'var(--warn)' : 'var(--pos)'}">${Math.round(b.pct)}%</div>
          </div>
          <div class="px-bar" aria-label="${Math.round(b.pct)}% of ${esc(b.category)} budget used">${segCells('bcard:' + b.category, 16, bSegOn, bSegCls)}</div>
          <div class="bcard-foot">
            <span class="mono">${remText}</span>
            ${ra('b', b.id, b.category + ' budget')}
          </div>
        </div>`;
      }).join('') : '<p class="sub" style="grid-column:1/-1;padding:24px;text-align:center">No category budgets yet. Click "+ Add Category Budget" to track monthly spending limits.</p>';
    }
  }

  function renderGoals() {
    const totalTarget = convFromUSD(sum(state.goals.map(g => g.target)));
    const totalSaved = convFromUSD(sum(state.goals.map(g => g.saved)));
    const totalRemaining = Math.max(0, totalTarget - totalSaved);
    const overallSavedPct = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;
    const totalMonthlyReq = convFromUSD(sum(state.goals.map(g => F.suggestedContribution(g, state.today, 12))));

    if ($('#gmTarget')) {
      setMoney($('#gmTarget'), totalTarget, 0);
      setMoney($('#gmSaved'), totalSaved, 0);
      $('#gmSavedPct').textContent = `${Math.floor(overallSavedPct)}% of total target`;
      setMoney($('#gmRemaining'), totalRemaining, 0);
      $('#gmMonthlyReq').textContent = `${fmt(totalMonthlyReq, 0)}/mo`;
      $('#goalsCountFull').textContent = `${state.goals.length} active savings goal${state.goals.length === 1 ? '' : 's'}`;
    }

    // Overview goals list — compact single-column rows inside the "Savings goals" card
    $('#goalList').innerHTML = state.goals.length ? state.goals.map((g, idx) => {
      const p = F.goalProgress(g, state.today), on = p.done ? 12 : Math.floor(p.pct / 100 * 12);
      const gSaved = convFromUSD(g.saved);
      const gTarget = convFromUSD(g.target);
      const gRem = convFromUSD(p.remaining);
      const gPerMonth = p.perMonth !== null ? convFromUSD(p.perMonth) : null;
      const gSuggested = convFromUSD(F.suggestedContribution(g, state.today, 12));
      const suggested = p.done ? '<b>Goal reached ✓</b>'
        : p.overdue ? `<span class="neg">Overdue · was due ${monthLong(g.deadline)}</span>`
        : gPerMonth !== null ? `<b>${fmt(gPerMonth, 0)}/mo</b> to finish by ${monthLong(g.deadline)}`
        : `<b>${fmt(gSuggested, 0)}/mo</b> suggested (12-mo pace)`;
      return `<article class="goal${idx === 0 ? ' featured' : ''}" aria-label="${esc(g.name)}">
        <div class="goal-head">
          <span class="pix" style="font-size:10px;color:var(--muted)">${esc(g.tag)}</span>
          <span class="gname">${esc(g.name)}</span>
          <span class="badge ${p.pct >= 90 ? 'up' : ''}" style="${p.pct < 90 ? 'color:var(--muted)' : ''}">${Math.floor(p.pct)}%</span>
        </div>
        <div class="px" aria-hidden="true">${segCells('g:' + g.id, 12, on, p.overdue ? 'warn' : 'on')}</div>
        <div class="goal-meta"><span><span class="mono" style="color:var(--text);font-weight:600">${fmt(gSaved, 0)}</span> <span class="sub">/ ${fmt(gTarget, 0)}</span></span><span class="mono sub">${fmt(gRem, 0)} to go</span></div>
        <div class="goal-sug mono">${suggested}</div>
        <div class="gact">
          <button class="btn sm pri" data-gaction="deposit" data-gid="${esc(g.id)}" aria-label="Contribute to ${esc(g.name)}">+ Contribute</button>
          <button class="btn sm dk" data-gaction="withdraw" data-gid="${esc(g.id)}" aria-label="Withdraw from ${esc(g.name)}">− Withdraw</button>
          ${ra('g', g.id, g.name)}
        </div>
      </article>`;
    }).join('') : '<p class="sub" style="padding:12px 0;border-top:1px solid var(--line)">No savings goals yet. Use “+ New goal” to create one.</p>';

    // Dedicated Goals View Grid
    if ($('#goalsGridFull')) {
      $('#goalsGridFull').innerHTML = state.goals.map(g => {
        const p = F.goalProgress(g, state.today);
        const gSaved = convFromUSD(g.saved);
        const gTarget = convFromUSD(g.target);
        const gRem = convFromUSD(p.remaining);
        const gPerMonth = p.perMonth !== null ? convFromUSD(p.perMonth) : null;
        const gSuggested = convFromUSD(F.suggestedContribution(g, state.today, 12));
        const suggested = p.done ? 'Goal reached ✓'
          : p.overdue ? `Overdue · was due ${monthLong(g.deadline)}`
          : gPerMonth !== null ? `${fmt(gPerMonth, 0)}/mo required to reach target by ${monthLong(g.deadline)} (${p.monthsLeft} mo left)`
          : `${fmt(gSuggested, 0)}/mo (suggested 12-mo target)`;
        const gSegOn = p.done ? 16 : Math.min(16, Math.floor((p.pct / 100) * 16));
        const gSegCls = p.overdue ? 'warn' : 'on';
        return `<div class="gcard">
          <div class="gcard-head">
            <span class="gcard-tag">${esc(g.tag)}</span>
            <span class="badge ${p.pct >= 90 ? 'up' : ''}" style="${p.pct < 90 ? 'color:var(--muted)' : ''}">${Math.floor(p.pct)}% completed</span>
          </div>
          <div>
            <div class="gcard-title">${esc(g.name)}</div>
            <div class="sub mono" style="margin-top:2px">${g.deadline ? `Target date: ${monthLong(g.deadline)}` : 'No deadline set'}</div>
          </div>
          <div class="px-bar" aria-label="${Math.floor(p.pct)}% of ${esc(g.name)} goal saved">${segCells('gcard:' + g.id, 16, gSegOn, gSegCls)}</div>
          <div class="gcard-progress">
            <div><span class="mono" style="color:var(--text);font-weight:700;font-size:16px">${fmt(gSaved, 0)}</span> <span class="sub">saved</span></div>
            <div class="sub mono">Target: ${fmt(gTarget, 0)} · ${fmt(gRem, 0)} to go</div>
          </div>
          <div class="g-suggested mono">${suggested}</div>
          <div class="gcard-actions">
            <button class="btn sm pri" data-gaction="deposit" data-gid="${esc(g.id)}">+ Contribute</button>
            <button class="btn sm dk" data-gaction="withdraw" data-gid="${esc(g.id)}">− Withdraw</button>
            <div style="flex:1"></div>
            ${ra('g', g.id, g.name)}
          </div>
        </div>`;
      }).join('') + '<button class="gcard addgoal" data-gnew style="min-height:220px;border-style:dashed">+ Add New Savings Goal</button>';
    }
  }
  function renderStreak() {
    const k = F.savingStreak(state.txs, state.today, 30, calcOpts());
    $('#lvl').textContent = `LEVEL ${k} SAVER`;
    $('#streakTitle').textContent = k ? `${k}-month saving streak` : 'Start a saving streak this month';
  }

  function renderFilterBar() {
    const bar = $('#activeFilterBar');
    if (!bar) return;
    const pills = [];
    if (state.filter.type !== 'all') {
      pills.push(`<span class="active-filter-pill">Type: ${esc(state.filter.type)} <button type="button" data-clear-type aria-label="Clear type filter">✕</button></span>`);
    }
    if (state.filter.category !== 'all') {
      pills.push(`<span class="active-filter-pill">Category: ${esc(state.filter.category)} <button type="button" id="clearCatFilter" aria-label="Clear category filter">✕</button></span>`);
    }
    if (state.filter.query && state.filter.query.trim()) {
      pills.push(`<span class="active-filter-pill">Search: "${esc(state.filter.query.trim())}" <button type="button" data-clear-query aria-label="Clear search filter">✕</button></span>`);
    }
    if (pills.length) {
      pills.push(`<button type="button" class="clear-all-btn" id="clearAllFilters">Clear all</button>`);
      bar.innerHTML = pills.join('');
      bar.hidden = false;
    } else {
      bar.innerHTML = '';
      bar.hidden = true;
    }
  }

  function renderQuickAdd() {
    const qaSec = $('#quickAddSection');
    if (!qaSec) return;
    const qaTypeEl = $('#qaType'), qaCatEl = $('#qaCat'), recEl = $('#qaRecentCats');
    if (!qaTypeEl || !qaCatEl) return;
    const type = qaTypeEl.value || 'expense';
    const opts = F.allCategories(type, state.settings);
    const curCat = qaCatEl.value;
    const recents = Array.isArray(state.settings.recentCategories) ? state.settings.recentCategories : [];
    const defaultCat = recents.find(c => opts.includes(c)) || (type === 'income' ? 'Salary' : 'Groceries');
    fillSelect(qaCatEl, opts, opts.includes(curCat) ? curCat : defaultCat);

    const qaAcct = type === 'income' ? 'Checking' : 'Visa •4021';
    const qaAcctCurr = F.accountCurrency(qaAcct, state.settings);
    const qaSymEl = qaSec.querySelector('.money span');
    if (qaSymEl && F.CURRENCIES && F.CURRENCIES[qaAcctCurr]) {
      qaSymEl.textContent = F.CURRENCIES[qaAcctCurr].symbol;
    }

    if (recEl) {
      const allInc = F.allCategories('income', state.settings);
      const allExp = F.allCategories('expense', state.settings);
      const validRecents = recents.filter(c => allInc.includes(c) || allExp.includes(c));
      const chips = validRecents.length ? validRecents : ['Groceries', 'Dining out', 'Transport', 'Utilities', 'Salary'];
      recEl.innerHTML = `<span class="lbl">Quick category:</span>` + chips.map(c => {
        const isInc = allInc.includes(c) && !allExp.includes(c);
        const active = qaCatEl.value === c && qaTypeEl.value === (isInc ? 'income' : 'expense');
        return `<button type="button" class="qa-chip${active ? ' on' : ''}" data-qacat="${esc(c)}" data-qatype="${isInc ? 'income' : 'expense'}">${esc(c)}</button>`;
      }).join('');
    }
  }

  function renderRecurring() {
    const recList = $('#recurringList'), upList = $('#upcomingList'), countLbl = $('#recCountLabel');
    if (!recList || !upList) return;
    const rules = state.recurring || [];
    const activeCount = rules.filter(r => !r.paused).length;
    if (countLbl) countLbl.textContent = rules.length ? `${activeCount} active · ${rules.length} total` : 'None configured';

    recList.innerHTML = rules.length ? rules.map(r => {
      const next = F.nextOccurrence(r, state.today);
      const inc = r.type === 'income';
      const freqLabel = r.frequency.charAt(0).toUpperCase() + r.frequency.slice(1);
      const ruleCurr = r.currency || F.accountCurrency(r.account, state.settings);
      const nativeStr = F.formatCurrency(r.amount, ruleCurr);
      const convAmt = F.convertAmount(r.amount, ruleCurr, repCurr(), state.fx);
      const convSub = ruleCurr !== repCurr() && convAmt !== null ? `<div class="sub mono" style="font-size:10px">≈ ${fmt(convAmt)}</div>` : '';
      let statusBadge = '';
      if (r.paused) {
        statusBadge = `<span class="st pend">Paused</span>`;
      } else if (!next) {
        statusBadge = `<span class="st" style="color:var(--muted)">Ended</span>`;
      } else {
        statusBadge = `<span class="st ok">Next: ${esc(fmtDate(next))}</span>`;
      }
      const endInfo = r.endDate ? ` · until ${esc(fmtDate(r.endDate))}` : '';
      return `<div class="rec-item${r.paused ? ' paused' : ''}">
        <span class="mi" style="width:28px;height:28px;border-radius:var(--r-sm);display:grid;place-items:center;font:600 10px var(--font-mono);background:${inc ? 'var(--pos-ghost)' : 'var(--surface-2)'};color:${inc ? 'var(--pos)' : catColor(r.category)}">${esc(r.description.slice(0, 2).toUpperCase())}</span>
        <div class="rec-meta">
          <div class="rec-title">
            <span>${esc(r.description)}</span>
            <span class="chip" style="padding:1px 6px;font-size:10px">${esc(freqLabel)}</span>
            ${statusBadge}
          </div>
          <div class="rec-sub mono">${esc(r.category)} · ${esc(r.account)} (${esc(ruleCurr)}) · starts ${esc(fmtDate(r.startDate))}${endInfo}</div>
        </div>
        <div style="text-align:right">
          <div class="mono ${inc ? 'pos' : ''}" style="font-weight:600;font-size:13px">${inc ? '+' : '−'}${nativeStr}</div>
          ${convSub}
        </div>
        <div class="ra" style="opacity:1">
          <button type="button" data-rpause="${esc(r.id)}" title="${r.paused ? 'Resume schedule' : 'Pause schedule'}" aria-label="${r.paused ? 'Resume' : 'Pause'} ${esc(r.description)}">${r.paused ? '▶' : '⏸'}</button>
          <button type="button" data-redit="${esc(r.id)}" title="Edit schedule" aria-label="Edit ${esc(r.description)}">✎</button>
          <button type="button" class="del" data-rdel="${esc(r.id)}" title="Cancel schedule" aria-label="Cancel ${esc(r.description)}">✕</button>
        </div>
      </div>`;
    }).join('') : `<div class="sub" style="padding:14px 4px;line-height:1.5">No recurring schedules yet. Set up recurring rent, salary, subscriptions, or utilities to auto-post due entries and preview upcoming bills.</div>`;

    // Combine upcoming recurring occurrences (next 90 days) + future-dated manual transactions
    const upcomingFromRules = F.upcomingOccurrences(rules, state.today, 90, 6);
    const futureManual = state.txs
      .filter(t => t.date > state.today)
      .map(t => ({
        recurringId: null,
        txId: t.id,
        date: t.date,
        type: t.type,
        amount: t.amount,
        currency: F.txCurrency(t, state.settings),
        description: t.description,
        category: t.category,
        account: t.account,
        frequency: 'one-off',
      }));
    const combined = [...upcomingFromRules, ...futureManual].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);

    upList.innerHTML = combined.length ? combined.map(u => {
      const inc = u.type === 'income';
      const tag = u.frequency === 'one-off' ? 'Scheduled tx' : u.frequency;
      const uCurr = u.currency || F.accountCurrency(u.account, state.settings);
      const nativeStr = F.formatCurrency(u.amount, uCurr);
      return `<div class="up-item">
        <span class="st pend" style="font-size:10px">Scheduled</span>
        <div class="rec-meta">
          <div class="rec-title">
            <span>${esc(u.description)}</span>
            <span class="sub mono" style="font-weight:400">(${esc(tag)})</span>
          </div>
          <div class="rec-sub mono">Due ${esc(fmtDate(u.date))} · ${esc(u.category)} · ${esc(u.account)}</div>
        </div>
        <div class="mono ${inc ? 'pos' : ''}" style="font-weight:600;font-size:13px">${inc ? '+' : '−'}${nativeStr}</div>
      </div>`;
    }).join('') : `<div class="sub" style="padding:14px 4px;line-height:1.5">No upcoming scheduled transactions in the next 90 days. Active recurring schedules and future-dated transactions will appear here.</div>`;
  }

  function renderTable() {
    const rows = F.sortTransactions(F.filterTransactions(state.txs, state.filter), state.sortKey, state.sortDir);
    const full = state.view === 'transactions';
    const shown = full ? rows : rows.slice(0, PAGE);
    $('#tableTitle').textContent = full ? 'All transactions' : 'Recent transactions';
    const filtered = Boolean(state.filter.query || state.filter.type !== 'all' || state.filter.category !== 'all');
    const rCurr = repCurr();
    $('#tbody').innerHTML = shown.length ? shown.map(t => {
      const future = t.date > state.today, inc = t.type === 'income';
      const recBadge = t.recurringId ? `<span class="chip" style="padding:0 5px;font-size:9.5px;margin-left:5px" title="Generated by recurring schedule">⟳ Auto</span>` : '';
      const tCurr = F.txCurrency(t, state.settings);
      const acctCurr = F.accountCurrency(t.account, state.settings);
      const nativeFormatted = F.formatCurrency(t.amount, tCurr);
      const resolvedRep = F.resolveTxAmount(t, calcOpts());
      const showConv = tCurr !== rCurr;
      const convHtml = showConv
        ? (resolvedRep !== null
            ? `<div class="sub mono" style="font-size:10px;font-weight:400">≈ ${inc ? '+' : '−'}${fmt(resolvedRep)} ${esc(rCurr)}</div>`
            : `<div class="sub mono neg" style="font-size:10px;font-weight:400">Conversion unavailable</div>`)
        : (t.originalCurrency && t.originalCurrency !== tCurr
            ? `<div class="sub mono" style="font-size:10px;font-weight:400" title="Originally recorded in ${esc(t.originalCurrency)}">Orig: ${F.formatCurrency(t.originalAmount, t.originalCurrency)}</div>`
            : '');
      return `<tr><td><div class="merch"><span class="mi" style="background:${inc ? 'var(--pos-ghost)' : 'var(--surface-2)'};color:${inc ? 'var(--pos)' : catColor(t.category)}" aria-hidden="true">${esc(t.description.slice(0, 2).toUpperCase())}</span><div><div>${esc(t.description)}${recBadge}</div><div class="mob-meta">${esc(t.category)} · ${esc(t.account)} (${esc(acctCurr)})${future ? ' · Scheduled' : ''}</div>${t.note ? `<div class="sub">${esc(t.note)}</div>` : ''}</div></div></td>
        <td class="sub col-cat"><span class="typetag" style="background:${inc ? 'var(--pos)' : 'var(--danger)'}" title="${t.type}"></span>${esc(t.category)}</td>
        <td class="sub col-acct">${esc(t.account)} <span class="mono" style="font-size:10px;opacity:.75">${esc(acctCurr)}</span></td>
        <td class="mono sub">${esc(fmtDate(t.date))}</td>
        <td class="col-status"><span class="st ${future ? 'pend' : 'ok'}">${future ? 'Scheduled' : 'Cleared'}</span></td>
        <td class="amt ${inc ? 'pos' : ''}"><span style="position:absolute;left:-9999px">${t.type}</span>${inc ? '+' : '−'}${nativeFormatted}${convHtml}</td>
        <td><div class="ra"><button data-edit="${esc(t.id)}" aria-label="Edit ${esc(t.description)}" title="Edit">✎</button><button class="del" data-del="${esc(t.id)}" aria-label="Delete ${esc(t.description)}" title="Delete">✕</button></div></td></tr>`;
    }).join('') : `<tr><td colspan="7" class="empty"><div>${state.txs.length ? 'No transactions match your filters.' : 'No transactions yet. Add your first income or expense to get started.'}</div>${filtered ? '<div style="margin-top:6px"><button type="button" class="btn sm dk" id="resetFiltersBtn">Reset filters</button></div>' : ''}</td></tr>`;
    $('#count').textContent = `Showing ${shown.length} of ${rows.length}${filtered ? ' matching' : ''} transaction${rows.length === 1 ? '' : 's'}`;
    $('#moreBtn').hidden = full || rows.length <= PAGE;
    document.querySelectorAll('th[data-k]').forEach(th => {
      const b = th.querySelector('button');
      const arr = b.querySelector('.sort-arr');
      if (arr) arr.remove();
      b.textContent = b.textContent.replace(/ [↑↓]$/, '').trim();
      if (th.dataset.k === state.sortKey) {
        const s = document.createElement('span');
        s.className = 'sort-arr';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = state.sortDir > 0 ? '↑' : '↓';
        b.appendChild(s);
      }
      th.setAttribute('aria-sort', th.dataset.k === state.sortKey ? (state.sortDir > 0 ? 'ascending' : 'descending') : 'none');
    });
  }

  /* ---------- navigation ---------- */
  const VIEWS = ['overview', 'transactions', 'budgets', 'goals', 'reports'];
  function setView(v) {
    const prev = state.view;
    state.view = VIEWS.includes(v) ? v : 'overview';
    document.body.dataset.view = state.view;
    document.querySelectorAll('#tabs button').forEach(b => { const on = b.dataset.view === state.view; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('[data-views]').forEach(el => { el.hidden = !el.dataset.views.split(' ').includes(state.view); });
    $('#row2').classList.toggle('solo', state.view !== 'overview');
    renderBudget(); renderGoals(); renderInsights(); renderChart(); renderQuickAdd(); renderRecurring(); renderTable();
    if (prev && prev !== state.view) triggerEffectD();
  }

  function triggerEffectD() {
    if (!motion() || (state.settings && state.settings.ambientMotion === false)) return;
    const target = document.querySelector(`[data-views~="${state.view}"]:not([hidden])`);
    if (!target) return;
    target.classList.remove('effect-d');
    void target.offsetWidth;
    target.classList.add('effect-d');
    setTimeout(() => target.classList.remove('effect-d'), 280);
  }
  window.addEventListener('hashchange', () => setView(location.hash.slice(2)));

  /* ---------- form ---------- */
  const dlg = $('#txDialog'), form = $('#txForm');
  function fillSelect(sel, opts, value) { sel.innerHTML = opts.map(o => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`).join(''); }
  function syncCategories(keep) {
    const type = form.type.value, opts = F.allCategories(type, state.settings);
    const recents = Array.isArray(state.settings.recentCategories) ? state.settings.recentCategories : [];
    const fallback = recents.find(c => opts.includes(c)) || (type === 'income' ? 'Salary' : 'Groceries');
    fillSelect(form.category, opts, opts.includes(keep) ? keep : fallback);
  }
  function syncTxFormCurrencySymbol(acct, tx) {
    const code = tx ? F.txCurrency(tx, state.settings) : F.accountCurrency(acct || form.account.value, state.settings);
    const sym = (F.CURRENCIES && F.CURRENCIES[code] && F.CURRENCIES[code].symbol) || '$';
    const symEl = form.querySelector('.money span');
    if (symEl) symEl.textContent = sym;
    const dec = (F.CURRENCIES && F.CURRENCIES[code] && F.CURRENCIES[code].decimals !== undefined) ? F.CURRENCIES[code].decimals : 2;
    form.amount.placeholder = dec === 0 ? '0' : '0.00';
  }
  function clearErrors(f = form) { f.querySelectorAll('.err').forEach(e => e.textContent = ''); f.querySelectorAll('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid')); }
  function showErrors(f, errors, prefix = 'e-') {
    clearErrors(f);
    let first;
    for (const [k, msg] of Object.entries(errors)) {
      const err = f.querySelector(`[data-err="${k}"]`) || $('#' + prefix + k); if (err) err.textContent = msg;
      const inp = f.elements[k]; if (inp && inp.setAttribute) { inp.setAttribute('aria-invalid', 'true'); first = first || inp; }
    }
    if (first) first.focus();
  }
  function openForm(type, tx, prefill) {
    state.editingId = tx ? tx.id : null;
    clearErrors();
    $('#txTitle').textContent = tx ? 'Edit transaction' : `Add ${type}`;
    form.type.value = tx ? tx.type : type;
    const selAcct = tx ? tx.account : (type === 'income' ? 'Checking' : 'Visa •4021');
    const txCurr = tx ? F.txCurrency(tx, state.settings) : F.accountCurrency(selAcct, state.settings);
    const dec = (F.CURRENCIES && F.CURRENCIES[txCurr] && F.CURRENCIES[txCurr].decimals !== undefined) ? F.CURRENCIES[txCurr].decimals : 2;
    form.amount.value = tx ? (tx.amount / 100).toFixed(dec) : (prefill && prefill.amount ? prefill.amount : '');
    form.description.value = tx ? tx.description : (prefill && prefill.description ? prefill.description : '');
    syncCategories((tx && tx.category) || (prefill && prefill.category));
    form.date.value = tx ? tx.date : state.today;
    fillSelect(form.account, F.ACCOUNTS, selAcct);
    syncTxFormCurrencySymbol(selAcct, tx);
    form.note.value = tx ? tx.note : '';
    dlg.showModal();
    form.amount.focus();
  }
  form.addEventListener('change', e => {
    if (e.target.name === 'type') syncCategories(form.category.value);
    if (e.target.name === 'account') syncTxFormCurrencySymbol(form.account.value, null);
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (dlg.open === false) return;
    clearErrors();
    const data = Object.fromEntries(new FormData(form));
    const acctCurr = F.accountCurrency(data.account, state.settings);
    const r = F.validate({ ...data, currency: acctCurr }, state.settings);
    if (!r.ok) return showErrors(form, r.errors);
    const dec = (F.CURRENCIES && F.CURRENCIES[acctCurr] && F.CURRENCIES[acctCurr].decimals !== undefined) ? F.CURRENCIES[acctCurr].decimals : 2;
    const normalizedAmt = dec === 0 ? Math.round(r.value.amount / 100) * 100 : r.value.amount;
    const txVal = {
      ...r.value,
      amount: normalizedAmt,
      currency: acctCurr,
      originalAmount: normalizedAmt,
      originalCurrency: acctCurr,
    };
    const wasEdit = Boolean(state.editingId);
    if (wasEdit) {
      const i = state.txs.findIndex(t => t.id === state.editingId);
      if (i >= 0) state.txs[i] = { ...state.txs[i], ...txVal, id: state.editingId };
    } else state.txs.push({ id: F.createId(), ...txVal });
    recordRecentCategory(txVal.category);
    state.editingId = null;
    persist(); renderAll();
    dlg.close();
    toast(wasEdit ? 'Transaction updated' : `${txVal.type === 'income' ? 'Income' : 'Expense'} of ${F.formatCurrency(txVal.amount, acctCurr)} added`);
  });
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === d) d.close(); }));

  /* ---------- confirm ---------- */
  const cdlg = $('#confirmDialog'); let onConfirm = null;
  function askConfirm(title, msg, fn) {
    $('#cTitle').textContent = title; $('#cMsg').textContent = msg; onConfirm = fn;
    cdlg.showModal(); $('#cCancel').focus();
  }
  $('#cCancel').onclick = () => cdlg.close();
  $('#cOk').onclick = () => { const fn = onConfirm; cdlg.close(); if (fn) fn(); };
  cdlg.addEventListener('close', () => { onConfirm = null; });
  function askDelete(tx) {
    if (!tx) return;
    const tCurr = F.txCurrency(tx, state.settings);
    askConfirm('Delete transaction?', `“${tx.description}” · ${tx.type === 'income' ? '+' : '−'}${F.formatCurrency(tx.amount, tCurr)} on ${fmtDate(tx.date)}. This cannot be undone.`, () => {
      state.txs = state.txs.filter(t => t.id !== tx.id); persist(); renderAll(); toast('Transaction deleted');
    });
  }

  /* ---------- budgets ---------- */
  const bdlg = $('#budgetDialog'), bform = $('#budgetForm'); let editingBudget = null;
  function openBudget(b) {
    editingBudget = b ? b.id : null;
    clearErrors(bform);
    $('#bTitle').textContent = b ? `Edit ${b.category} budget` : 'Add category budget';
    const used = new Set(state.budgets.filter(x => x.id !== editingBudget).map(x => x.category));
    const opts = F.allCategories('expense', state.settings).filter(c => !used.has(c));
    if (!b && opts.length === 0) {
      toast('All expense categories already have a budget.');
      return;
    }
    fillSelect(bform.category, opts, b ? b.category : opts[0]);
    const usdSym = bform.querySelector('.money span');
    if (usdSym) usdSym.textContent = '$';
    bform.limit.value = b ? (b.limit / 100).toFixed(2) : '';
    bdlg.showModal(); bform.limit.focus();
  }
  bform.addEventListener('submit', e => {
    e.preventDefault();
    if (bdlg.open === false) return;
    const r = F.validateBudget(Object.fromEntries(new FormData(bform)), state.budgets, editingBudget, state.settings);
    if (!r.ok) return showErrors(bform, r.errors);
    const wasEdit = Boolean(editingBudget);
    if (wasEdit) state.budgets = state.budgets.map(x => (x.id === editingBudget ? { id: x.id, ...r.value } : x));
    else state.budgets.push({ id: F.createId(), ...r.value });
    editingBudget = null;
    persist(); renderBudget(); renderInsights(); bdlg.close();
    toast(wasEdit ? 'Budget updated' : `${r.value.category} budget added`);
  });
  function askDeleteBudget(b) {
    if (!b) return;
    askConfirm('Delete budget?', `The ${b.category} budget (${fmt(convFromUSD(b.limit), 0)} a month) will be removed. Your transactions are not affected.`, () => {
      state.budgets = state.budgets.filter(x => x.id !== b.id); persist(); renderBudget(); renderInsights(); toast('Budget deleted');
    });
  }

  /* ---------- goals ---------- */
  const gdlg = $('#goalDialog'), gform = $('#goalForm'); let editingGoal = null;
  function openGoal(g) {
    editingGoal = g ? g.id : null;
    clearErrors(gform);
    $('#gTitle').textContent = g ? 'Edit goal' : 'New goal';
    gform.name.value = g ? g.name : '';
    gform.querySelectorAll('.money span').forEach(el => { el.textContent = '$'; });
    gform.target.value = g ? (g.target / 100).toFixed(2) : '';
    gform.saved.value = g ? (g.saved / 100).toFixed(2) : '';
    gform.deadline.value = g ? g.deadline : '';
    fillSelect(gform.tag, F.GOAL_TAGS, g ? g.tag : F.GOAL_TAGS[state.goals.length % F.GOAL_TAGS.length]);
    gdlg.showModal(); gform.name.focus();
  }
  gform.addEventListener('submit', e => {
    e.preventDefault();
    if (gdlg.open === false) return;
    const r = F.validateGoal(Object.fromEntries(new FormData(gform)));
    if (!r.ok) return showErrors(gform, r.errors);
    const wasEdit = Boolean(editingGoal);
    if (wasEdit) state.goals = state.goals.map(x => (x.id === editingGoal ? { ...x, ...r.value } : x));
    else state.goals.push({ id: F.createId(), ...r.value, createdAt: state.today });
    editingGoal = null;
    persist(); renderGoals(); renderInsights(); gdlg.close();
    toast(wasEdit ? 'Goal updated' : `Goal “${r.value.name}” created`);
  });
  function askDeleteGoal(g) {
    if (!g) return;
    askConfirm('Delete goal?', `“${g.name}” (${fmt(convFromUSD(g.saved), 0)} of ${fmt(convFromUSD(g.target), 0)} saved) will be removed. This cannot be undone.`, () => {
      state.goals = state.goals.filter(x => x.id !== g.id);
      state.contributions = state.contributions.filter(c => c.goalId !== g.id);
      persist(); renderGoals(); renderInsights(); toast('Goal deleted');
    });
  }

  /* ---------- goal actions (contribute & withdraw) ---------- */
  const gadlg = $('#goalActionDialog'), gaform = $('#goalActionForm');
  let activeGoalAction = null;

  function updateGoalActionPreview() {
    if (!activeGoalAction) return;
    const g = activeGoalAction;
    const type = gaform.type.value;
    const rawVal = gaform.amount.value.trim();
    if (!rawVal) {
      $('#gaPreview').innerHTML = `Currently saved: <b>${fmt(convFromUSD(g.saved))}</b> of ${fmt(convFromUSD(g.target))} (${Math.floor(g.saved / g.target * 100)}%)`;
      return;
    }
    const amt = F.parseAmount(rawVal, { allowZero: false });
    if (amt.error) {
      $('#gaPreview').innerHTML = `<span class="err">${esc(amt.error)}</span>`;
      return;
    }
    const cents = amt.cents;
    if (type === 'withdraw' && cents > g.saved) {
      $('#gaPreview').innerHTML = `<span class="err">Cannot withdraw more than saved (${F.formatCurrency(g.saved, 'USD')}).</span>`;
      return;
    }
    const newSaved = type === 'deposit' ? g.saved + cents : Math.max(0, g.saved - cents);
    const p = F.goalProgress({ ...g, saved: newSaved }, state.today);
    $('#gaPreview').innerHTML = `New balance: <b>${fmt(convFromUSD(newSaved))}</b> (${Math.floor(p.pct)}%) · ${fmt(convFromUSD(p.remaining))} to go`;
  }

  function openGoalAction(goal, defaultType = 'deposit') {
    if (!goal) return;
    activeGoalAction = goal;
    clearErrors(gaform);
    gaform.type.value = defaultType;
    gaform.amount.value = '';
    const symEl = gaform.querySelector('.money span');
    if (symEl) symEl.textContent = '$';
    $('#gaTitle').textContent = defaultType === 'deposit' ? `Contribute to ${goal.name}` : `Withdraw from ${goal.name}`;
    $('#gaAmountLabel').textContent = defaultType === 'deposit' ? 'Contribution amount (USD)' : 'Withdrawal amount (USD)';
    $('#gaStatusCard').innerHTML = `Currently saved: <b class="mono" style="color:var(--text)">${fmt(convFromUSD(goal.saved))}</b> of <b class="mono" style="color:var(--text)">${fmt(convFromUSD(goal.target))}</b> (${Math.floor(goal.saved / goal.target * 100)}% completed)`;
    updateGoalActionPreview();
    gadlg.showModal();
    gaform.amount.focus();
  }

  gaform.addEventListener('input', updateGoalActionPreview);
  gaform.addEventListener('change', e => {
    if (e.target.name === 'type' && activeGoalAction) {
      const isDep = e.target.value === 'deposit';
      $('#gaTitle').textContent = isDep ? `Contribute to ${activeGoalAction.name}` : `Withdraw from ${activeGoalAction.name}`;
      $('#gaAmountLabel').textContent = isDep ? 'Contribution amount (USD)' : 'Withdrawal amount (USD)';
      updateGoalActionPreview();
    }
  });

  $('#gaChips').addEventListener('click', e => {
    const b = e.target.closest('.qchip');
    if (!b) return;
    gaform.amount.value = b.dataset.val;
    updateGoalActionPreview();
  });

  gaform.addEventListener('submit', e => {
    e.preventDefault();
    if (!activeGoalAction || gadlg.open === false) return;
    const g = activeGoalAction;
    const data = Object.fromEntries(new FormData(gaform));
    const r = F.validateGoalAction(data, g.saved);
    if (!r.ok) return showErrors(gaform, r.errors);

    const cents = r.value.amount;
    const isDeposit = r.value.type === 'deposit';
    const newSaved = isDeposit ? g.saved + cents : Math.max(0, g.saved - cents);

    state.goals = state.goals.map(x => (x.id === g.id ? { ...x, saved: newSaved } : x));
    state.contributions.push({
      id: F.createId(),
      goalId: g.id,
      goalName: g.name,
      type: r.value.type,
      amount: cents,
      date: state.today,
    });
    activeGoalAction = null;
    persist();
    renderGoals();
    renderKPIs();
    renderInsights();
    gadlg.close();
    toast(`${isDeposit ? 'Contributed' : 'Withdrew'} ${fmt(convFromUSD(cents))} ${isDeposit ? 'to' : 'from'} ${g.name}`);
  });

  /* ---------- financial insights ---------- */
  function renderInsights() {
    if (!$('#insightsGrid')) return;
    const { txs, today, period: n } = state;
    const range = F.periodRange(n, today);
    const cur = F.summarize(txs, range, calcOpts());
    const bStatus = F.budgetStatus(txs, state.budgets, today, calcOpts());
    const okBudgets = bStatus.filter(b => b.status === 'ok').length;
    const warnBudgets = bStatus.filter(b => b.status === 'warning').length;
    const overBudgets = bStatus.filter(b => b.status === 'danger').length;
    const topExp = F.byCategory(txs, range, 'expense', calcOpts());
    const topCat = topExp[0];
    const streak = F.savingStreak(txs, today, 30, calcOpts());
    const totalMonthlyReq = convFromUSD(sum(state.goals.map(g => F.suggestedContribution(g, today, 12))));
    const totalTarget = convFromUSD(sum(state.goals.map(g => g.target)));
    const totalSaved = convFromUSD(sum(state.goals.map(g => g.saved)));
    const overallGoalPct = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;

    if ($('#insightsPeriod')) $('#insightsPeriod').textContent = n === 1 ? monthLong(today) : `${monthLong(range.start)} – ${monthLong(today)}`;

    const budSegOn = state.budgets.length ? Math.round((okBudgets / state.budgets.length) * 16) : 16;
    const budSegCls = overBudgets ? 'over' : warnBudgets ? 'warn' : 'on';
    const rateVal = cur.savingsRate !== null ? Math.max(0, Math.min(100, cur.savingsRate)) : 0;
    const rateSegOn = Math.round((rateVal / 60) * 16);
    const rateSegCls = cur.savingsRate !== null && cur.savingsRate < 15 ? 'over' : cur.savingsRate !== null && cur.savingsRate < 30 ? 'warn' : 'on';
    const topShare = topCat && cur.expense > 0 ? topCat.amount / cur.expense : 0;
    const topSegOn = topCat ? Math.max(1, Math.min(16, Math.round(topShare * 16))) : 0;
    const topSegCls = topShare > 0.5 ? 'over' : topShare > 0.35 ? 'warn' : 'on';
    const goalSegOn = Math.min(16, Math.floor((overallGoalPct / 100) * 16));

    $('#insightsGrid').innerHTML = `
      <div class="insight-card">
        <div class="ch" style="margin:0"><div class="ico">◎</div><div class="insight-title">Budget Adherence</div></div>
        <div class="insight-val mono ${overBudgets ? 'neg' : ''}">${overBudgets ? `${overBudgets} Over Budget` : warnBudgets ? `${warnBudgets} Near Limit` : 'All On Track'}</div>
        <div class="px-bar" aria-hidden="true">${segCells('ins-bud', 16, Math.min(16, budSegOn), budSegCls)}</div>
        <div class="insight-desc">${okBudgets} of ${state.budgets.length} budgets on track. ${overBudgets ? 'Spending adjustments recommended on exceeded categories.' : warnBudgets ? 'Monitor nearing categories for remainder of month.' : 'All category spending is well disciplined.'}</div>
        <div class="insight-badge ${overBudgets ? 'down' : 'up'}" style="margin-top:auto">${overBudgets ? 'Action Required' : 'Healthy Adherence'}</div>
      </div>

      <div class="insight-card">
        <div class="ch" style="margin:0"><div class="ico" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10.5v-9M2.5 5 6 1.5 9.5 5"/></svg></div><div class="insight-title">Savings Rate & Streak</div></div>
        <div class="insight-val mono ${cur.savingsRate !== null && cur.savingsRate < 30 ? 'neg' : ''}">${cur.savingsRate !== null ? cur.savingsRate.toFixed(1) + '%' : '—'}</div>
        <div class="px-bar" aria-hidden="true">${segCells('ins-rate', 16, Math.min(16, rateSegOn), rateSegCls)}</div>
        <div class="insight-desc">${cur.savingsRate !== null && cur.savingsRate >= 30 ? 'Exceeding the 30% savings benchmark.' : 'Below 30% target rate.'} Active ${streak}-month consecutive 30%+ streak.</div>
        <div class="insight-badge ${cur.savingsRate !== null && cur.savingsRate >= 30 ? 'up' : 'down'}" style="margin-top:auto">Level ${streak} Saver</div>
      </div>

      <div class="insight-card">
        <div class="ch" style="margin:0"><div class="ico red">▤</div><div class="insight-title">Top Expense Velocity</div></div>
        <div class="insight-val mono">${topCat ? fmt(topCat.amount, 0) : fmt(0, 0)}</div>
        <div class="px-bar" aria-hidden="true">${segCells('ins-top', 16, topSegOn, topSegCls)}</div>
        <div class="insight-desc">${topCat ? `${esc(topCat.category)} is your largest outflow (${((topCat.amount / (cur.expense || 1)) * 100).toFixed(0)}% of total expenses).` : 'No expenses recorded in this period.'}</div>
        <div class="insight-badge" style="margin-top:auto;background:var(--surface-2);color:var(--muted)">${topCat ? esc(topCat.category) : 'None'}</div>
      </div>

      <div class="insight-card">
        <div class="ch" style="margin:0"><div class="ico">★</div><div class="insight-title">Savings Goals Trajectory</div></div>
        <div class="insight-val mono">${Math.floor(overallGoalPct)}%</div>
        <div class="px-bar" aria-hidden="true">${segCells('ins-goal', 16, goalSegOn, 'on')}</div>
        <div class="insight-desc">${fmt(totalSaved, 0)} saved across ${state.goals.length} goals. ${fmt(totalMonthlyReq, 0)}/month suggested to reach all active targets.</div>
        <div class="insight-badge up" style="margin-top:auto">${state.goals.filter(g => g.saved >= g.target).length} Completed</div>
      </div>
    `;
  }

  /* ---------- single-amount dialog (monthly total, add money) ---------- */
  const adlg = $('#amountDialog'), aform = $('#amountForm'); let onAmount = null;
  function openAmount({ title, label, hint = '', value = '', onSave }) {
    clearErrors(aform);
    $('#aTitle').textContent = title; $('#aLabel').textContent = label; $('#aHint').textContent = hint;
    const symEl = aform.querySelector('.money span');
    if (symEl) symEl.textContent = '$';
    aform.amount.value = value; onAmount = onSave;
    adlg.showModal(); aform.amount.focus(); aform.amount.select();
  }
  aform.addEventListener('submit', e => {
    e.preventDefault();
    if (adlg.open === false) return;
    const r = F.parseAmount(aform.amount.value);
    if (r.error) return showErrors(aform, { amount: r.error });
    const err = onAmount(r.cents);
    if (err) return showErrors(aform, { amount: err });
    adlg.close();
  });
  function editMonthlyTotal() {
    openAmount({ title: 'Monthly budget (USD base)', label: 'Total spending limit per month (USD)', hint: 'Converted automatically when viewing in another reporting currency.',
      value: (state.settings.monthlyBudget / 100).toFixed(2),
      onSave: c => { state.settings = { ...state.settings, monthlyBudget: c }; persist(); renderBudget(); renderInsights(); renderChart(); toast(`Monthly budget set to ${fmt(convFromUSD(c), 0)}`); } });
  }

  /* ---------- quick-add bar ---------- */
  const qaForm = $('#quickAddForm');
  if (qaForm) {
    $('#qaType').addEventListener('change', () => renderQuickAdd());
    qaForm.addEventListener('submit', e => {
      e.preventDefault();
      const errEl = $('#qaError');
      if (errEl) errEl.textContent = '';
      const type = $('#qaType').value || 'expense';
      const amount = $('#qaAmount').value;
      const description = $('#qaDesc').value;
      const category = $('#qaCat').value;
      const account = type === 'income' ? 'Checking' : 'Visa •4021';
      const acctCurr = F.accountCurrency(account, state.settings);
      const r = F.validate({ type, amount, description, category, account, date: state.today, note: '', currency: acctCurr }, state.settings);
      if (!r.ok) {
        const firstMsg = Object.values(r.errors)[0] || 'Check entry fields.';
        if (errEl) errEl.textContent = firstMsg;
        return;
      }
      const dec = (F.CURRENCIES && F.CURRENCIES[acctCurr] && F.CURRENCIES[acctCurr].decimals !== undefined) ? F.CURRENCIES[acctCurr].decimals : 2;
      const normAmt = dec === 0 ? Math.round(r.value.amount / 100) * 100 : r.value.amount;
      state.txs.push({
        id: F.createId(),
        ...r.value,
        amount: normAmt,
        currency: acctCurr,
        originalAmount: normAmt,
        originalCurrency: acctCurr,
      });
      recordRecentCategory(r.value.category);
      $('#qaAmount').value = '';
      $('#qaDesc').value = '';
      persist();
      renderAll();
      toast(`Quick-logged ${r.value.type === 'income' ? 'income' : 'expense'} of ${F.formatCurrency(normAmt, acctCurr)} (${r.value.category})`);
    });
    if ($('#qaFullBtn')) {
      $('#qaFullBtn').addEventListener('click', () => {
        openForm($('#qaType').value || 'expense', null, {
          amount: $('#qaAmount').value,
          description: $('#qaDesc').value,
          category: $('#qaCat').value,
        });
      });
    }
  }

  /* ---------- recurring schedules ---------- */
  const recDlg = $('#recurringDialog'), recForm = $('#recurringForm');
  let editingRecurringId = null;

  function syncRecurringCategories(keep) {
    if (!recForm) return;
    const type = recForm.type.value || 'expense';
    const opts = F.allCategories(type, state.settings);
    fillSelect(recForm.category, opts, opts.includes(keep) ? keep : (type === 'income' ? 'Salary' : 'Housing'));
  }

  function openRecurring(rule) {
    if (!recDlg || !recForm) return;
    editingRecurringId = rule ? rule.id : null;
    clearErrors(recForm);
    $('#recTitle').textContent = rule ? 'Edit recurring schedule' : 'New recurring schedule';
    recForm.type.value = rule ? rule.type : 'expense';
    recForm.amount.value = rule ? (rule.amount / 100).toFixed(2) : '';
    recForm.frequency.value = rule ? rule.frequency : 'monthly';
    recForm.description.value = rule ? rule.description : '';
    syncRecurringCategories(rule && rule.category);
    fillSelect(recForm.account, F.ACCOUNTS, rule ? rule.account : 'Checking');
    recForm.startDate.value = rule ? rule.startDate : state.today;
    recForm.endDate.value = rule && rule.endDate ? rule.endDate : '';
    recForm.note.value = rule && rule.note ? rule.note : '';
    recDlg.showModal();
    recForm.amount.focus();
  }

  if (recForm) {
    recForm.addEventListener('change', e => {
      if (e.target.name === 'type') syncRecurringCategories(recForm.category.value);
    });
    recForm.addEventListener('submit', e => {
      e.preventDefault();
      if (recDlg.open === false) return;
      clearErrors(recForm);
      const data = Object.fromEntries(new FormData(recForm));
      const r = F.validateRecurring(data, state.settings);
      if (!r.ok) return showErrors(recForm, r.errors, 'er-');
      const wasEdit = Boolean(editingRecurringId);
      if (wasEdit) {
        state.recurring = state.recurring.map(x => (x.id === editingRecurringId ? { ...x, ...r.value, id: editingRecurringId, lastGeneratedDate: '' } : x));
      } else {
        state.recurring.push({ id: F.createId('r_'), ...r.value, paused: false, lastGeneratedDate: '', createdAt: state.today });
      }
      editingRecurringId = null;
      const mat = F.materializeRecurring(state.txs, state.recurring, state.today);
      state.txs = mat.transactions;
      state.recurring = mat.recurring;
      recordRecentCategory(r.value.category);
      persist();
      renderAll();
      recDlg.close();
      const autoMsg = mat.added.length ? ` (${mat.added.length} due occurrence${mat.added.length === 1 ? '' : 's'} posted)` : '';
      toast((wasEdit ? 'Recurring schedule updated' : `Recurring ${r.value.frequency} schedule created`) + autoMsg);
    });
  }

  function togglePauseRecurring(id) {
    const rule = state.recurring.find(x => x.id === id);
    if (!rule) return;
    rule.paused = !rule.paused;
    let addedCount = 0;
    if (!rule.paused) {
      const mat = F.materializeRecurring(state.txs, state.recurring, state.today);
      state.txs = mat.transactions;
      state.recurring = mat.recurring;
      addedCount = mat.added.length;
    }
    persist();
    renderAll();
    toast(rule.paused ? `Paused “${rule.description}”` : `Resumed “${rule.description}”${addedCount ? ` (${addedCount} due posted)` : ''}`);
  }

  function askDeleteRecurring(rule) {
    if (!rule) return;
    const rCurr = rule.currency || F.accountCurrency(rule.account, state.settings);
    askConfirm(
      'Cancel recurring schedule?',
      `“${rule.description}” (${F.formatCurrency(rule.amount, rCurr)} ${rule.frequency}) will stop generating future transactions. Already-posted transactions will remain in your history.`,
      () => {
        state.recurring = state.recurring.filter(x => x.id !== rule.id);
        persist();
        renderAll();
        toast('Recurring schedule canceled');
      }
    );
  }

  /* ---------- settings, FX rates, account denominations, custom categories & PWA ---------- */
  const setDlg = $('#settingsDialog');

  function renderFxStatusBox() {
    const lbl = $('#fxSourceLabel');
    const tbl = $('#fxRatesTable');
    const fx = state.fx || F.DEFAULT_FX_RATES;
    const stale = F.isFxStale(fx);
    if (lbl) {
      const srcName = fx.source === 'live' ? (stale ? 'Cached live rate (stale >24h)' : 'Live exchange rate feed') : 'Built-in reference rates';
      lbl.textContent = `FX Status: ${srcName} · Date: ${fx.date || state.today}`;
      lbl.style.color = fx.source === 'live' && !stale ? 'var(--pos)' : 'var(--warn)';
    }
    if (tbl && fx.rates) {
      const codes = ['EUR', 'GBP', 'JPY', 'KRW', 'CAD', 'AUD', 'KZT'];
      tbl.innerHTML = codes.map(c => {
        const r = fx.rates[c];
        return `<span class="chip" style="padding:2px 6px;font-size:10.5px">1 USD = <b>${r !== undefined ? (r >= 100 ? r.toFixed(1) : r.toFixed(4)) : 'N/A'}</b> ${esc(c)}</span>`;
      }).join('');
    }
  }

  async function refreshExchangeRates({ silent = false } = {}) {
    const btn = $('#refreshFxBtn');
    const dot = $('#footerSysDot');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="px-loader active"><i></i><i></i><i></i><i></i><i></i></span> Fetching rates…'; }
    if (dot) dot.classList.add('syncing');
    try {
      const res = await F.fetchExchangeRates(null, storage);
      if (res && res.fx) state.fx = res.fx;
      renderFxStatusBox();
      renderAll();
      if (!silent) {
        toast(res.ok ? `Live exchange rates updated (${res.fx.date})` : `Using cached/reference rates (${res.error || 'offline'})`);
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Live Rates'; }
      if (dot) dot.classList.remove('syncing');
    }
  }

  function renderAcctCurrenciesList() {
    const el = $('#acctCurrenciesList');
    if (!el) return;
    const nativeMap = F.balanceByAccountNative(state.txs, state.today, state.settings, state.fx);
    const currCodes = Object.keys(F.CURRENCIES || { USD: 1 });
    el.innerHTML = F.ACCOUNTS.map(acct => {
      const info = nativeMap[acct] || { balance: 0, currency: F.accountCurrency(acct, state.settings) };
      const curCode = info.currency;
      const opts = currCodes.map(c => `<option value="${esc(c)}"${c === curCode ? ' selected' : ''}>${esc(F.CURRENCIES[c].label)}</option>`).join('');
      return `<div class="acct-item">
        <div>
          <div style="font-weight:600;color:var(--text)">${esc(acct)}</div>
          <div class="sub mono" style="font-size:11px">Balance: <b style="color:var(--text)">${F.formatCurrency(info.balance, curCode)}</b> (${esc(curCode)})</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <label class="sub" style="font-size:11px" for="acctCurr_${esc(acct.replace(/\W+/g, '_'))}">Denomination:</label>
          <select id="acctCurr_${esc(acct.replace(/\W+/g, '_'))}" class="sel" style="height:28px;font-size:11.5px" data-acct-denom="${esc(acct)}">${opts}</select>
        </div>
      </div>`;
    }).join('');
  }

  /* ---------- account denomination confirmation dialog ---------- */
  const acctDlg = $('#acctCurrencyDialog'), acctForm = $('#acctCurrencyForm');
  let pendingAcctConversion = null;

  function updateAcctConversionPreview(account, toCurrency) {
    const previewEl = $('#acctConvPreview');
    const errEl = $('#eacct-curr');
    const confirmBtn = $('#acctConvConfirmBtn');
    if (errEl) errEl.textContent = '';
    const p = F.previewAccountCurrencyChange(state.txs, state.settings, account, toCurrency, state.fx, state.today);
    if (!p.ok) {
      pendingAcctConversion = null;
      if (confirmBtn) confirmBtn.disabled = true;
      if (errEl) errEl.textContent = p.error || 'Conversion unavailable.';
      if (previewEl) previewEl.innerHTML = `<span class="neg">${esc(p.error || 'Conversion unavailable for this currency pair.')}</span>`;
      return;
    }
    if (p.fromCurrency === p.toCurrency) {
      pendingAcctConversion = null;
      if (confirmBtn) confirmBtn.disabled = true;
      if (previewEl) previewEl.innerHTML = `<span class="sub">Account is already denominated in <b>${esc(p.toCurrency)}</b>. Select a different currency to convert.</span>`;
      return;
    }
    pendingAcctConversion = { account, toCurrency };
    if (confirmBtn) confirmBtn.disabled = false;
    const rateStr = p.rate >= 100 ? p.rate.toFixed(2) : p.rate.toFixed(4);
    const srcLabel = p.fxSource === 'live' ? 'Live FX Feed' : 'Reference FX Table';
    if (previewEl) {
      previewEl.innerHTML = `
        <div style="display:grid;gap:4px">
          <div style="display:flex;justify-content:space-between"><span class="sub">Account:</span><b style="color:var(--text)">${esc(account)} (${p.txCount} transaction${p.txCount === 1 ? '' : 's'})</b></div>
          <div style="display:flex;justify-content:space-between"><span class="sub">Exchange Rate:</span><b style="color:var(--pos)">1 ${esc(p.fromCurrency)} = ${rateStr} ${esc(p.toCurrency)}</b></div>
          <div style="display:flex;justify-content:space-between"><span class="sub">Rate Source & Date:</span><span>${esc(srcLabel)} · ${esc(p.fxDate)}</span></div>
          <div style="border-top:1px solid var(--line);margin:4px 0"></div>
          <div style="display:flex;justify-content:space-between"><span class="sub">Current Balance (${esc(p.fromCurrency)}):</span><b style="color:var(--text)">${F.formatCurrency(p.oldBalance, p.fromCurrency)}</b></div>
          <div style="display:flex;justify-content:space-between"><span class="sub">Converted Balance (${esc(p.toCurrency)}):</span><b style="color:var(--pos);font-size:13.5px">${F.formatCurrency(p.newBalance, p.toCurrency)}</b></div>
        </div>
      `;
    }
  }

  function openAcctCurrencyDialog(account, initialTargetCurrency) {
    if (!acctDlg || !acctForm) return;
    const curCode = F.accountCurrency(account, state.settings);
    const currCodes = Object.keys(F.CURRENCIES || { USD: 1 });
    const target = initialTargetCurrency && initialTargetCurrency !== curCode
      ? initialTargetCurrency
      : (currCodes.find(c => c !== curCode) || curCode);
    $('#acctConvName').textContent = account;
    $('#acctConvCurrent').textContent = (F.CURRENCIES[curCode] && F.CURRENCIES[curCode].label) || curCode;
    const sel = $('#acctConvTarget');
    if (sel) {
      sel.innerHTML = currCodes.map(c => `<option value="${esc(c)}"${c === target ? ' selected' : ''}>${esc(F.CURRENCIES[c].label)}</option>`).join('');
      sel.onchange = () => updateAcctConversionPreview(account, sel.value);
    }
    updateAcctConversionPreview(account, target);
    acctDlg.showModal();
  }

  if (acctDlg && acctForm) {
    acctDlg.addEventListener('close', () => {
      pendingAcctConversion = null;
      renderAcctCurrenciesList();
    });
    acctForm.addEventListener('submit', e => {
      e.preventDefault();
      if (!pendingAcctConversion) return;
      const { account, toCurrency } = pendingAcctConversion;
      const res = F.convertAccountCurrency(state.txs, state.settings, account, toCurrency, state.fx);
      if (!res.ok) {
        if ($('#eacct-curr')) $('#eacct-curr').textContent = res.error || 'Conversion failed.';
        return;
      }
      state.txs = res.transactions;
      state.settings = res.settings;
      pendingAcctConversion = null;
      dataVersion++;
      persist();
      renderAcctCurrenciesList();
      renderAll();
      acctDlg.close();
      toast(`Converted ${account} to ${toCurrency} (1 ${res.fromCurrency} = ${res.rate >= 100 ? res.rate.toFixed(2) : res.rate.toFixed(4)} ${toCurrency})`);
    });
  }

  function refreshCategorySelects() {
    const allCats = [...F.allCategories('income', state.settings), ...F.allCategories('expense', state.settings)];
    const prev = $('#catFilter') ? $('#catFilter').value : 'all';
    if ($('#catFilter')) {
      $('#catFilter').innerHTML = '<option value="all">All categories</option>' + allCats.map(c => `<option${c === prev ? ' selected' : ''}>${esc(c)}</option>`).join('');
    }
    renderQuickAdd();
  }

  function renderCustomCatsList() {
    const el = $('#customCatsList');
    if (!el) return;
    const cc = (state.settings && state.settings.customCategories) || { income: [], expense: [] };
    const incList = Array.isArray(cc.income) ? cc.income : [];
    const expList = Array.isArray(cc.expense) ? cc.expense : [];
    const items = [
      ...expList.map(c => ({ type: 'expense', name: c })),
      ...incList.map(c => ({ type: 'income', name: c })),
    ];
    el.innerHTML = items.length ? items.map(item => `
      <span class="cat-pill">
        <span class="typetag" style="background:${item.type === 'income' ? 'var(--pos)' : 'var(--danger)'}"></span>
        <span>${esc(item.name)}</span>
        <span class="sub">(${esc(item.type)})</span>
        <button type="button" data-del-cattype="${esc(item.type)}" data-del-catname="${esc(item.name)}" aria-label="Remove custom category ${esc(item.name)}" title="Remove">✕</button>
      </span>
    `).join('') : `<span class="sub">No custom categories added yet. Built-in categories are always available.</span>`;
  }

  function openSettings() {
    if (!setDlg) return;
    const sCurr = $('#sCurrency'), sDate = $('#sDateFormat');
    if (sCurr && F.CURRENCIES) {
      const cur = state.settings.currency || 'USD';
      sCurr.innerHTML = Object.entries(F.CURRENCIES).map(([code, meta]) => `<option value="${esc(code)}"${code === cur ? ' selected' : ''}>${esc(meta.label)}</option>`).join('');
    }
    if (sDate && F.DATE_FORMATS) {
      const cur = state.settings.dateFormat || 'short';
      const DATE_LABELS = {
        short: 'Short (Apr 10 / Apr 10, 2025)',
        iso: 'ISO 8601 (YYYY-MM-DD)',
        mdy: 'US Numeric (MM/DD/YYYY)',
        dmy: 'EU Numeric (DD/MM/YYYY)',
      };
      sDate.innerHTML = F.DATE_FORMATS.map(code => `<option value="${esc(code)}"${code === cur ? ' selected' : ''}>${esc(DATE_LABELS[code] || code)}</option>`).join('');
    }
    if ($('#ecat-name')) $('#ecat-name').textContent = '';
    const sAmbient = $('#sAmbientMotion');
    if (sAmbient) {
      sAmbient.checked = state.settings.ambientMotion !== false;
      sAmbient.onchange = e => {
        state.settings = { ...state.settings, ambientMotion: e.target.checked };
        persist();
        syncAmbientMotionState();
        toast(e.target.checked ? 'Ambient telemetry motion enabled' : 'Ambient decorative motion paused');
      };
    }
    renderFxStatusBox();
    renderAcctCurrenciesList();
    renderCustomCatsList();
    setDlg.showModal();
  }

  function syncAmbientMotionState() {
    const active = (state.settings && state.settings.ambientMotion !== false) && motion();
    document.body.classList.toggle('no-ambient-motion', !active);
  }

  function setReportingCurrency(newCode) {
    if (!F.CURRENCIES || !F.CURRENCIES[newCode]) return;
    state.settings = { ...state.settings, currency: newCode };
    dataVersion++;
    persist();
    renderAll();
    const fx = state.fx || F.DEFAULT_FX_RATES;
    const rate = F.getExchangeRate('USD', newCode, fx);
    const rateNote = newCode === 'USD' ? '1.00 USD' : (rate ? `1 USD = ${rate >= 100 ? rate.toFixed(1) : rate.toFixed(3)} ${newCode}` : 'rate unavailable');
    toast(`Reporting currency: ${newCode} (${rateNote})`);
  }

  if (setDlg) {
    if ($('#sCurrency')) {
      $('#sCurrency').addEventListener('change', e => setReportingCurrency(e.target.value));
    }
    if ($('#refreshFxBtn')) {
      $('#refreshFxBtn').addEventListener('click', () => refreshExchangeRates({ silent: false }));
    }
    setDlg.addEventListener('change', e => {
      const sel = e.target.closest('[data-acct-denom]');
      if (!sel) return;
      const acct = sel.dataset.acctDenom;
      const target = sel.value;
      const current = F.accountCurrency(acct, state.settings);
      if (target === current) return;
      openAcctCurrencyDialog(acct, target);
    });
    if ($('#sDateFormat')) {
      $('#sDateFormat').addEventListener('change', e => {
        state.settings = { ...state.settings, dateFormat: e.target.value };
        persist();
        renderAll();
        toast('Date format updated');
      });
    }
    if ($('#catAddForm')) {
      $('#catAddForm').addEventListener('submit', e => {
        e.preventDefault();
        const type = $('#catAddType').value === 'income' ? 'income' : 'expense';
        const rawName = $('#catAddName').value;
        const errEl = $('#ecat-name');
        if (errEl) errEl.textContent = '';
        const v = F.validateCategoryName(rawName, type, state.settings);
        if (!v.ok) {
          if (errEl) errEl.textContent = v.error;
          return;
        }
        const prevCC = state.settings.customCategories || { income: [], expense: [] };
        const nextList = [...(Array.isArray(prevCC[type]) ? prevCC[type] : []), v.value];
        state.settings = {
          ...state.settings,
          customCategories: {
            income: type === 'income' ? nextList : (Array.isArray(prevCC.income) ? prevCC.income : []),
            expense: type === 'expense' ? nextList : (Array.isArray(prevCC.expense) ? prevCC.expense : []),
          },
        };
        $('#catAddName').value = '';
        refreshCategorySelects();
        renderCustomCatsList();
        persist();
        renderAll();
        toast(`Added custom ${type} category “${v.value}”`);
      });
    }
  }

  /* ---------- footer info dialog (About, Help, Docs, Privacy, Terms, Feedback) ---------- */
  const infoDlg = $('#infoDialog');
  const INFO_CONTENT = F.INFO_CONTENT;

  function openInfoDialog(tab = 'about') {
    if (!infoDlg) return;
    const key = INFO_CONTENT[tab] ? tab : 'about';
    const info = INFO_CONTENT[key];
    const titleEl = $('#infoTitle') || $('#infoDialogTitle');
    const bodyEl = $('#infoContent') || $('#infoDialogBody');
    if (titleEl) titleEl.textContent = info.title;
    if (bodyEl) bodyEl.innerHTML = info.html;
    document.querySelectorAll('#infoTabs button').forEach(b => {
      const tabKey = b.dataset.infotab || b.dataset.infoTab;
      const isActive = tabKey === key;
      b.classList.toggle('on', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (key === 'feedback') {
      const recEl = $('#infoRecordSummary');
      if (recEl) recEl.textContent = `${state.txs.length} transactions · ${state.budgets.length} budgets · ${state.goals.length} goals · ${(state.recurring || []).length} recurring`;
      const fxEl = $('#infoFxSummary');
      if (fxEl && state.fx) fxEl.textContent = `${state.fx.source} (${state.fx.date}) · ${Object.keys(state.fx.rates || {}).length} currencies`;
    }
    if (!infoDlg.open) {
      infoDlg.showModal();
    }
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  function deleteCustomCategory(type, name) {
    const errEl = $('#ecat-name');
    if (errEl) errEl.textContent = '';
    const txUse = state.txs.filter(t => t.type === type && t.category === name).length;
    const budUse = type === 'expense' ? state.budgets.filter(b => b.category === name).length : 0;
    const recUse = (state.recurring || []).filter(r => r.type === type && r.category === name).length;
    const totalUse = txUse + budUse + recUse;
    if (totalUse > 0) {
      const msg = `Cannot remove “${name}” while it is used by ${totalUse} existing record(s). Reassign or delete them first.`;
      if (errEl) errEl.textContent = msg;
      toast(`“${name}” is in use by ${totalUse} record(s)`);
      return;
    }
    const prevCC = state.settings.customCategories || { income: [], expense: [] };
    const nextInc = (Array.isArray(prevCC.income) ? prevCC.income : []).filter(c => !(type === 'income' && c === name));
    const nextExp = (Array.isArray(prevCC.expense) ? prevCC.expense : []).filter(c => !(type === 'expense' && c === name));
    state.settings = {
      ...state.settings,
      customCategories: { income: nextInc, expense: nextExp },
      recentCategories: (Array.isArray(state.settings.recentCategories) ? state.settings.recentCategories : []).filter(c => c !== name),
    };
    refreshCategorySelects();
    renderCustomCatsList();
    persist();
    renderAll();
    toast(`Removed custom category “${name}”`);
  }

  /* ---------- export, backup & restore ---------- */
  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportCSV() {
    const csv = F.toCSV(state.txs);
    downloadFile(csv, `dark-forest-transactions-${state.today}.csv`, 'text/csv;charset=utf-8');
    toast(`Exported ${state.txs.length} transaction${state.txs.length === 1 ? '' : 's'} to CSV`);
  }

  function exportBackup() {
    const payload = F.createBackup({
      transactions: state.txs,
      budgets: state.budgets,
      goals: state.goals,
      contributions: state.contributions,
      recurring: state.recurring,
      settings: state.settings,
    });
    downloadFile(JSON.stringify(payload, null, 2), `dark-forest-backup-${state.today}.json`, 'application/json');
    toast(`Backup exported (${payload.transactions.length} transactions, ${payload.budgets.length} budgets, ${payload.goals.length} goals)`);
  }

  const rdlg = $('#restoreDialog'), rform = $('#restoreForm');
  let pendingRestoreRaw = null;

  function resetRestoreDialog() {
    pendingRestoreRaw = null;
    if ($('#restoreFile')) $('#restoreFile').value = '';
    if ($('#rError')) { $('#rError').textContent = ''; $('#rError').hidden = true; }
    if ($('#rPreview')) $('#rPreview').hidden = true;
    if ($('#rWarnings')) { $('#rWarnings').textContent = ''; $('#rWarnings').hidden = true; }
    if ($('#rConfirm')) $('#rConfirm').disabled = true;
  }

  function openRestoreDialog() {
    if (!rdlg) return;
    resetRestoreDialog();
    rdlg.showModal();
    if ($('#restoreFile')) $('#restoreFile').focus();
  }

  function handleRestoreFileText(rawText) {
    pendingRestoreRaw = null;
    const errEl = $('#rError'), prevEl = $('#rPreview'), warnEl = $('#rWarnings'), confirmBtn = $('#rConfirm');
    const v = F.validateBackup(rawText, state.today);
    if (!v.ok) {
      prevEl.hidden = true;
      confirmBtn.disabled = true;
      const details = v.issues && v.issues.length ? ` (${v.issues.join(' ')})` : '';
      errEl.textContent = (v.error || 'Invalid backup file.') + details;
      errEl.hidden = false;
      toast('Backup validation failed');
      return;
    }
    errEl.hidden = true;
    errEl.textContent = '';
    pendingRestoreRaw = rawText;
    const p = v.preview;
    let tsLabel = 'Not specified';
    if (p.exportedAt) {
      const dt = new Date(p.exportedAt);
      tsLabel = Number.isNaN(dt.getTime()) ? esc(p.exportedAt.slice(0, 19)) : dt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }
    $('#rStats').innerHTML = [
      ['Schema version', `v${p.version}`],
      ['Backup created', tsLabel],
      ['Transactions', String(p.transactionCount)],
      ['Recurring schedules', String(p.recurringCount || 0)],
      ['Category budgets', String(p.budgetCount)],
      ['Savings goals', String(p.goalCount)],
      ['Goal contributions', String(p.contributionCount)],
      ['Net balance (as of today)', fmt(p.netBalance)],
      ['Monthly budget limit', fmt(p.monthlyBudget, 0)],
    ].map(([k, val]) => `<div class="restore-stat"><span class="sub">${esc(k)}</span><span class="mono" style="font-weight:600">${esc(val)}</span></div>`).join('');

    if (v.warnings && v.warnings.length) {
      warnEl.textContent = v.warnings.join(' ');
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
    }
    prevEl.hidden = false;
    confirmBtn.disabled = false;
  }

  if (rdlg) {
    rdlg.addEventListener('close', () => { pendingRestoreRaw = null; });
    $('#restoreFile').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file) { resetRestoreDialog(); return; }
      if (file.size > 10 * 1024 * 1024) {
        $('#rPreview').hidden = true;
        $('#rConfirm').disabled = true;
        $('#rError').textContent = 'Backup file is too large (maximum 10 MB).';
        $('#rError').hidden = false;
        toast('Backup validation failed');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => handleRestoreFileText(String(reader.result ?? ''));
      reader.onerror = () => {
        $('#rPreview').hidden = true;
        $('#rConfirm').disabled = true;
        $('#rError').textContent = 'Could not read the selected file.';
        $('#rError').hidden = false;
        toast('Could not read backup file');
      };
      reader.readAsText(file);
    });
    rform.addEventListener('submit', e => {
      e.preventDefault();
      if (rdlg.open === false || !pendingRestoreRaw) return;
      const res = F.restoreBackup(storage, pendingRestoreRaw, state.today);
      if (!res.ok) {
        $('#rError').textContent = res.error || 'Failed to restore backup.';
        $('#rError').hidden = false;
        toast(res.error || 'Restore failed');
        return;
      }
      state.txs = res.data.transactions;
      state.budgets = res.data.budgets;
      state.goals = res.data.goals;
      state.contributions = res.data.contributions || [];
      state.recurring = res.data.recurring || [];
      state.settings = res.data.settings;
      pendingRestoreRaw = null;
      dataVersion++;
      refreshCategorySelects();
      resetAllFilters();
      renderAll();
      rdlg.close();
      toast(`Backup restored (${res.preview.transactionCount} transactions, ${res.preview.budgetCount} budgets, ${res.preview.goalCount} goals)`);
    });
  }

  /* ---------- PWA, offline indicator & install prompt ---------- */
  let deferredInstallPrompt = null;
  function initPWA() {
    const netEl = $('#netStatus');
    const updateNet = () => {
      if (!netEl) return;
      const online = navigator.onLine !== false;
      netEl.hidden = online;
      updateSystemStatus();
    };
    window.addEventListener('online', () => { updateNet(); refreshExchangeRates({ silent: true }); toast('Back online — local changes are saved in this browser.'); });
    window.addEventListener('offline', () => { updateNet(); toast('Offline mode — working from local browser storage.'); });
    updateNet();

    const installBtn = $('#installBtn');
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (installBtn) installBtn.hidden = false;
    });
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        installBtn.hidden = true;
      });
    }
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      if (installBtn) installBtn.hidden = true;
      toast('App installed — launch Dark Forest Finance from your home screen or dock.');
    });

    const swText = $('#swStateText');
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        if (swText) swText.textContent = 'Active · App shell cached for offline launch (v8)';
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('App update ready — reload the page to use the latest version.');
            }
          });
        });
      }).catch(() => {
        if (swText) swText.textContent = 'Unavailable in this context (local storage still active)';
      });
    } else if (swText) {
      swText.textContent = 'Requires HTTPS or localhost (local storage still active)';
    }
  }

  /* ---------- misc ---------- */
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  function seg(id, cb) {
    $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $(id).querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); cb(b); });
  }
  function setCategoryFilter(c, scroll = false) {
    state.filter.category = c;
    $('#catFilter').value = c;
    renderCats();
    renderTable();
    renderFilterBar();
    if (scroll) {
      const el = $('#tableTitle');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function resetAllFilters() {
    state.filter.type = 'all';
    state.filter.category = 'all';
    state.filter.query = '';
    $('#q').value = '';
    if ($('#clearSearch')) $('#clearSearch').hidden = true;
    $('#catFilter').value = 'all';
    document.querySelectorAll('#typeFilter button').forEach(b => {
      const on = b.dataset.t === 'all';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    renderCats();
    renderTable();
    renderFilterBar();
  }

  function init() {
    loadData();
    refreshCategorySelects();
    if ($('#topCurrencySelect') && F.CURRENCIES) {
      $('#topCurrencySelect').innerHTML = Object.entries(F.CURRENCIES).map(([code, meta]) => `<option value="${esc(code)}">${esc(code)} (${esc(meta.symbol)})</option>`).join('');
      $('#topCurrencySelect').value = repCurr();
      $('#topCurrencySelect').addEventListener('change', e => setReportingCurrency(e.target.value));
    }
    if ($('#fxBadge')) {
      $('#fxBadge').style.cursor = 'pointer';
      $('#fxBadge').addEventListener('click', openSettings);
    }
    document.querySelectorAll('#period button').forEach(b => { const on = +b.dataset.p === state.period; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    seg('#period', b => { state.period = +b.dataset.p; renderKPIs(); renderPixelGrid(); renderChart(); renderCats(); renderInsights(); });
    seg('#typeFilter', b => { state.filter.type = b.dataset.t; renderTable(); renderFilterBar(); });
    $('#catFilter').onchange = e => setCategoryFilter(e.target.value);
    $('#q').oninput = e => {
      state.filter.query = e.target.value;
      if ($('#clearSearch')) $('#clearSearch').hidden = !e.target.value;
      renderTable();
      renderFilterBar();
    };
    if ($('#clearSearch')) {
      $('#clearSearch').onclick = () => {
        $('#q').value = '';
        state.filter.query = '';
        $('#clearSearch').hidden = true;
        renderTable();
        renderFilterBar();
        $('#q').focus();
      };
    }
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) location.hash = '#/' + b.dataset.view; });
    $('#moreBtn').onclick = () => { location.hash = '#/transactions'; };
    $('#focusSearch').onclick = () => { if (!$('#q').offsetParent) location.hash = '#/transactions'; setTimeout(() => $('#q').focus(), 0); };
    if ($('#openSettingsBtn')) $('#openSettingsBtn').onclick = openSettings;
    document.addEventListener('click', e => {
      const infoBtn = e.target.closest('[data-open-info]');
      if (infoBtn) return openInfoDialog(infoBtn.dataset.openInfo);
      const infoTabBtn = e.target.closest('[data-infotab], [data-info-tab]');
      if (infoTabBtn) return openInfoDialog(infoTabBtn.dataset.infotab || infoTabBtn.dataset.infoTab);
      const acctCurrBtn = e.target.closest('[data-acct-curr]');
      if (acctCurrBtn) return openAcctCurrencyDialog(acctCurrBtn.dataset.acctCurr);
      if (e.target.closest('[data-trigger-csv]')) return exportCSV();
      if (e.target.closest('[data-trigger-backup]')) return exportBackup();
      if (e.target.closest('[data-trigger-restore]')) return openRestoreDialog();
      const qachip = e.target.closest('[data-qacat]');
      if (qachip) {
        const cat = qachip.dataset.qacat, t = qachip.dataset.qatype || 'expense';
        if ($('#qaType')) $('#qaType').value = t;
        renderQuickAdd();
        if ($('#qaCat')) $('#qaCat').value = cat;
        renderQuickAdd();
        if ($('#qaAmount')) $('#qaAmount').focus();
        return;
      }
      const delCat = e.target.closest('[data-del-catname]');
      if (delCat) {
        return deleteCustomCategory(delCat.dataset.delCattype, delCat.dataset.delCatname);
      }
      if (e.target.closest('[data-rnew]')) return openRecurring(null);
      const rpause = e.target.closest('[data-rpause]');
      if (rpause) return togglePauseRecurring(rpause.dataset.rpause);
      const redit = e.target.closest('[data-redit]');
      if (redit) return openRecurring(state.recurring.find(x => x.id === redit.dataset.redit));
      const rdel = e.target.closest('[data-rdel]');
      if (rdel) return askDeleteRecurring(state.recurring.find(x => x.id === rdel.dataset.rdel));
      if (e.target.closest('#resetFiltersBtn') || e.target.closest('#clearAllFilters')) {
        return resetAllFilters();
      }
      if (e.target.closest('[data-clear-type]')) {
        state.filter.type = 'all';
        document.querySelectorAll('#typeFilter button').forEach(b => {
          const on = b.dataset.t === 'all';
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', on);
        });
        renderTable();
        renderFilterBar();
        return;
      }
      if (e.target.closest('#clearCatFilter')) {
        return setCategoryFilter('all');
      }
      if (e.target.closest('[data-clear-query]')) {
        state.filter.query = '';
        $('#q').value = '';
        if ($('#clearSearch')) $('#clearSearch').hidden = true;
        renderTable();
        renderFilterBar();
        return;
      }
      const add = e.target.closest('[data-add]'); if (add) return openForm(add.dataset.add);
      const ed = e.target.closest('[data-edit]'); if (ed) return openForm(null, state.txs.find(t => t.id === ed.dataset.edit));
      const del = e.target.closest('[data-del]'); if (del) return askDelete(state.txs.find(t => t.id === del.dataset.del));
      const find = (list, id) => list.find(x => x.id === id);
      const ga = e.target.closest('[data-gaction]');
      if (ga) {
        const g = find(state.goals, ga.dataset.gid);
        if (g) return openGoalAction(g, ga.dataset.gaction);
      }
      const d = e.target.closest('[data-bedit],[data-bdel],[data-bnew],[data-btotal],[data-gedit],[data-gdel],[data-gadd],[data-gnew]');
      if (d) {
        const ds = d.dataset;
        if ('bnew' in ds) return openBudget();
        if ('btotal' in ds) return editMonthlyTotal();
        if ('gnew' in ds) return openGoal();
        if (ds.bedit) return openBudget(find(state.budgets, ds.bedit));
        if (ds.bdel) return askDeleteBudget(find(state.budgets, ds.bdel));
        if (ds.gedit) return openGoal(find(state.goals, ds.gedit));
        if (ds.gdel) return askDeleteGoal(find(state.goals, ds.gdel));
        if (ds.gadd) return openGoalAction(find(state.goals, ds.gadd), 'deposit');
      }
      const cat = e.target.closest('.cat');
      if (cat) {
        const target = cat.dataset.c === state.filter.category ? 'all' : cat.dataset.c;
        return setCategoryFilter(target, target !== 'all');
      }
    });
    $('#cats').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('cat')) { e.preventDefault(); e.target.click(); } });
    document.querySelectorAll('th[data-k] button').forEach(b => b.onclick = () => {
      const k = b.parentElement.dataset.k; state.sortDir = k === state.sortKey ? -state.sortDir : (k === 'date' || k === 'amount' ? -1 : 1); state.sortKey = k; renderTable();
    });
    $('#exportBtn').onclick = exportBackup;
    if ($('#exportCsvBtn')) $('#exportCsvBtn').onclick = exportCSV;
    if ($('#exportCsvTableBtn')) $('#exportCsvTableBtn').onclick = exportCSV;
    if ($('#restoreBtn')) $('#restoreBtn').onclick = openRestoreDialog;
    window.addEventListener('resize', () => { clearTimeout(window._r); window._r = setTimeout(() => renderChart({ animate: false }), 120); });
    document.addEventListener('visibilitychange', () => { document.body.classList.toggle('tab-inactive', document.hidden); });
    bindChart();
    initPWA();
    syncAmbientMotionState();
    reducedMotion.addEventListener('change', syncAmbientMotionState);
    renderAll();
    setView(location.hash.slice(2));
    if (F.isFxStale(state.fx) && typeof navigator !== 'undefined' && navigator.onLine !== false) {
      refreshExchangeRates({ silent: true });
    }
  }
  init();
  window.__app = {
    state,
    renderAll,
    exportCSV,
    exportBackup,
    openRestoreDialog,
    handleRestoreFileText,
    openRecurring,
    openSettings,
    setReportingCurrency,
    openAcctCurrencyDialog,
    openInfoDialog,
    refreshExchangeRates,
    INFO_CONTENT,
  }; // debugging hook
})();
