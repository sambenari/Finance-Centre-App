const STORAGE_KEY = "control-finance-state-v1";
const STATE_API_URL = "/api/state";

if (window.location.hostname === "localhost") {
  window.location.replace(`http://127.0.0.1:${window.location.port || "4173"}${window.location.pathname}${window.location.hash}`);
}

const seedState = {
  route: "dashboard",
  month: currentMonthLabel(),
  userName: "",
  householdName: "",
  passwordHash: "",
  expenseFilter: "All",
  expenseView: "overview",
  expenses: [],
  expenseCategories: ["Housing", "Utilities", "Groceries", "Transport", "Subscriptions", "Leisure", "Home"],
  expenseBudgets: {},
  savingsView: "overview",
  savings: [],
};

const demoExpenseKeys = new Set(
  [
    ["Mortgage", "Housing", "2025-06-01", "Recurring", 750],
    ["Water", "Utilities", "2025-06-02", "Recurring", 35],
    ["Broadband", "Utilities", "2025-06-05", "Recurring", 45],
    ["Electricity", "Utilities", "2025-06-10", "Recurring", 86.4],
    ["Car Insurance", "Transport", "2025-06-15", "Recurring", 58.32],
    ["Sainsbury's", "Groceries", "2025-05-12", "Recurring", 124.37],
    ["Amazon.co.uk", "Subscriptions", "2025-05-03", "Recurring", 79.99],
    ["British Gas", "Utilities", "2025-05-01", "Recurring", 82.14],
    ["Trainline", "Transport", "2025-05-08", "One-off", 64.8],
    ["IKEA", "Home", "2025-05-16", "One-off", 60],
  ].map(([vendor, category, date, type, amount]) => expenseKey({ vendor, category, date, type, amount })),
);

const demoSavingKeys = new Set(
  [
    ["Emergency Fund", "Chase Saver", "2025-06-05", "Regular", 250],
    ["House Deposit", "Marcus Savings", "2025-06-01", "Regular", 500],
    ["Holiday Fund", "Monzo Pot", "2025-06-10", "Regular", 150],
    ["Education", "NS&I Income Bonds", "2025-06-15", "Regular", 175],
    ["New Car", "Barclays Rainy Day", "2025-05-18", "One-off", 50],
  ].map(([goal, account, date, type, amount]) => savingKey({ goal, account, date, type, amount })),
);

let state = loadState();
let sessionUnlocked = !state.passwordHash;
let databaseAvailable = false;
let databaseStateLoaded = false;
let pendingDatabaseSave = null;

