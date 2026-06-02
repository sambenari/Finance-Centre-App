PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  monthly_budget_pence INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  vendor TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  expense_date TEXT NOT NULL,
  expense_type TEXT NOT NULL CHECK (expense_type IN ('recurring', 'one_off')),
  status TEXT NOT NULL CHECK (status IN ('paid', 'scheduled', 'due')),
  frequency TEXT,
  payment_count INTEGER,
  final_payment_date TEXT,
  payment_account TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS savings_goals (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_pence INTEGER NOT NULL,
  target_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (household_id, name)
);

CREATE TABLE IF NOT EXISTS savings_accounts (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_name TEXT NOT NULL,
  interest_rate_bps INTEGER NOT NULL DEFAULT 0,
  access_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS savings_contributions (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES savings_accounts(id) ON DELETE SET NULL,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount_pence INTEGER NOT NULL,
  contribution_date TEXT NOT NULL,
  contribution_type TEXT NOT NULL CHECK (contribution_type IN ('regular', 'one_off')),
  status TEXT NOT NULL CHECK (status IN ('saved', 'scheduled')),
  frequency TEXT,
  source_account TEXT,
  owner_name TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expenses_household_date ON expenses(household_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_savings_contributions_goal_date ON savings_contributions(goal_id, contribution_date);
