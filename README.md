# Dark Forest Finance

Personal finance application built in plain HTML, CSS, and JavaScript with zero external runtime dependencies and no build step.

| File | Role |
|---|---|
| `index.html` | Semantic markup, accessible dialogs, Quick-Add bar, Recurring Schedules, Settings modal, and CSS design tokens |
| `finance.js` | Pure calculation & persistence engine: validation, integer-cent math, recurring occurrence materialization, custom categories, currency/date formatting, versioned `localStorage`, CSV export, and atomic JSON backup/restore |
| `app.js` | UI controller: reactive rendering, hash navigation, Quick-Add, recurring schedules, settings, PWA install/offline state, and backup preview/restore workflow |
| `manifest.webmanifest` | Web App Manifest (`standalone` display mode, `#00110F` theme/background colors, vector app icon) |
| `sw.js` | Versioned service worker (`dark-forest-shell-v7`) for safe static app-shell caching and automatic old-cache cleanup |
| `icon.svg` | Maskable vector app icon matching the Dark Forest emerald/vivid-green pixel aesthetic |
| `render.yaml` | Render Static Site Blueprint (`runtime: static`, security headers, service worker cache headers) |
| `SYNC_ARCHITECTURE.md` | Technical specification for optional cross-device cloud synchronization, RLS security, conflict resolution, and local-to-cloud migration |
| `tests.html` | Automated test suite (60 unit, multi-currency FX & data-integrity tests for `finance.js`) |

## Running Locally & Deploying to Render

### Local Development
```bash
python3 -m http.server 8765
```

- **Application:** `http://localhost:8765`
- **Unit Test Suite:** `http://localhost:8765/tests.html`

### Publishing to Render (Static Site)
Because Dark Forest Finance is a zero-dependency client-side application (HTML, CSS, JavaScript, and Service Worker), it deploys as a **Render Static Site** via [`render.yaml`](render.yaml):
- **Build Command:** *(empty — no build step required)*
- **Publish Directory:** `.`
- **Data Storage & Privacy Boundary:** All transactions, budgets, goals, and settings are stored in the user's browser `localStorage` (`darkForestFinance`). Publishing the static site to a public HTTPS URL does **not** automatically synchronize local browser data across devices or expose any personal financial records on the web. Use **Backup JSON** / **Restore** to transfer data between devices.

---

## Installable PWA & Offline Support

- **Web App Manifest & Service Worker:** `manifest.webmanifest` and `sw.js` cache the static application shell (`index.html`, `finance.js`, `app.js`, `icon.svg`, and font assets) under a versioned cache key (`dark-forest-shell-v6`). Old caches are evicted automatically on activation so updates never leave users running stale or mismatched assets.
- **Offline Behavior:** Because all financial data lives in browser `localStorage`, viewing balances, logging transactions, managing budgets/goals, and configuring recurring schedules work offline once the app shell has been loaded. When the browser loses connectivity, a clear **`Offline · Local storage active`** indicator appears in the top bar.
- **Sensitive Data Protection:** The service worker only caches static GET assets and never caches cross-origin API responses or `POST` requests.
- **Browser Installation Support & Limitations:**
  - **Chromium (Chrome, Edge, Brave — Desktop & Android):** Supports native `beforeinstallprompt` (`⊕ Install App` button in the top navigation bar) and address-bar installation.
  - **Safari (iOS / iPadOS / macOS Sonoma+):** Does not fire `beforeinstallprompt`; install via **Share → Add to Home Screen** (iOS/iPadOS) or **File → Add to Dock** (macOS).
  - **Firefox Desktop:** Supports offline service-worker caching and local storage, but does not natively support standalone desktop PWA installation.

---

## Everyday Workflow Features

### 1. Recurring Transactions & Upcoming Scheduled View
- **Frequencies:** Configurable `weekly`, `monthly`, and `yearly` recurring income and expense schedules with a required `startDate` and optional `endDate`.
- **Month-End & Leap-Year Safety:** Monthly and yearly schedules remain anchored to their start day without cumulative drift (e.g., a schedule starting `2026-01-31` clamps to `2026-02-28`, returns to `2026-03-31`, and clamps to `2026-04-30`; a `2024-02-29` yearly schedule clamps to `2025-02-28` and returns to `2028-02-29`).
- **Idempotent Materialization (Zero Duplicates):** On load and schedule save, `F.materializeRecurring` generates due occurrences (`occurrenceDate <= today`) deterministically using `(recurringId, occurrenceDate)` and `lastGeneratedDate`. Refreshing or reopening the app never creates duplicate transactions.
- **Upcoming Scheduled vs. Posted:** Future occurrences (`> today`) appear in the **Upcoming Scheduled (Next 90d)** panel and are strictly excluded from current account balances, monthly summaries, and budget spending until their scheduled date arrives.
- **Lifecycle Controls:** Pause (`⏸`), resume (`▶`), edit (`✎`), or cancel (`✕`) any recurring schedule without deleting previously posted historical transactions.

### 2. Multi-Currency Accounting & Live FX Engine
- **Supported Currencies:** `USD ($)`, `EUR (€)`, `GBP (£)`, `JPY (¥)`, `KRW (₩)`, `CAD (CA$)`, `AUD (A$)`, and `KZT (₸)`.
- **Account Denomination vs. Reporting Currency:**
  - Each account (`Checking`, `Savings`, `Visa •4021`, `Cash`) stores its own explicit denomination currency (`settings.accountCurrencies`).
  - Each transaction preserves its `currency`, `originalAmount`, and `originalCurrency`.
  - Switching the **Reporting Currency** (top bar or **⚙ Settings**) converts dashboard KPIs, account balances, monthly cash-flow charts, category budgets, and savings goals using genuine exchange rates — never relabeling currency symbols (`$50,000` → `¥7,740,000` or `₩69,250,000`) and never mutating stored records.
  - Changing an **Account Denomination** opens a confirmation preview dialog displaying the exchange rate, rate date/source, current balance, and converted balance before applying, converting from `originalAmount` / `originalCurrency` so repeated conversions never double-convert or drift.
