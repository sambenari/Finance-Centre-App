# Finance Centre

A local-first finance centre app for household dashboards, expenses, and savings.

## Current Build

- Dashboard overview built from saved expenses, savings, and budgets
- Expenses section with KPIs, breakdown, trend, upcoming payments, largest expenses, and budget progress
- Savings section with KPIs, goals, trend, upcoming contributions, accounts, and goal progress
- Add/edit/delete expense, saving, budget, and category flows that update browser local storage immediately
- Local password setup, unlock, household settings, birthday fields, and password change
- Retirement simulator with UK State Pension age/date and full-rate estimates from current GOV.UK data
- Local SQLite persistence through `server.py` and normalized tables in `database/schema.sql`

## Run

Run the local SQLite-backed server:

```bash
python3 server.py --host 127.0.0.1 --port 4273
```

Then visit `http://127.0.0.1:4273/`.

## Build Local Mac App

Create a local macOS app bundle:

```bash
./scripts/build-mac-app.sh
```

The bundle is created at `dist/Finance Centre.app`. Open it like any other Mac app. It starts a local-only server on `127.0.0.1:4273` and opens the app in your browser.

## Persistence Direction

The app persists through a local-only Python API backed by SQLite. Expenses, categories, budgets, savings goals, savings accounts, savings contributions, users, and household profile data are stored in normalized tables. `app_state` is retained for UI preferences/cache, and browser `localStorage` remains a fallback for direct-file development.