function loadState() {
  try {
    const storedState = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return sanitizeLoadedState({ ...structuredClone(seedState), ...storedState });
  } catch {
    return structuredClone(seedState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleDatabaseSave();
}

hydrateStateFromDatabase();

async function hydrateStateFromDatabase() {
  try {
    const response = await fetch(STATE_API_URL);
    if (!response.ok) throw new Error(`State API returned ${response.status}`);
    const payload = await response.json();
    databaseAvailable = true;
    databaseStateLoaded = true;

    if (payload.state) {
      state = sanitizeLoadedState({ ...structuredClone(seedState), ...payload.state });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      sessionUnlocked = !state.passwordHash;
      render();
      return;
    }

    await persistStateToDatabase();
  } catch (error) {
    databaseAvailable = false;
    databaseStateLoaded = false;
    console.warn("SQLite persistence is unavailable; using local browser storage.", error);
  }
}

function scheduleDatabaseSave() {
  if (!databaseAvailable && !databaseStateLoaded) return;
  window.clearTimeout(pendingDatabaseSave);
  pendingDatabaseSave = window.setTimeout(() => {
    persistStateToDatabase();
  }, 150);
}

async function persistStateToDatabase() {
  if (!databaseAvailable && !databaseStateLoaded) return;

  try {
    const response = await fetch(STATE_API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!response.ok) throw new Error(`State API returned ${response.status}`);
    databaseAvailable = true;
    databaseStateLoaded = true;
  } catch (error) {
    databaseAvailable = false;
    console.warn("Could not save to SQLite; local browser storage still has the latest state.", error);
  }
}

function passwordHash(password) {
  let hash = 2166136261;
  const input = `finance-centre-local:${password}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function verifyPassword(password) {
  return Boolean(state.passwordHash) && passwordHash(password) === state.passwordHash;
}

const formatGBP = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: value % 1 ? 2 : 0,
  }).format(value);

const compactGBP = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);

const percent = (value, total) => `${total ? Math.round((value / total) * 100) : 0}%`;

const sum = (items, field = "amount") => items.reduce((total, item) => total + Number(item[field] || 0), 0);

const app = document.querySelector("#app");

const monthNames = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

const monthLabels = Object.keys(monthNames);

const navItems = [
  ["dashboard", "⌂", "Dashboard"],
  ["expenses", "◔", "Expenses"],
  ["savings", "♧", "Savings"],
  ["investments", "↗", "Investments"],
  ["pension", "☂", "Pension"],
  ["income", "▣", "Income"],
  ["retirement", "◎", "Retirement Simulator"],
  ["settings", "⚙", "Settings"],
];

function render() {
  if (!state.passwordHash) {
    app.innerHTML = setupPage();
    bindAuthEvents();
    return;
  }

  if (!sessionUnlocked) {
    app.innerHTML = lockPage();
    bindAuthEvents();
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      ${sidebar()}
      <main class="workspace">
        ${topbar()}
        <section class="content">${page()}</section>
      </main>
    </div>
  `;
  bindEvents();
}

function sidebar() {
  const activeRoute = state.route === "add-expense" ? "expenses" : state.route === "add-saving" ? "savings" : state.route;
  const householdName = state.householdName || "My Household";
  return `
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">✓</span><span class="brand-name">Finance Centre</span></div>
      <nav class="nav-list">
        ${navItems
          .map(
            ([route, icon, label]) => `
              <button class="nav-item ${activeRoute === route ? "active" : ""}" data-route="${route}">
                <span class="nav-icon">${icon}</span>${label}
              </button>
            `,
          )
          .join("")}
      </nav>
      <div class="household">
        <div class="household-label"><span>♙</span> Household</div>
        <div class="household-name"><span>${escapeHtml(householdName)}</span><span>⌄</span></div>
      </div>
      <div class="security-card">
        <div class="security-title"><span class="security-lock">⌘</span>Local profile active</div>
        <p>Password protected locally</p>
        <div class="backup">Sync not configured</div>
      </div>
    </aside>
  `;
}

function topbar() {
  const selectedDate = getSelectedMonthDate();
  const selectedMonth = selectedDate.getMonth();
  const selectedYear = selectedDate.getFullYear();
  const years = Array.from({ length: 11 }, (_, index) => selectedYear - 5 + index);

  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="month-picker">
          <span>▣</span>
          <select class="month-select" aria-label="Report month" data-report-month>
            ${monthLabels.map((label, index) => `<option value="${index}" ${index === selectedMonth ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <select class="year-select" aria-label="Report year" data-report-year>
            ${years.map((year) => `<option value="${year}" ${year === selectedYear ? "selected" : ""}>${year}</option>`).join("")}
          </select>
        </div>
        <button class="nav-arrow" aria-label="Previous month" data-month-offset="-1">‹</button>
        <button class="nav-arrow" aria-label="Next month" data-month-offset="1">›</button>
      </div>
      <div class="topbar-right">
        <div class="status-pill"><span>▣</span> Local only <span class="status-ok">✓</span></div>
        <div class="status-pill"><span>▯</span> This browser</div>
        <button class="avatar-menu" data-route="settings"><span class="avatar"></span><span>Hello, ${escapeHtml(state.userName || "User")}</span><span>⌄</span></button>
      </div>
    </header>
  `;
}

function page() {
  if (state.route === "dashboard") return dashboardPage();
  if (state.route === "expenses") return expensesPage();
  if (state.route === "savings") return savingsPage();
  if (state.route === "add-expense") return addExpensePage();
  if (state.route === "add-saving") return addSavingPage();
  if (state.route === "settings") return settingsPage();
  return placeholderPage();
}

function setupPage() {
  return `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="brand auth-brand"><span class="brand-mark">✓</span><span class="brand-name">Finance Centre</span></div>
        <h1 class="page-title">Set up your household</h1>
        <p class="page-subtitle">Create a local password and household name for this browser.</p>
        <form id="setup-form" class="form-card">
          ${field("setupUserName", "User name", "text", state.userName || "", "Your name")}
          ${field("setupHouseholdName", "Household name", "text", state.householdName || "", "Household name")}
          ${field("setupPassword", "Password", "password", "", "Create a password")}
          ${field("setupPasswordConfirm", "Confirm password", "password", "", "Repeat password")}
          <button type="button" class="primary-btn" data-setup-account>Save and unlock</button>
          <p class="muted small">Prototype note: this protects the local browser app. Production multi-device access will need server-side authentication.</p>
        </form>
      </section>
    </main>
  `;
}

function lockPage() {
  return `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="brand auth-brand"><span class="brand-mark">✓</span><span class="brand-name">Finance Centre</span></div>
        <h1 class="page-title">Welcome back</h1>
        <p class="page-subtitle">${escapeHtml(state.householdName || "Your household")} is locked.</p>
        <form id="unlock-form" class="form-card">
          ${field("unlockPassword", "Password", "password", "", "Enter your password")}
          <button type="button" class="primary-btn" data-unlock-app>Unlock</button>
        </form>
      </section>
    </main>
  `;
}

function settingsPage() {
  return `
    ${pageHead("Settings", "Manage household details and local password.", `
      <button class="secondary-btn" data-lock-app>Lock app</button>
    `)}
    <div class="grid lower-grid">
      <article class="card">
        <div class="card-header"><h2 class="card-title">Household</h2></div>
        <form id="profile-form" class="form-card">
          ${field("settingsUserName", "User name", "text", state.userName || "", "Your name")}
          ${field("settingsHouseholdName", "Household name", "text", state.householdName || "", "Household name")}
          <button type="button" class="primary-btn" data-save-profile>Save household</button>
        </form>
      </article>
      <article class="card">
        <div class="card-header"><h2 class="card-title">Password</h2></div>
        <form id="password-form" class="form-card">
          ${field("currentPassword", "Current password", "password", "", "Current password")}
          ${field("newPassword", "New password", "password", "", "New password")}
          ${field("newPasswordConfirm", "Confirm new password", "password", "", "Repeat new password")}
          <button type="button" class="primary-btn" data-change-password>Change password</button>
          <p class="muted small">Password changes apply to this local browser profile.</p>
        </form>
      </article>
    </div>
    ${footerLine()}
  `;
}

function dashboardPage() {
  const selectedMonthExpenses = getSelectedMonthExpenseOccurrences(state.expenses);
  const monthlyExpenses = sum(selectedMonthExpenses);
  const recurring = sum(selectedMonthExpenses.filter((item) => normalizedType(item) === "Recurring"));
  const selectedMonthSavings = getSelectedMonthSavings(state.savings);
  const monthlySaved = sum(selectedMonthSavings);
  const totalSavings = sum(latestGoalBalances(), "balance");
  const totalBudget = totalExpenseBudget();
  const hasBudget = hasExpenseBudgets();
  const budgetRemaining = totalBudget - monthlyExpenses;
  const upcomingOneOff = getUpcomingExpenses(state.expenses).filter((item) => normalizedType(item) === "One-off");

  return `
    ${pageHead("Finance Centre Dashboard")}
    <div class="grid kpi-grid">
      ${kpi("▣", "Monthly expenses", compactGBP(monthlyExpenses), `${selectedMonthExpenses.length} expenses`, state.month, "orange")}
      ${kpi("↻", "Recurring expenses", compactGBP(recurring), `${selectedMonthExpenses.filter((item) => normalizedType(item) === "Recurring").length} payments`, state.month, "orange")}
      ${kpi("♧", "Total savings", compactGBP(totalSavings), `${latestGoalBalances().length} goals`, "from saved contributions", "green")}
      ${kpi("＋", "Monthly saved", compactGBP(monthlySaved), `${selectedMonthSavings.length} contributions`, state.month, "teal")}
      ${kpi("◔", "Budget remaining", hasBudget ? compactGBP(budgetRemaining) : "Not set", hasBudget ? (budgetRemaining >= 0 ? "Within budget" : "Over budget") : "No budget set", hasBudget ? `Budget ${compactGBP(totalBudget)}` : "Add budgets to track this", "blue", hasBudget && budgetRemaining < 0)}
    </div>
    <div class="grid dashboard-grid">
      ${trendCard("Expense Trend", "expense", expenseTrendSeries(state.expenses))}
      <article class="card">
        <div class="card-header"><h2 class="card-title">Income</h2><span class="info">i</span></div>
        ${emptyState("No income data", "Income will appear here once the income section is added.")}
        <button class="link-btn" data-route="income">Open income →</button>
      </article>
      <article class="card">
        <div class="card-header"><h2 class="card-title">Upcoming One-off Expenses</h2><span class="info">i</span></div>
        ${paymentList(upcomingOneOff.slice(0, 4).map((item) => [categoryIcon(item.category), item.vendor, formatGBP(item.amount), dateLabel(item.date), item.status]))}
        <button class="link-btn" data-route="expenses">View all upcoming →</button>
      </article>
      <article class="card">
        <div class="card-header"><h2 class="card-title">Savings Goals</h2><span class="info">i</span></div>
        ${goalProgress()}
      </article>
      <article class="card">
        <div class="card-header"><h2 class="card-title">Retirement Simulator</h2><span class="info">i</span></div>
        ${emptyState("No retirement data", "Simulator results will appear here once assumptions are entered.")}
        <button class="link-btn" data-route="retirement">Open simulator →</button>
      </article>
      <article class="card">
        <div class="card-header"><h2 class="card-title">Recurring Expenses</h2><span class="muted small">Monthly total: ${compactGBP(recurring)}</span></div>
        ${paymentList(selectedMonthExpenses.filter((item) => normalizedType(item) === "Recurring").slice(0, 4).map((item) => ["▣", item.vendor, formatGBP(item.amount), dateLabel(item.date), ""]))}
        <button class="link-btn" data-route="expenses">View recurring →</button>
      </article>
    </div>
    ${footerLine()}
  `;
}

function expensesPage() {
  const expenseView = state.expenseView || "overview";
  const expenseFilter = state.expenseFilter || "All";
  const selectedMonthExpenses = getSelectedMonthExpenseOccurrences(state.expenses);
  const filteredExpenses = filterExpenses(selectedMonthExpenses, expenseFilter);
  const upcomingExpenses = filterExpenses(getUpcomingExpenses(state.expenses), expenseFilter);
  const paid = filteredExpenses;
  const monthly = sum(filteredExpenses);
  const recurring = sum(filteredExpenses.filter((item) => normalizedType(item) === "Recurring"));
  const oneOff = sum(filteredExpenses.filter((item) => normalizedType(item) === "One-off"));
  const categories = categoryTotals(filteredExpenses);

  return `
    ${pageHead("Expenses", "", `
      <button class="primary-btn" data-route="add-expense">＋ Add expense</button>
    `)}
    ${expenseTabbar(expenseFilter, expenseView)}
    ${expenseView === "overview" ? expenseOverview(monthly, recurring, oneOff, categories, paid, filteredExpenses, upcomingExpenses) : expenseDetailView(expenseView, filteredExpenses, categories, upcomingExpenses)}
    ${footerLine()}
  `;
}

function expenseDetailView(view, expenses, categories, upcomingExpenses) {
  if (view === "payments") {
    return `
      <article class="card">
        <div class="card-header">
          <div><h2 class="card-title">Upcoming Payments</h2><p class="muted small">Scheduled and due expenses for the selected filter.</p></div>
          <button class="link-btn" data-expense-view="overview">Back to overview</button>
        </div>
        ${expenseTable(upcomingExpenses.sort((a, b) => new Date(a.date) - new Date(b.date)), true)}
      </article>
    `;
  }

  if (view === "transactions") {
    return `
      <article class="card">
        <div class="card-header">
          <div><h2 class="card-title">All Expenses</h2><p class="muted small">Every expense matching ${state.expenseFilter || "All"}.</p></div>
          <button class="link-btn" data-expense-view="overview">Back to overview</button>
        </div>
        ${expenseTable(expenses.slice().sort((a, b) => new Date(b.date) - new Date(a.date)), true)}
      </article>
    `;
  }

  if (view === "breakdown") {
    return `
      <div class="grid lower-grid">
        ${breakdownCard("Full Expense Breakdown", sum(expenses), categories, "expense")}
        <article class="card">
          <div class="card-header">
            <div><h2 class="card-title">Category Detail</h2><p class="muted small">Spend, budget, and share of total.</p></div>
            <button class="link-btn" data-expense-view="overview">Back to overview</button>
          </div>
          ${budgetProgress(categories)}
        </article>
      </div>
    `;
  }

  if (view === "report") {
    const total = sum(expenses);
    const hasBudget = hasExpenseBudgets();
    const totalBudget = categories.reduce((budgetTotal, [name]) => budgetTotal + (categoryBudget(name) || 0), 0);
    const variance = total - totalBudget;

    return `
      <div class="grid lower-grid">
        ${trendCard("Full Spending Report", "expense", expenseTrendSeries(filterExpenses(state.expenses, state.expenseFilter || "All")))}
        <article class="card">
          <div class="card-header">
            <div><h2 class="card-title">Report Summary</h2><p class="muted small">${state.month} compared with recent months.</p></div>
            <button class="link-btn" data-expense-view="overview">Back to overview</button>
          </div>
          <div class="progress-list">
            ${previewRow("Total spend", compactGBP(total))}
            ${previewRow("Recurring share", percent(sum(expenses.filter((item) => normalizedType(item) === "Recurring")), total || 1))}
            ${previewRow("Largest category", categories[0]?.[0] || "None")}
            ${previewRow("Forecast vs budget", hasBudget ? (variance > 0 ? `${compactGBP(variance)} over` : `${compactGBP(Math.abs(variance))} under`) : "No budget set")}
          </div>
        </article>
      </div>
    `;
  }

  if (view === "budgets") {
    return `
      ${budgetManager(categories)}
    `;
  }

  return expenseOverview(sum(expenses), sum(expenses.filter((item) => normalizedType(item) === "Recurring")), sum(expenses.filter((item) => normalizedType(item) === "One-off")), categories, expenses, expenses, upcomingExpenses);
}

function expenseOverview(monthly, recurring, oneOff, categories, paid, filteredExpenses, upcomingExpenses) {
  const hasBudget = hasExpenseBudgets();
  const totalBudget = totalExpenseBudget();
  const budgetRemaining = totalBudget - monthly;
  const forecast = monthly;
  const variance = forecast - totalBudget;

  return `
    <div class="grid kpi-grid">
      ${kpi("▣", "Monthly expenses", compactGBP(monthly), `${filteredExpenses.length} expenses`, state.month, "orange")}
      ${kpi("↻", "Recurring expenses", compactGBP(recurring), `${filteredExpenses.filter((item) => normalizedType(item) === "Recurring").length} payments`, state.month, "orange")}
      ${kpi("▤", "One-off expenses", compactGBP(oneOff), `${filteredExpenses.filter((item) => normalizedType(item) === "One-off").length} expenses`, state.month, "orange")}
      ${kpi("◔", "Budget remaining", hasBudget ? compactGBP(budgetRemaining) : "Not set", hasBudget ? (budgetRemaining >= 0 ? "Within budget" : "Over budget") : "No budget set", hasBudget ? `Budget ${compactGBP(totalBudget)}` : "Add budgets to track this", "green", hasBudget && budgetRemaining < 0)}
      ${kpi("↗", "Forecast", compactGBP(forecast), hasBudget ? (variance > 0 ? `${compactGBP(variance)} over` : `${compactGBP(Math.abs(variance))} under`) : "Budget not set", hasBudget ? `vs budget ${compactGBP(totalBudget)}` : "Based on real expenses", "blue", hasBudget && variance > 0)}
    </div>
    <div class="grid section-grid">
      ${breakdownCard("Expense Breakdown", monthly, categories, "expense")}
      ${trendCard("Spending Trend", "expense", expenseTrendSeries(filterExpenses(state.expenses, state.expenseFilter || "All")))}
      <article class="card">
        <div class="card-header"><h2 class="card-title">Upcoming Payments</h2><button class="link-btn" data-expense-view="payments">View all</button></div>
        ${paymentList(upcomingExpenses.slice(0, 5).map((item) => [categoryIcon(item.category), item.vendor, formatGBP(item.amount), dateLabel(item.date), item.status]))}
        <button class="link-btn" data-expense-view="payments">View all payments →</button>
      </article>
    </div>
    <div class="grid lower-grid">
      <article class="card">
        <div class="card-header"><h2 class="card-title">Largest Expenses</h2></div>
        ${expenseTable(paid.slice().sort((a, b) => b.amount - a.amount).slice(0, 5), true)}
        <button class="link-btn" data-expense-view="transactions">View all expenses →</button>
      </article>
      <article class="card">
        <div class="card-header"><h2 class="card-title">Category Budget Progress</h2><button class="link-btn" data-expense-view="budgets">View budgets →</button></div>
        ${budgetProgress(categories)}
      </article>
    </div>
  `;
}

function savingsPage() {
  const savingsView = state.savingsView || "overview";
  const selectedMonthSavings = getSelectedMonthSavings(state.savings);
  const totalSaved = sum(latestGoalBalances(), "balance");
  const monthlySaved = sum(selectedMonthSavings);
  const categories = latestGoalBalances().map((item) => [item.goal, Number(item.balance || 0)]);
  const targetTotal = sum(latestGoalBalances(), "target");
  const progress = targetTotal ? Math.round((totalSaved / targetTotal) * 100) : 0;

  return `
    ${pageHead("Savings", "", `
      <button class="primary-btn" data-route="add-saving">＋ Add saving</button>
    `)}
    ${savingsTabbar(savingsView)}
    ${savingsView === "overview" ? savingsOverview(totalSaved, monthlySaved, categories, progress) : savingsDetailView(savingsView, categories)}
    ${footerLine()}
  `;
}

function savingsOverview(totalSaved, monthlySaved, categories, progress) {
  return `
    <div class="grid kpi-grid">
      ${kpi("♧", "Total savings", compactGBP(totalSaved), `${latestGoalBalances().length} goals`, "saved balances", "green")}
      ${kpi("＋", "Monthly saved", compactGBP(monthlySaved), `${getSelectedMonthSavings(state.savings).length} contributions`, state.month, "teal")}
      ${kpi("◔", "Total saving", compactGBP(sum(state.savings)), `${state.savings.length} records`, "all contributions", "teal")}
      ${kpi("◎", "Goal progress", `${progress}%`, progress ? "In progress" : "No targets yet", "saved vs targets", "blue")}
      ${kpi("▤", "Accounts", String(savingsAccounts().length), `${state.savings.length} records`, "from saved contributions", "green")}
    </div>
    <div class="grid section-grid">
      ${breakdownCard("Savings Goals", totalSaved, categories, "savings")}
      ${trendCard("Savings Trend", "saving", savingsTrendSeries(state.savings))}
      <article class="card">
        <div class="card-header"><h2 class="card-title">Upcoming Contributions</h2><button class="link-btn" data-savings-view="contributions">View all</button></div>
        ${paymentList(upcomingSavings().slice(0, 5).map((item) => [goalIcon(item.goal), item.goal, formatGBP(item.amount), dateLabel(item.date), item.status]))}
        <button class="link-btn" data-savings-view="contributions">View all contributions →</button>
      </article>
    </div>
    <div class="grid lower-grid">
      <article class="card">
        <div class="card-header"><h2 class="card-title">Savings Accounts</h2></div>
        ${accountsTable()}
        <button class="link-btn" data-savings-view="accounts">View accounts →</button>
      </article>
      <article class="card">
        <div class="card-header"><h2 class="card-title">Goal Progress</h2><button class="link-btn" data-savings-view="goals">View goals →</button></div>
        ${goalProgress()}
      </article>
    </div>
  `;
}

function savingsDetailView(view, categories) {
  if (view === "breakdown") {
    return `
      <div class="grid lower-grid">
        ${breakdownCard("Full Savings Breakdown", sum(latestGoalBalances(), "balance"), categories, "savings")}
        <article class="card">
          <div class="card-header"><h2 class="card-title">Goal Progress</h2><button class="link-btn" data-savings-view="overview">Back to overview</button></div>
          ${goalProgress()}
        </article>
      </div>
    `;
  }

  if (view === "contributions") {
    return `
      <article class="card">
        <div class="card-header"><div><h2 class="card-title">Contributions</h2><p class="muted small">Savings records from saved data.</p></div><button class="link-btn" data-savings-view="overview">Back to overview</button></div>
        ${savingsTable(state.savings)}
      </article>
    `;
  }

  if (view === "accounts") {
    return `
      <article class="card">
        <div class="card-header"><div><h2 class="card-title">Accounts</h2><p class="muted small">Derived from savings records.</p></div><button class="link-btn" data-savings-view="overview">Back to overview</button></div>
        ${accountsTable()}
      </article>
    `;
  }

  if (view === "goals") {
    return `
      <article class="card">
        <div class="card-header"><div><h2 class="card-title">Goals</h2><p class="muted small">Latest saved balance and target by goal.</p></div><button class="link-btn" data-savings-view="overview">Back to overview</button></div>
        ${goalsTable()}
      </article>
    `;
  }

  return savingsOverview(sum(latestGoalBalances(), "balance"), sum(getSelectedMonthSavings(state.savings)), categories, 0);
}

function addExpensePage() {
  const editingExpense = state.editingExpenseId ? state.expenses.find((expense) => expense.id === state.editingExpenseId) : null;
  const type = normalizedType(editingExpense || { type: "Recurring" });
  const isEditing = Boolean(editingExpense);
  const paymentCount = editingExpense?.paymentCount || "";
  const finalPaymentLabel = editingExpense?.finalPaymentDate ? dateLabel(editingExpense.finalPaymentDate) : "On-going";

  return `
    ${pageHead(isEditing ? "Edit expense" : "Add expense", isEditing ? "Update this payment rule or one-off expense." : "Capture a regular or one-off outgoing and update the monthly forecast.", `
      <button class="secondary-btn" data-route="expenses">Cancel</button>
      <button class="primary-btn" data-submit-expense>${isEditing ? "Save changes" : "Save expense"}</button>
    `)}
    <form class="form-shell" id="expense-form">
      <article class="card form-card">
        <button type="button" class="link-btn" data-route="expenses">← Back to Expenses</button>
        <div class="segmented" data-expense-type-toggle>
          <button type="button" class="segment ${type === "Recurring" ? "active" : ""}" data-expense-type="Recurring">Recurring</button>
          <button type="button" class="segment ${type === "One-off" ? "active" : ""}" data-expense-type="One-off">One-off</button>
        </div>
        <div class="field-grid">
          ${field("amount", "Amount", "number", editingExpense?.amount || "", "0.00")}
          ${field("vendor", "Vendor / payee", "text", editingExpense?.vendor || "", "Who was paid?")}
          ${selectField("category", "Category", expenseCategoryOptions(), editingExpense?.category)}
          ${field("date", "Date", "date", editingExpense?.date || "")}
          ${selectField("type", "Type", ["Recurring", "One-off"], type)}
          ${selectField("account", "Payment account", ["Current account", "Joint account", "Credit card"])}
          ${selectField("owner", "Owner", [state.userName || "User", "Household"])}
          <div class="field ${type === "One-off" ? "is-hidden" : ""}" data-recurring-field>${selectInput("frequency", "Frequency", ["Monthly", "Weekly", "Yearly"], isEditing ? normalizedFrequency(editingExpense) : "Monthly")}</div>
          <div class="field ${type === "One-off" ? "is-hidden" : ""}" data-recurring-field>${fieldInput("paymentCount", "Number of payments", "number", paymentCount, "Leave blank for on-going")}</div>
          <div class="field ${type === "One-off" ? "is-hidden" : ""}" data-recurring-field>
            <label for="finalPaymentDate">Final payment date</label>
            <input id="finalPaymentDate" name="finalPaymentDate" type="text" value="${finalPaymentLabel}" readonly />
          </div>
          <div class="field ${type === "Recurring" ? "is-hidden" : ""}" data-oneoff-field>${selectInput("status", "Status", ["Paid", "Scheduled"], editingExpense?.status || "Paid")}</div>
          <div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes" placeholder="Add context for this expense">${editingExpense?.notes || ""}</textarea></div>
        </div>
        <div class="upload-card"><div><strong>▧ Scan or upload receipt</strong><br><span class="small">Drop a file here or connect email import later</span></div></div>
      </article>
      <aside class="grid">
        <article class="card">
          <div class="card-header"><h2 class="card-title">Expense preview</h2><span class="info">i</span></div>
          <div class="muted small">Monthly impact</div>
          <div class="preview-total">${formatGBP(editingExpense?.amount || 0)}</div>
          <div class="progress-list">
            ${previewRow("Category", "Not selected")}
            ${previewRow("Budget after this", "No change yet")}
            ${previewRow("Forecast impact", "Pending")}
            ${previewRow("Final payment", '<span data-final-payment-preview>On-going</span>')}
          </div>
        </article>
        <article class="card">
          <div class="card-header"><h2 class="card-title">Automation</h2></div>
          <div class="switch-list">
            ${switchRow("Autopay enabled", true)}
            ${switchRow("Reminder 3 days before", true)}
            ${switchRow("Remember vendor category", true)}
          </div>
        </article>
        <article class="card">
          <div class="card-header"><h2 class="card-title">Similar expenses</h2></div>
          <p class="muted small">Similar expenses will appear after you enter a vendor or category.</p>
        </article>
      </aside>
    </form>
    ${footerLine()}
  `;
}

function addSavingPage() {
  const editingSaving = state.editingSavingId ? state.savings.find((saving) => saving.id === state.editingSavingId) : null;
  const isEditing = Boolean(editingSaving);
  const existingGoal = editingSaving ? latestGoalBalances().find((item) => item.goal === editingSaving.goal) : null;

  return `
    ${pageHead(isEditing ? "Edit saving" : "Add saving", isEditing ? "Update this saving record." : "Add a contribution to an existing goal or create a new target.", `
      <button class="secondary-btn" data-route="savings">Cancel</button>
      <button class="primary-btn" data-submit-saving>${isEditing ? "Save changes" : "Save"}</button>
    `)}
    <form class="form-shell" id="saving-form">
      <article class="card form-card">
        <button type="button" class="link-btn" data-route="savings">← Back to Savings</button>
        <div class="field-grid">
          ${field("amount", "Amount", "number", editingSaving?.amount || "", "0.00")}
          ${field("goal", "Savings goal", "text", editingSaving?.goal || "", "Goal name")}
          ${field("account", "Savings account", "text", editingSaving?.account || "", "Account name")}
          ${field("date", "Date", "date", editingSaving?.date || "")}
          ${selectField("type", "Contribution type", ["Regular", "One-off"], editingSaving?.type || "Regular")}
          ${field("target", "Goal target", "number", editingSaving?.target || existingGoal?.target || "", "Optional target")}
          ${selectField("source", "Source account", ["Current account", "Joint account"], editingSaving?.source || "Current account")}
          ${selectField("owner", "Owner", [state.userName || "User", "Household"], editingSaving?.owner || state.userName || "User")}
          ${field("frequency", "Frequency", "text", editingSaving?.frequency || "", "Monthly")}
          <div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes" placeholder="Add context for this contribution">${escapeHtml(editingSaving?.notes || "")}</textarea></div>
        </div>
      </article>
      <aside class="grid">
        <article class="card">
          <div class="card-header"><h2 class="card-title">Savings preview</h2><span class="info">i</span></div>
          <div class="muted small">Contribution</div>
          <div class="preview-total">£0</div>
          <div class="progress-list">
            ${previewRow("Goal", "Not selected")}
            ${previewRow("New balance", "Pending")}
            ${previewRow("Completion", "Pending")}
          </div>
        </article>
        <article class="card">
          <div class="card-header"><h2 class="card-title">Goal impact</h2></div>
          <div class="progress-list">
            ${emptyState("No goal selected", "Choose a goal and amount to preview goal impact.")}
          </div>
        </article>
        <article class="card">
          <div class="card-header"><h2 class="card-title">Smart suggestions</h2></div>
          <div class="switch-list">
            ${switchRow("Make this monthly", true)}
            ${switchRow("Round up transfers", false)}
            ${switchRow("Assign future transfers", true)}
          </div>
        </article>
      </aside>
    </form>
    ${footerLine()}
  `;
}

function placeholderPage() {
  const label = navItems.find(([route]) => route === state.route)?.[2] || "Section";
  return `
    ${pageHead(label, "This section is ready to be added after dashboard, expenses, and savings.")}
    <div class="card empty-note">
      <div><strong>${label}</strong><br><span>Coming next in the build sequence.</span></div>
    </div>
    ${footerLine()}
  `;
}

function pageHead(title, subtitle = "", actions = "") {
  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">${title}</h1>
        ${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ""}
      </div>
      <div class="button-row">${actions}</div>
    </div>
  `;
}

function tabbar(primary, secondary) {
  return `
    <div class="tabbar">
      <div class="tabs">${primary.map((item, index) => `<button class="tab-btn ${index === 0 ? "active" : ""}">${item}</button>`).join("")}</div>
      <div class="tabs">${secondary.map((item) => `<button class="select-chip">${item}</button>`).join("")}</div>
    </div>
  `;
}

function expenseTabbar(activeFilter, activeView) {
  const filters = ["All", "Recurring", "One-off"];
  const views = [
    ["overview", "Overview"],
    ["breakdown", "Breakdown"],
    ["report", "Spending report"],
    ["payments", "Payments"],
    ["transactions", "Transactions"],
    ["budgets", "Budgets"],
  ];

  return `
    <div class="tabbar">
      <div class="tabs">
        ${filters
          .map((item) => `<button class="tab-btn ${activeFilter === item ? "active" : ""}" data-expense-filter="${item}">${item}</button>`)
          .join("")}
      </div>
      <div class="tabs">
        ${views
          .map(([view, label]) => `<button class="select-chip ${activeView === view ? "active-chip" : ""}" data-expense-view="${view}">${label}</button>`)
          .join("")}
      </div>
    </div>
  `;
}

function savingsTabbar(activeView) {
  const views = [
    ["overview", "Overview"],
    ["breakdown", "Breakdown"],
    ["contributions", "Contributions"],
    ["accounts", "Accounts"],
    ["goals", "Goals"],
  ];

  return `
    <div class="tabbar">
      <div class="tabs">
        ${views.map(([view, label]) => `<button class="select-chip ${activeView === view ? "active-chip" : ""}" data-savings-view="${view}">${label}</button>`).join("")}
      </div>
    </div>
  `;
}

function kpi(icon, label, value, trend, sub, tone = "blue", warning = false) {
  return `
    <article class="kpi-card">
      <span class="card-icon icon-${tone}">${icon}</span>
      <div>
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${value}</div>
        <div class="trend ${warning ? "warning" : ""}">${trend}</div>
        ${sub ? `<div class="muted small">${sub}</div>` : ""}
      </div>
    </article>
  `;
}

function breakdownCard(title, total, items, type) {
  if (!items.length) {
    const emptyTitle = type === "savings" ? "No savings data" : "No expense data";
    const emptyMessage = type === "savings" ? "Add savings to see a breakdown." : `Add expenses dated ${state.month} to see a breakdown.`;
    return `
      <article class="card">
        <div class="card-header"><h2 class="card-title">${title}</h2><span class="info">i</span></div>
        ${emptyState(emptyTitle, emptyMessage)}
        <button class="link-btn" ${type === "expense" ? 'data-expense-view="breakdown"' : type === "savings" ? 'data-savings-view="breakdown"' : ""}>View full breakdown →</button>
      </article>
    `;
  }

  return `
    <article class="card">
      <div class="card-header"><h2 class="card-title">${title}</h2><span class="info">i</span></div>
      <div class="donut-layout">
        <div class="donut ${type === "savings" ? "savings" : ""}" data-center="${compactGBP(total)}&#10;Total"></div>
        <div class="legend-list">
          ${items
            .slice(0, 7)
            .map(
              ([name, value], index) => `
                <div class="legend-row">
                  <span class="legend-name"><i class="legend-dot" style="background:${palette[index]}"></i>${name}</span>
                  <strong>${percent(value, total)}</strong>
                  <span class="muted">${compactGBP(value)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
      <button class="link-btn" ${type === "expense" ? 'data-expense-view="breakdown"' : type === "savings" ? 'data-savings-view="breakdown"' : ""}>View full breakdown →</button>
    </article>
  `;
}

function trendCard(title, mode, series = null) {
  const isSaving = mode === "saving";
  const trendSeries = series || [];
  const maxValue = Math.max(...trendSeries.map((item) => Math.max(item.total, item.budget)), 1);
  const hasTrendData = trendSeries.some((item) => item.total > 0 || item.budget > 0);

  return `
    <article class="card">
      <div class="card-header"><h2 class="card-title">${title}</h2><span class="info">i</span></div>
      <div class="legend">
        <span><i class="legend-dot" style="background:${isSaving ? "#12a88e" : "#e25b14"}"></i>${isSaving ? "Saved" : "Expenses"}</span>
        <span><i class="legend-dot" style="background:${isSaving ? "#bbd4fb" : "#ffd2a7"}"></i>${isSaving ? "Target" : "One-off"}</span>
        <span><i class="legend-dot" style="background:#1556b7"></i>${isSaving ? "Target" : hasExpenseBudgets() ? "Budget" : "Budget not set"}</span>
      </div>
      ${
        !hasTrendData
          ? emptyState("No trend data", `Add dated ${isSaving ? "savings" : "expenses"} to build the trend.`)
          : `<div class="chart-bars">
        ${trendSeries
          .map(
            (item) => {
              if (!item.total && !item.budget) {
                return `
              <div class="bar-group empty-bar-group">
                <div class="bar-empty" title="No data"></div>
                <span class="bar-label">${item.label}</span>
                <span class="bar-value">${compactGBP(0)}</span>
              </div>
            `;
              }

              const totalHeight = Math.max((item.total / maxValue) * 92, item.total ? 8 : 0);
              const secondaryHeight = item.total ? Math.min((item.secondary / item.total) * totalHeight, totalHeight) : 0;
              const primaryHeight = Math.max(totalHeight - secondaryHeight, 0);
              const budgetHeight = Math.max((item.budget / maxValue) * 92, item.budget ? 8 : 0);
              return `
              <div class="bar-group">
                <div class="bar-stack" title="${compactGBP(item.total)} total">
                  ${item.budget ? `<span class="bar budget-marker" style="height:${budgetHeight}%"></span>` : ""}
                  <span class="bar ${isSaving ? "saving" : "expense"}" style="height:${primaryHeight}%"></span>
                  <span class="bar ${isSaving ? "soft-blue" : "soft-orange"}" style="height:${secondaryHeight}%"></span>
                </div>
                <span class="bar-label">${item.label}</span>
                <span class="bar-value">${compactGBP(item.total)}</span>
              </div>
            `;
            },
          )
          .join("")}
      </div>`
      }
      ${isSaving ? "" : '<button class="link-btn" data-expense-view="report">View spending report →</button>'}
    </article>
  `;
}

const palette = ["#1556b7", "#2a95b7", "#22a77c", "#f5b52a", "#fb7c2d", "#e86f79", "#c8ccd3"];

function paymentList(rows) {
  if (!rows.length) return emptyState("No upcoming payments", "Scheduled expenses will appear here once you add them.");

  return `<div class="payment-list">${rows
    .map(
      ([icon, label, amount, date, status]) => `
      <div class="payment-row">
        <span class="mini-icon">${icon}</span>
        <strong style="flex:1">${label}</strong>
        <span>${amount}</span>
        <span class="muted small">${date}</span>
        ${status ? `<span class="badge ${status === "Due" ? "due" : status === "Saved" ? "good" : ""}">${status}</span>` : ""}
      </div>
    `,
    )
    .join("")}</div>`;
}

function expenseTable(items, includeActions = false) {
  if (!items.length) return emptyState("No expenses found", `No expenses match ${state.month} and the selected filter.`);

  return `
    <table class="table">
      <thead><tr><th>Vendor</th><th>Category</th><th>Date</th><th>Type</th><th>Amount</th>${includeActions ? "<th>Action</th>" : ""}</tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
            <tr>
              <td>${item.vendor}</td>
              <td>${item.category}</td>
              <td>${dateLabel(item.date)}</td>
              <td><span class="badge ${normalizedType(item) === "One-off" ? "due" : ""}">${expenseTypeLabel(item)}</span></td>
              <td>${formatGBP(item.amount)}</td>
              ${includeActions ? `<td class="table-actions"><button class="table-action" data-edit-expense="${item.sourceId || item.id}">Edit</button><button class="table-action danger" data-delete-expense="${item.sourceId || item.id}">Delete</button></td>` : ""}
            </tr>
          `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function accountsTable() {
  const rows = savingsAccounts();
  if (!rows.length) return emptyState("No accounts yet", "Add a saving with an account name to see accounts here.");

  return `
    <table class="table">
      <thead><tr><th>Account</th><th>Goals</th><th>Contributions</th><th>Balance</th><th>Last activity</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.account}</td><td>${row.goals.join(", ") || "None"}</td><td>${row.count}</td><td>${compactGBP(row.balance)}</td><td>${dateLabel(row.lastDate)}</td></tr>`).join("")}</tbody>
    </table>
  `;
}

function savingsTable(items) {
  if (!items.length) return emptyState("No contributions yet", "Add a saving to start tracking contributions.");

  return `
    <table class="table">
      <thead><tr><th>Goal</th><th>Account</th><th>Date</th><th>Type</th><th>Amount</th><th>Action</th></tr></thead>
      <tbody>
        ${items
          .slice()
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .map(
            (item) => `
              <tr>
                <td>${item.goal}</td>
                <td>${item.account || "Not set"}</td>
                <td>${dateLabel(item.date)}</td>
                <td><span class="badge ${item.type === "One-off" ? "due" : "good"}">${item.type}</span></td>
                <td>${formatGBP(item.amount)}</td>
                <td class="table-actions"><button class="table-action" data-edit-saving="${item.id}">Edit</button><button class="table-action danger" data-delete-saving="${item.id}">Delete</button></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function goalsTable() {
  const goals = latestGoalBalances();
  if (!goals.length) return emptyState("No goals yet", "Add a saving goal to track progress.");

  return `
    <table class="table">
      <thead><tr><th>Goal</th><th>Account</th><th>Saved</th><th>Target</th><th>Progress</th></tr></thead>
      <tbody>
        ${goals
          .map((item) => {
            const pct = item.target ? Math.round((Number(item.balance || 0) / Number(item.target || 0)) * 100) : 0;
            return `<tr><td>${item.goal}</td><td>${item.account || "Not set"}</td><td>${compactGBP(item.balance || 0)}</td><td>${item.target ? compactGBP(item.target) : "Not set"}</td><td><span class="progress-track table-progress"><span class="progress-fill" style="width:${Math.min(pct, 100)}%"></span></span> ${pct}%</td></tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function budgetProgress(categories) {
  if (!hasExpenseBudgets()) {
    return emptyState("No budgets set", "Add category budgets before budget remaining or progress can be calculated.");
  }

  const spendingByCategory = Object.fromEntries(categories);
  const rows = budgetCategoryNames().map((name) => [name, spendingByCategory[name] || 0]);

  return `<div class="progress-list">${rows
    .slice(0, 8)
    .map(([name, value]) => {
      const budget = categoryBudget(name);
      if (!budget) return "";
      const pct = Math.min(Math.round((value / budget) * 100), 100);
      return `
        <div class="progress-row">
          <span class="legend-name"><span class="mini-icon">${categoryIcon(name)}</span>${name}</span>
          <span>${compactGBP(value)}</span>
          <span>${compactGBP(budget)}</span>
          <span class="progress-track"><span class="progress-fill ${pct > 70 ? "warn" : ""}" style="width:${pct}%"></span></span>
          <strong>${pct}%</strong>
        </div>
      `;
    })
    .join("")}</div>`;
}

function budgetManager(categories) {
  const editingCategory = state.editingBudgetCategory || "";
  const spendingByCategory = Object.fromEntries(categories);
  const categoryNames = allExpenseCategories();
  const editingBudget = editingCategory ? categoryBudget(editingCategory) : "";

  return `
    <div class="grid lower-grid">
      <article class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${editingCategory ? "Edit Budget" : "Add Budget"}</h2>
            <p class="muted small">Set a monthly budget for an existing or new expense category.</p>
          </div>
          <button class="link-btn" data-expense-view="overview">Back to overview</button>
        </div>
        <form id="budget-form" class="budget-form">
          <input type="hidden" name="originalCategory" value="${editingCategory}" />
          <div class="field">
            <label for="budgetCategory">Category</label>
            <input id="budgetCategory" name="category" list="expense-category-list" value="${editingCategory}" placeholder="e.g. Utilities" required />
            <datalist id="expense-category-list">
              ${categoryNames.map((name) => `<option value="${name}"></option>`).join("")}
            </datalist>
          </div>
          <div class="field">
            <label for="budgetAmount">Monthly budget</label>
            <input id="budgetAmount" name="amount" type="number" min="0" step="0.01" value="${editingBudget || ""}" placeholder="0.00" required />
          </div>
          <div class="button-row">
            <button type="button" class="primary-btn" data-save-budget>${editingCategory ? "Save changes" : "Add budget"}</button>
            ${editingCategory ? '<button type="button" class="secondary-btn" data-cancel-budget-edit>Cancel edit</button>' : ""}
          </div>
        </form>
      </article>
      <article class="card">
        <div class="card-header">
          <div><h2 class="card-title">Category Budgets</h2><p class="muted small">Add, edit, or delete budgets and categories.</p></div>
        </div>
        ${budgetTable(spendingByCategory)}
      </article>
    </div>
  `;
}

function budgetTable(spendingByCategory) {
  const rows = allExpenseCategories();
  if (!rows.length) return emptyState("No categories yet", "Add a category and budget to get started.");

  return `
    <table class="table">
      <thead><tr><th>Category</th><th>Spent</th><th>Budget</th><th>Progress</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows
          .map((name) => {
            const spent = spendingByCategory[name] || 0;
            const budget = categoryBudget(name);
            const pct = budget ? Math.min(Math.round((spent / budget) * 100), 100) : 0;
            return `
              <tr>
                <td>${name}</td>
                <td>${compactGBP(spent)}</td>
                <td>${budget ? compactGBP(budget) : "Not set"}</td>
                <td>${budget ? `<span class="progress-track table-progress"><span class="progress-fill ${pct > 70 ? "warn" : ""}" style="width:${pct}%"></span></span> ${pct}%` : "No budget"}</td>
                <td class="table-actions">
                  <button class="table-action" data-edit-budget="${name}">${budget ? "Edit" : "Set"}</button>
                  ${budget ? `<button class="table-action danger" data-delete-budget="${name}">Delete budget</button>` : ""}
                  <button class="table-action danger" data-delete-category="${name}">Delete category</button>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function categoryBudget(name) {
  return Number(state.expenseBudgets?.[name] || 0);
}

function hasExpenseBudgets() {
  return Object.values(state.expenseBudgets || {}).some((value) => Number(value) > 0);
}

function totalExpenseBudget() {
  return Object.values(state.expenseBudgets || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function budgetCategoryNames() {
  return Object.keys(state.expenseBudgets || {}).filter((name) => categoryBudget(name) > 0);
}

function allExpenseCategories() {
  return [...new Set([...(state.expenseCategories || []), ...Object.keys(state.expenseBudgets || {}), ...state.expenses.map((expense) => expense.category).filter(Boolean)])].sort();
}

function expenseCategoryOptions() {
  return allExpenseCategories().length ? allExpenseCategories() : seedState.expenseCategories;
}

function expenseTypeLabel(item) {
  if (normalizedType(item) !== "Recurring") return item.type;
  if (item.finalPaymentDate) return `Recurring · ends ${dateLabel(item.finalPaymentDate)}`;
  return "Recurring · on-going";
}

function normalizedType(item) {
  const value = String(item.type || "").toLowerCase();
  if (value.includes("recurring")) return "Recurring";
  if (value.includes("one")) return "One-off";
  return item.type || "One-off";
}

function normalizedFrequency(item) {
  const value = String(item.frequency || "Monthly").toLowerCase();
  if (value.includes("week")) return "Weekly";
  if (value.includes("year")) return "Yearly";
  return "Monthly";
}

function goalProgress() {
  const goals = latestGoalBalances();
  if (!goals.length) return emptyState("No goals yet", "Add savings to start tracking goal progress.");

  return `<div class="progress-list">${goals
    .map((item) => {
      const pct = item.target ? Math.round((item.balance / item.target) * 100) : 0;
      return `
        <div class="progress-row">
          <div class="progress-meta">
            <strong>${item.goal}</strong>
            <span class="muted small">${compactGBP(item.balance)} of ${compactGBP(item.target)}</span>
          </div>
          <span class="progress-track"><span class="progress-fill" style="width:${Math.min(pct, 100)}%"></span></span>
          <strong>${pct}%</strong>
        </div>
      `;
    })
    .join("")}</div>`;
}

function field(name, label, type, value = "", placeholder = "") {
  return `<div class="field">${fieldInput(name, label, type, value, placeholder)}</div>`;
}

function fieldInput(name, label, type, value = "", placeholder = "") {
  return `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${value}" placeholder="${placeholder}" />`;
}

function selectField(name, label, options, selectedValue = "") {
  return `<div class="field">${selectInput(name, label, options, selectedValue)}</div>`;
}

function selectInput(name, label, options, selectedValue = "") {
  return `<label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map((option) => `<option ${option === selectedValue ? "selected" : ""}>${option}</option>`).join("")}</select>`;
}

function previewRow(label, value) {
  return `<div class="list-row"><span class="muted">${label}</span><strong>${value}</strong></div>`;
}

function emptyState(title, message) {
  return `<div class="empty-state"><strong>${title}</strong><span>${message}</span></div>`;
}

function switchRow(label, on) {
  return `<div class="switch-row"><span>${label}</span><span class="switch ${on ? "on" : ""}"></span></div>`;
}

function footerLine() {
  return `
    <div class="footer-line">
      <span>♢ Data is stored locally in this browser profile.</span>
      <span>Sync and backup not configured <span class="status-ok">✓</span></span>
    </div>
  `;
}

function categoryTotals(items) {
  const totals = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + Number(item.amount);
    return acc;
  }, {});
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

function sanitizeLoadedState(loadedState) {
  return {
    ...loadedState,
    month: loadedState.month === "May 2025" ? currentMonthLabel() : loadedState.month || currentMonthLabel(),
    userName: loadedState.userName === "James" ? "" : loadedState.userName || "",
    householdName: loadedState.householdName || "",
    passwordHash: loadedState.passwordHash || "",
    expenses: (loadedState.expenses || []).filter((expense) => !demoExpenseKeys.has(expenseKey(expense))),
    savings: (loadedState.savings || []).filter((saving) => !demoSavingKeys.has(savingKey(saving))),
    expenseCategories: loadedState.expenseCategories?.length ? loadedState.expenseCategories : seedState.expenseCategories,
    expenseBudgets: loadedState.expenseBudgets || {},
  };
}

function expenseKey(expense) {
  return [expense.vendor, expense.category, expense.date, expense.type, Number(expense.amount)].join("|");
}

function savingKey(saving) {
  return [saving.goal, saving.account, saving.date, saving.type, Number(saving.amount)].join("|");
}

function filterExpenses(items, filter) {
  if (filter === "Recurring") return items.filter((item) => normalizedType(item) === "Recurring");
  if (filter === "One-off") return items.filter((item) => normalizedType(item) === "One-off");
  return items;
}

function getSelectedMonthDate() {
  const [monthName, yearText] = String(state.month || "").split(" ");
  const month = monthNames[monthName];
  const year = Number(yearText);
  if (month === undefined || Number.isNaN(year)) return new Date();
  return new Date(year, month, 1);
}

function currentMonthLabel() {
  const now = new Date();
  const labels = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${labels[now.getMonth()]} ${now.getFullYear()}`;
}

function shiftMonth(label, offset) {
  const [monthName, yearText] = String(label || currentMonthLabel()).split(" ");
  const month = monthNames[monthName] ?? new Date().getMonth();
  const year = Number(yearText) || new Date().getFullYear();
  const date = new Date(year, month + offset, 1);
  return `${monthLabels[date.getMonth()]} ${date.getFullYear()}`;
}

function isSameMonth(dateValue, monthDate) {
  if (!dateValue) return false;
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === monthDate.getFullYear() && date.getMonth() === monthDate.getMonth();
}

function getSelectedMonthExpenseOccurrences(items) {
  const monthDate = getSelectedMonthDate();
  return getExpenseOccurrencesForMonth(items, monthDate);
}

function getExpenseOccurrencesForMonth(items, monthDate) {
  return items.flatMap((item) => expenseOccurrencesInMonth(item, monthDate));
}

function expenseOccurrencesInMonth(item, monthDate) {
  if (normalizedType(item) !== "Recurring") return isSameMonth(item.date, monthDate) ? [{ ...item, occurrenceDate: item.date }] : [];

  const occurrences = recurringOccurrencesInMonth(item, monthDate);
  if (!occurrences.length) return [];

  return occurrences.map((date, index) => ({
      ...item,
      date,
      occurrenceDate: date,
      occurrenceCount: occurrences.length,
      occurrenceIndex: index + 1,
      sourceId: item.id,
    }));
}

function recurringOccurrencesInMonth(item, monthDate) {
  const startDate = parseDate(item.date);
  if (!startDate) return [];

  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const finalDate = item.finalPaymentDate ? parseDate(item.finalPaymentDate) : null;
  if (startDate > monthEnd || (finalDate && finalDate < monthStart)) return [];

  const frequency = normalizedFrequency(item);
  const occurrences = [];

  if (frequency === "Weekly") {
    const date = new Date(startDate);
    while (date < monthStart) date.setDate(date.getDate() + 7);
    while (date <= monthEnd && (!finalDate || date <= finalDate)) {
      occurrences.push(toISODate(date));
      date.setDate(date.getDate() + 7);
    }
    return occurrences;
  }

  if (frequency === "Yearly") {
    const occurrence = new Date(monthDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    return occurrence >= monthStart && occurrence <= monthEnd && occurrence >= startDate && (!finalDate || occurrence <= finalDate) ? [toISODate(occurrence)] : [];
  }

  const monthDiff = (monthDate.getFullYear() - startDate.getFullYear()) * 12 + (monthDate.getMonth() - startDate.getMonth());
  if (monthDiff < 0) return [];
  const occurrence = new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(startDate.getDate(), monthEnd.getDate()));
  return !finalDate || occurrence <= finalDate ? [toISODate(occurrence)] : [];
}

function getUpcomingExpenses(items) {
  const monthDate = getSelectedMonthDate();
  const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);

  return items
    .map((item) => {
      if (normalizedType(item) === "Recurring") {
        const nextDate = nextRecurringOccurrenceDate(item, startOfMonth);
        return nextDate ? { ...item, date: nextDate, occurrenceDate: nextDate, scheduleRow: true } : null;
      }

      const date = parseDate(item.date);
      if (!date || date < startOfMonth) return null;
      return { ...item, occurrenceDate: item.date };
    })
    .flat()
    .filter(Boolean)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function nextRecurringOccurrenceDate(item, fromDate) {
  for (let offset = 0; offset < 120; offset += 1) {
    const monthDate = new Date(fromDate.getFullYear(), fromDate.getMonth() + offset, 1);
    const occurrence = recurringOccurrencesInMonth(item, monthDate).find((date) => {
      const parsedDate = parseDate(date);
      return parsedDate && parsedDate >= fromDate;
    });
    if (occurrence) return occurrence;
  }
  return "";
}

function expenseTrendSeries(items) {
  const selectedMonth = getSelectedMonthDate();
  const months = Array.from({ length: 6 }, (_, index) => new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 5 + index, 1));

  return months.map((monthDate) => {
    const monthItems = getExpenseOccurrencesForMonth(items, monthDate);
    const total = sum(monthItems);
    const oneOff = sum(monthItems.filter((item) => normalizedType(item) === "One-off"));
    const budget = categoryTotals(monthItems).reduce((totalBudget, [name]) => totalBudget + categoryBudget(name), 0);
    return {
      label: monthDate.toLocaleString("en-GB", { month: "short" }),
      total,
      secondary: oneOff,
      budget,
    };
  });
}

function savingsTrendSeries(items) {
  const selectedMonth = getSelectedMonthDate();
  const months = Array.from({ length: 6 }, (_, index) => new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 5 + index, 1));

  return months.map((monthDate) => {
    const monthItems = items.filter((item) => isSameMonth(item.date, monthDate));
    const total = sum(monthItems);
    return {
      label: monthDate.toLocaleString("en-GB", { month: "short" }),
      total,
      secondary: 0,
      budget: 0,
    };
  });
}

function parseDate(dateValue) {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function latestGoalBalances() {
  const goals = {};
  state.savings.forEach((item) => {
    const goal = item.goal || "Unassigned";
    const existing = goals[goal] || {
      goal,
      account: item.account || "Not set",
      balance: 0,
      target: 0,
      date: item.date,
      count: 0,
    };
    const itemDate = parseDate(item.date);
    const existingDate = parseDate(existing.date);
    goals[goal] = {
      ...existing,
      account: itemDate && (!existingDate || itemDate >= existingDate) ? item.account || existing.account : existing.account,
      balance: existing.balance + Number(item.amount || 0),
      target: Math.max(Number(existing.target || 0), Number(item.target || 0)),
      date: itemDate && (!existingDate || itemDate >= existingDate) ? item.date : existing.date,
      count: existing.count + 1,
    };
  });
  return Object.values(goals).sort((a, b) => a.goal.localeCompare(b.goal));
}

function getSelectedMonthSavings(items) {
  const monthDate = getSelectedMonthDate();
  return items.filter((item) => isSameMonth(item.date, monthDate));
}

function upcomingSavings() {
  const monthDate = getSelectedMonthDate();
  const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  return state.savings
    .filter((item) => item.status !== "Saved")
    .filter((item) => {
      const date = parseDate(item.date);
      return date && date >= startOfMonth;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function savingsAccounts() {
  const accounts = {};
  state.savings.forEach((item) => {
    const account = item.account || "Unassigned";
    if (!accounts[account]) accounts[account] = { account, goals: new Set(), count: 0, balance: 0, lastDate: item.date };
    accounts[account].goals.add(item.goal);
    accounts[account].count += 1;
    accounts[account].balance += Number(item.amount || 0);
    if (parseDate(item.date) > parseDate(accounts[account].lastDate)) accounts[account].lastDate = item.date;
  });

  return Object.values(accounts).map((account) => ({ ...account, goals: [...account.goals] }));
}

function emergencyFundLabel() {
  const fund = latestGoalBalances().find((item) => String(item.goal || "").toLowerCase().includes("emergency"));
  return fund ? compactGBP(fund.balance || 0) : "Not set";
}

function categoryIcon(category) {
  return {
    Housing: "⌂",
    Utilities: "♢",
    Groceries: "▤",
    Transport: "▣",
    Subscriptions: "↻",
    Leisure: "✦",
    Home: "⌂",
  }[category] || "▣";
}

function goalIcon(goal) {
  return {
    "Emergency Fund": "⌂",
    "House Deposit": "⬒",
    "Holiday Fund": "✈",
    Education: "▣",
    "New Car": "▤",
  }[goal] || "♧";
}

function dateLabel(date) {
  if (!date) return "No date";
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return "No date";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(parsedDate);
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((element) => {
    element.addEventListener("click", () => {
      state.route = element.dataset.route;
      if (state.route === "expenses") state.expenseView = "overview";
      if (state.route === "savings") state.savingsView = "overview";
      if (state.route !== "add-expense") state.editingExpenseId = "";
      if (state.route !== "add-saving") state.editingSavingId = "";
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-month-offset]").forEach((element) => {
    element.addEventListener("click", () => {
      state.month = shiftMonth(state.month, Number(element.dataset.monthOffset || 0));
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-report-month], [data-report-year]").forEach((element) => {
    element.addEventListener("change", () => {
      const month = Number(document.querySelector("[data-report-month]")?.value || 0);
      const year = Number(document.querySelector("[data-report-year]")?.value || new Date().getFullYear());
      state.month = `${monthLabels[month]} ${year}`;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-expense-filter]").forEach((element) => {
    element.addEventListener("click", () => {
      state.expenseFilter = element.dataset.expenseFilter;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-expense-view]").forEach((element) => {
    element.addEventListener("click", () => {
      state.expenseView = element.dataset.expenseView;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-savings-view]").forEach((element) => {
    element.addEventListener("click", () => {
      state.savingsView = element.dataset.savingsView;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete-expense]").forEach((element) => {
    element.addEventListener("click", () => {
      const expenseId = Number(element.dataset.deleteExpense);
      const expense = state.expenses.find((item) => item.id === expenseId);
      if (!expense) return;
      const confirmed = window.confirm(`Delete ${expense.vendor} for ${formatGBP(expense.amount)}?`);
      if (!confirmed) return;
      state.expenses = state.expenses.filter((item) => item.id !== expenseId);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-edit-expense]").forEach((element) => {
    element.addEventListener("click", () => {
      state.editingExpenseId = Number(element.dataset.editExpense);
      state.route = "add-expense";
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete-saving]").forEach((element) => {
    element.addEventListener("click", () => {
      const savingId = Number(element.dataset.deleteSaving);
      const saving = state.savings.find((item) => item.id === savingId);
      if (!saving) return;
      const confirmed = window.confirm(`Delete ${saving.goal} for ${formatGBP(saving.amount)}?`);
      if (!confirmed) return;
      state.savings = state.savings.filter((item) => item.id !== savingId);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-edit-saving]").forEach((element) => {
    element.addEventListener("click", () => {
      state.editingSavingId = Number(element.dataset.editSaving);
      state.route = "add-saving";
      saveState();
      render();
    });
  });

  document.querySelector("[data-save-budget]")?.addEventListener("click", () => {
    const form = document.querySelector("#budget-form");
    if (!form) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const category = String(data.category || "").trim();
    const originalCategory = String(data.originalCategory || "").trim();
    const amount = Number(data.amount || 0);
    if (!category || amount < 0) return;

    if (originalCategory && originalCategory !== category) {
      delete state.expenseBudgets[originalCategory];
      state.expenseCategories = (state.expenseCategories || []).filter((name) => name !== originalCategory);
    }

    state.expenseCategories = [...new Set([...(state.expenseCategories || []), category])].sort();
    state.expenseBudgets = { ...(state.expenseBudgets || {}), [category]: amount };
    state.editingBudgetCategory = "";
    saveState();
    render();
  });

  document.querySelector("[data-cancel-budget-edit]")?.addEventListener("click", () => {
    state.editingBudgetCategory = "";
    saveState();
    render();
  });

  document.querySelectorAll("[data-edit-budget]").forEach((element) => {
    element.addEventListener("click", () => {
      state.editingBudgetCategory = element.dataset.editBudget;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete-budget]").forEach((element) => {
    element.addEventListener("click", () => {
      const category = element.dataset.deleteBudget;
      const confirmed = window.confirm(`Delete the ${category} budget? The category and expenses will remain.`);
      if (!confirmed) return;
      delete state.expenseBudgets[category];
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete-category]").forEach((element) => {
    element.addEventListener("click", () => {
      const category = element.dataset.deleteCategory;
      const isUsed = state.expenses.some((expense) => expense.category === category);
      const message = isUsed
        ? `${category} is used by existing expenses. Delete the budget only?`
        : `Delete the ${category} category and its budget?`;
      const confirmed = window.confirm(message);
      if (!confirmed) return;
      delete state.expenseBudgets[category];
      if (!isUsed) state.expenseCategories = (state.expenseCategories || []).filter((name) => name !== category);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-expense-type]").forEach((element) => {
    element.addEventListener("click", () => {
      setExpenseFormType(element.dataset.expenseType);
    });
  });

  document.querySelector("#expense-form select[name='type']")?.addEventListener("change", (event) => {
    setExpenseFormType(event.target.value);
  });

  document.querySelectorAll("#expense-form input[name='date'], #expense-form select[name='frequency'], #expense-form input[name='paymentCount']").forEach((element) => {
    element.addEventListener("input", updateRecurringFinalPayment);
    element.addEventListener("change", updateRecurringFinalPayment);
  });

  updateRecurringFinalPayment();

  document.querySelector("[data-submit-expense]")?.addEventListener("click", () => {
    const form = document.querySelector("#expense-form");
    const data = Object.fromEntries(new FormData(form).entries());
    const paymentCount = Number(data.paymentCount || 0);
    const finalPaymentDate = data.type === "Recurring" && paymentCount > 0 ? calculateFinalPaymentDate(data.date, data.frequency, paymentCount) : "";
    if (!data.vendor || !data.category || !data.date || Number(data.amount || 0) <= 0) {
      window.alert("Enter a vendor, category, date, and amount before saving.");
      return;
    }
    const expense = {
      id: state.editingExpenseId || Date.now(),
      vendor: String(data.vendor).trim(),
      category: data.category,
      date: data.date,
      type: data.type,
      amount: Number(data.amount || 0),
      status: data.type === "Recurring" ? "Scheduled" : data.status || "Paid",
      frequency: data.type === "Recurring" ? data.frequency : "",
      paymentCount: data.type === "Recurring" && paymentCount > 0 ? paymentCount : "",
      finalPaymentDate,
      notes: data.notes || "",
    };

    state.expenses = state.editingExpenseId ? state.expenses.map((item) => (item.id === state.editingExpenseId ? expense : item)) : [expense, ...state.expenses];
    state.editingExpenseId = "";
    state.route = "expenses";
    state.expenseView = "overview";
    saveState();
    render();
  });

  document.querySelector("[data-submit-saving]")?.addEventListener("click", () => {
    const form = document.querySelector("#saving-form");
    const data = Object.fromEntries(new FormData(form).entries());
    const currentGoal = latestGoalBalances().find((item) => item.goal === data.goal);
    if (!data.goal || !data.account || !data.date || Number(data.amount || 0) <= 0) {
      window.alert("Enter a goal, account, date, and amount before saving.");
      return;
    }
    const saving = {
      id: state.editingSavingId || Date.now(),
      goal: String(data.goal).trim(),
      account: String(data.account).trim(),
      date: data.date,
      type: data.type,
      amount: Number(data.amount || 0),
      target: Number(data.target || currentGoal?.target || 0),
      source: data.source || "",
      owner: data.owner || "",
      frequency: data.frequency || "",
      notes: data.notes || "",
      status: data.type === "Regular" ? "Scheduled" : "Saved",
    };
    state.savings = state.editingSavingId ? state.savings.map((item) => (item.id === state.editingSavingId ? saving : item)) : [saving, ...state.savings];
    state.editingSavingId = "";
    state.route = "savings";
    state.savingsView = "overview";
    saveState();
    render();
  });

  document.querySelector("[data-save-profile]")?.addEventListener("click", () => {
    const form = document.querySelector("#profile-form");
    const data = Object.fromEntries(new FormData(form).entries());
    state.userName = String(data.settingsUserName || "User").trim() || "User";
    state.householdName = String(data.settingsHouseholdName || "My Household").trim() || "My Household";
    saveState();
    render();
  });

  document.querySelector("[data-change-password]")?.addEventListener("click", () => {
    const form = document.querySelector("#password-form");
    const data = Object.fromEntries(new FormData(form).entries());
    if (!verifyPassword(data.currentPassword || "")) {
      window.alert("Current password is incorrect.");
      return;
    }
    if (!data.newPassword || data.newPassword.length < 6) {
      window.alert("New password must be at least 6 characters.");
      return;
    }
    if (data.newPassword !== data.newPasswordConfirm) {
      window.alert("New passwords do not match.");
      return;
    }
    state.passwordHash = passwordHash(data.newPassword);
    saveState();
    window.alert("Password updated.");
    render();
  });

  document.querySelector("[data-lock-app]")?.addEventListener("click", () => {
    sessionUnlocked = false;
    render();
  });
}

function bindAuthEvents() {
  document.querySelector("[data-setup-account]")?.addEventListener("click", () => {
    const form = document.querySelector("#setup-form");
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.setupPassword || data.setupPassword.length < 6) {
      window.alert("Password must be at least 6 characters.");
      return;
    }
    if (data.setupPassword !== data.setupPasswordConfirm) {
      window.alert("Passwords do not match.");
      return;
    }
    state.userName = String(data.setupUserName || "User").trim() || "User";
    state.householdName = String(data.setupHouseholdName || "My Household").trim() || "My Household";
    state.passwordHash = passwordHash(data.setupPassword);
    sessionUnlocked = true;
    saveState();
    render();
  });

  document.querySelector("[data-unlock-app]")?.addEventListener("click", () => {
    const form = document.querySelector("#unlock-form");
    const data = Object.fromEntries(new FormData(form).entries());
    if (!verifyPassword(data.unlockPassword || "")) {
      window.alert("Password is incorrect.");
      return;
    }
    sessionUnlocked = true;
    render();
  });
}

function setExpenseFormType(type) {
  const form = document.querySelector("#expense-form");
  if (!form) return;

  form.querySelectorAll("[data-expense-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.expenseType === type);
  });

  const typeSelect = form.querySelector("select[name='type']");
  if (typeSelect) typeSelect.value = type;

  const recurringFields = form.querySelectorAll("[data-recurring-field]");
  const oneOffField = form.querySelector("[data-oneoff-field]");
  recurringFields.forEach((fieldElement) => fieldElement.classList.toggle("is-hidden", type !== "Recurring"));
  oneOffField?.classList.toggle("is-hidden", type !== "One-off");
  updateRecurringFinalPayment();
}

function updateRecurringFinalPayment() {
  const form = document.querySelector("#expense-form");
  if (!form) return;

  const type = form.querySelector("select[name='type']")?.value || "Recurring";
  const date = form.querySelector("input[name='date']")?.value || "";
  const frequency = form.querySelector("select[name='frequency']")?.value || "Monthly";
  const paymentCount = Number(form.querySelector("input[name='paymentCount']")?.value || 0);
  const value = type === "Recurring" && paymentCount > 0 ? calculateFinalPaymentDate(date, frequency, paymentCount) : "";
  const label = value ? dateLabel(value) : "On-going";
  const finalPaymentDate = form.querySelector("input[name='finalPaymentDate']");
  const preview = form.querySelector("[data-final-payment-preview]");

  if (finalPaymentDate) finalPaymentDate.value = label;
  if (preview) preview.textContent = type === "Recurring" ? label : "Not recurring";
}

function calculateFinalPaymentDate(startDate, frequency, paymentCount) {
  if (!startDate || !paymentCount || paymentCount < 1) return "";

  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const increments = paymentCount - 1;
  if (frequency === "Weekly") date.setDate(date.getDate() + increments * 7);
  if (frequency === "Monthly") date.setMonth(date.getMonth() + increments);
  if (frequency === "Yearly") date.setFullYear(date.getFullYear() + increments);
  return toISODate(date);
}

render();