- **Live & Cached FX Feed:** Fetches live USD reference rates from `https://open.er-api.com/v6/latest/USD`, caches snapshots in `localStorage["darkForestFinance.fxRates"]`, detects stale rates (`>24h`), and falls back gracefully when offline.

### 3. Quick-Add Entry, Custom Categories & Display Preferences
- **Quick Entry Bar:** Log everyday expenses or income directly from the Overview or Transactions view with one-click recent category chips (`recentCategories`), defaulting to `Today` and `Checking` / `Visa •4021`.
- **Custom Categories:** Add or remove custom `expense` and `income` categories via **⚙ Settings**; custom categories work seamlessly across transactions, category budgets, filters, and recurring schedules.

---

## Design System & Accessibility

- **Palette:**
  - Primary background: `#00110F` (near-black with subtle green undertone)
  - Secondary surfaces: `#00654F` (deep emerald for structural headers, selected states, and borders)
  - Primary accent: `#00DF81` (vivid green for primary actions, active states, and positive indicators)
  - Primary text: `#F0F7F4` · Secondary text: `#9AB2A9`
- **Typography:** `IBM Plex Mono` (with `Manrope` and system monospace fallbacks) loaded from Google Fonts with `font-variant-numeric: tabular-nums` on all financial figures, dates, percentages, and table columns.
- **Stinger Pixel-Segmented Charts:** Monthly cash-flow bars, budget utilization rings, category budget meters, savings goal bars, and financial insight bars are constructed from discrete animated pixel segments with `prefers-reduced-motion: reduce` support.
- **Accessibility & Motion:** Full keyboard navigation (including arrow-key chart inspection), visible `:focus-visible` outlines, ARIA live regions and modal dialogs, and confirmation prompts for all destructive actions.

---

## Data Integrity, Backup, Recovery & Sync Architecture

### How Data Is Stored
- All financial data is stored locally in the browser under `localStorage["darkForestFinance"]` using **Schema Version 2**:
  `{ version: 2, savedAt, transactions, budgets, goals, contributions, recurring, settings }`.
- Monetary values are stored and calculated exclusively as **integer centi-units** (`$42.50` → `4250`, `¥1,500` → `150000`) to eliminate IEEE 754 floating-point rounding errors.

### Creating & Restoring Backups
1. **Full JSON Backup (`↓ Backup JSON`):** Exports all state (`transactions`, `budgets`, `goals`, `contributions`, `recurring`, and `settings`) with `"app": "dark-forest-finance"` and `"version": 2`.
2. **CSV Transaction Export (`↓ Export CSV`):** RFC 4180 compliant export with spreadsheet formula injection protection (`'`).
3. **Validated Atomic Restore (`↑ Restore`):** Validates and previews `.json` backups before replacing browser data, automatically saving a pre-restore snapshot (`darkForestFinance.backup.<timestamp>`).

### Cross-Device Synchronization Architecture
- Because this workspace is a static local-first deployment with no backend server or database credentials, live cloud sync is not active.
- See [`SYNC_ARCHITECTURE.md`](SYNC_ARCHITECTURE.md) for the complete architecture specification covering PostgreSQL Row-Level Security (RLS), OAuth2/Passkey session handling, multi-device recurring transaction deduplication, conflict resolution with tombstones, and non-destructive local-to-cloud migration.

---

## Testing & Verification Summary

- **Automated Test Suite (`tests.html`):** 60/60 tests passing:
  - Decimal-to-cents parsing and floating-point precision (`0.10 + 0.20 === 30` cents).
  - Multi-currency conversion (`USD`, `JPY`, `KRW`, `EUR`), 0-decimal integer rounding (`JPY`, `KRW`, `KZT`), and identity conversion safety.
  - Account denomination conversion (`previewAccountCurrencyChange`, `convertAccountCurrency`) preserving `originalAmount` / `originalCurrency` across `USD -> JPY -> KRW -> USD` round-trips with zero drift.
  - Mixed-currency account balances (`balanceByAccountNative`, `balanceByAccount`) and reporting currency aggregation (`summarize`, `netBalance`, `budgetStatus`, `monthlyBudgetStatus`).
  - Live FX rate fetching (`fetchExchangeRates`), offline/HTTP failure fallback to cached rates, stale rate detection (`isFxStale`), and missing currency rate handling (`null`).
  - Date boundaries across month ends, year transitions (Dec/Jan), and leap years (`2024-02-29`).
  - Recurring schedule `occurrenceDate` clamping across 28/29/30/31-day months and leap years without drift.
  - Idempotent `materializeRecurring` execution across repeated refreshes, paused schedules, and `endDate` cutoffs.
  - `upcomingOccurrences` separation from posted balances and monthly budgets.
  - Custom category validation (`validateCategoryName`, `allCategories`) and `formatCurrency` / `formatDate` formatting.
  - Calculation resilience against `null`, `NaN`, negative amounts, unknown types, and malformed objects.
  - Schema v1 → v2 migration, corrupt JSON recovery, quota failure handling, RFC 4180 CSV export, and atomic JSON backup/restore.
