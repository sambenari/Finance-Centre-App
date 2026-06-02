#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "database" / "schema.sql"
DEFAULT_DB_PATH = ROOT / "data" / "finance-centre.sqlite3"


def connect(db_path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    with SCHEMA_PATH.open("r", encoding="utf-8") as schema_file:
        connection.executescript(schema_file.read())
    migrate(connection)
    connection.commit()
    return connection


def migrate(connection):
    ensure_column(connection, "households", "second_pension_date_of_birth", "TEXT")
    ensure_column(connection, "users", "date_of_birth", "TEXT")
    ensure_column(connection, "users", "password_hash", "TEXT NOT NULL DEFAULT ''")
    ensure_column(connection, "expenses", "payment_count", "INTEGER")
    ensure_column(connection, "expenses", "final_payment_date", "TEXT")
    ensure_column(connection, "savings_contributions", "owner_name", "TEXT")


def ensure_column(connection, table, column, definition):
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def load_state(db_path):
    with connect(db_path) as connection:
        if has_normalized_state(connection):
            return load_normalized_state(connection)

        row = connection.execute("SELECT state_json FROM app_state WHERE id = 1").fetchone()
        if not row:
            return None

        state = json.loads(row["state_json"])
        save_normalized_state(connection, state)
        connection.commit()
        return load_normalized_state(connection)


def save_state(db_path, state):
    state_json = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
    with connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO app_state (id, state_json, updated_at)
            VALUES (1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              state_json = excluded.state_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (state_json,),
        )
        save_normalized_state(connection, state)
        connection.commit()


def has_normalized_state(connection):
    return (
        connection.execute("SELECT COUNT(*) AS count FROM households").fetchone()["count"] > 0
        or connection.execute("SELECT COUNT(*) AS count FROM expenses").fetchone()["count"] > 0
        or connection.execute("SELECT COUNT(*) AS count FROM savings_contributions").fetchone()["count"] > 0
    )


def save_normalized_state(connection, state):
    household_name = text_value(state.get("householdName")) or "My Household"
    user_name = text_value(state.get("userName")) or "User"
    password_hash = text_value(state.get("passwordHash"))
    user_date_of_birth = text_value(state.get("userDateOfBirth"))
    second_pension_date_of_birth = text_value(state.get("secondPensionDateOfBirth"))

    connection.execute(
        """
        INSERT INTO households (id, name, second_pension_date_of_birth)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          second_pension_date_of_birth = excluded.second_pension_date_of_birth
        """,
        (household_name, second_pension_date_of_birth),
    )
    connection.execute(
        """
        INSERT INTO users (id, household_id, name, date_of_birth, password_hash, role)
        VALUES (1, 1, ?, ?, ?, 'owner')
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          date_of_birth = excluded.date_of_birth,
          password_hash = excluded.password_hash,
          role = excluded.role
        """,
        (user_name, user_date_of_birth, password_hash),
    )

    clear_household_rows(connection, 1)

    category_names = set(state.get("expenseCategories") or [])
    category_names.update((state.get("expenseBudgets") or {}).keys())
    category_names.update(expense.get("category") for expense in state.get("expenses") or [] if expense.get("category"))
    category_ids = {}
    for name in sorted(filter(None, (text_value(name) for name in category_names))):
        category_ids[name] = upsert_expense_category(connection, 1, name, pounds_to_pence((state.get("expenseBudgets") or {}).get(name, 0)))

    for expense in state.get("expenses") or []:
        if not text_value(expense.get("vendor")) or not text_value(expense.get("date")):
            continue
        category_name = text_value(expense.get("category")) or "Unassigned"
        category_id = category_ids.get(category_name) or upsert_expense_category(connection, 1, category_name, 0)
        insert_expense(connection, 1, category_id, expense)

    goal_ids = {}
    account_ids = {}
    for saving in state.get("savings") or []:
        if not text_value(saving.get("goal")) or not text_value(saving.get("date")):
            continue
        goal_name = text_value(saving.get("goal")) or "Unassigned"
        target_pence = pounds_to_pence(saving.get("target", 0))
        if goal_name not in goal_ids:
            goal_ids[goal_name] = upsert_savings_goal(connection, 1, goal_name, target_pence)
        elif target_pence:
            connection.execute(
                "UPDATE savings_goals SET target_pence = MAX(target_pence, ?) WHERE id = ?",
                (target_pence, goal_ids[goal_name]),
            )

        account_name = text_value(saving.get("account")) or "Unassigned"
        if account_name not in account_ids:
            account_ids[account_name] = upsert_savings_account(connection, 1, account_name)

        insert_saving(connection, 1, goal_ids[goal_name], account_ids[account_name], saving)


def clear_household_rows(connection, household_id):
    for table in ("savings_contributions", "expenses", "savings_accounts", "savings_goals", "expense_categories"):
        connection.execute(f"DELETE FROM {table} WHERE household_id = ?", (household_id,))


def upsert_expense_category(connection, household_id, name, budget_pence):
    connection.execute(
        """
        INSERT INTO expense_categories (household_id, name, monthly_budget_pence)
        VALUES (?, ?, ?)
        ON CONFLICT(household_id, name) DO UPDATE SET monthly_budget_pence = excluded.monthly_budget_pence
        """,
        (household_id, name, budget_pence),
    )
    return connection.execute(
        "SELECT id FROM expense_categories WHERE household_id = ? AND name = ?",
        (household_id, name),
    ).fetchone()["id"]


def insert_expense(connection, household_id, category_id, expense):
    connection.execute(
        """
        INSERT INTO expenses (
          id, household_id, category_id, owner_user_id, vendor, amount_pence,
          expense_date, expense_type, status, frequency, payment_count,
          final_payment_date, payment_account, notes
        )
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            integer_id(expense.get("id")),
            household_id,
            category_id,
            text_value(expense.get("vendor")) or "Unnamed expense",
            pounds_to_pence(expense.get("amount", 0)),
            text_value(expense.get("date")),
            expense_type_to_db(expense.get("type")),
            expense_status_to_db(expense.get("status")),
            text_value(expense.get("frequency")),
            nullable_int(expense.get("paymentCount")),
            text_value(expense.get("finalPaymentDate")),
            text_value(expense.get("account")),
            text_value(expense.get("notes")),
        ),
    )


def upsert_savings_goal(connection, household_id, name, target_pence):
    connection.execute(
        """
        INSERT INTO savings_goals (household_id, name, target_pence)
        VALUES (?, ?, ?)
        ON CONFLICT(household_id, name) DO UPDATE SET target_pence = MAX(target_pence, excluded.target_pence)
        """,
        (household_id, name, target_pence),
    )
    return connection.execute(
        "SELECT id FROM savings_goals WHERE household_id = ? AND name = ?",
        (household_id, name),
    ).fetchone()["id"]


def upsert_savings_account(connection, household_id, account_name):
    provider = account_name.split(" ", 1)[0] if account_name else "Unassigned"
    connection.execute(
        """
        INSERT INTO savings_accounts (household_id, provider, account_name)
        VALUES (?, ?, ?)
        """,
        (household_id, provider, account_name),
    )
    return connection.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]


def insert_saving(connection, household_id, goal_id, account_id, saving):
    connection.execute(
        """
        INSERT INTO savings_contributions (
          id, household_id, goal_id, account_id, owner_user_id, amount_pence,
          contribution_date, contribution_type, status, frequency, source_account,
          owner_name, notes
        )
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            integer_id(saving.get("id")),
            household_id,
            goal_id,
            account_id,
            pounds_to_pence(saving.get("amount", 0)),
            text_value(saving.get("date")),
            saving_type_to_db(saving.get("type")),
            saving_status_to_db(saving.get("status"), saving.get("type")),
            text_value(saving.get("frequency")),
            text_value(saving.get("source")),
            text_value(saving.get("owner")),
            text_value(saving.get("notes")),
        ),
    )


def load_normalized_state(connection):
    cached = cached_ui_state(connection)
    household = connection.execute("SELECT name, second_pension_date_of_birth FROM households WHERE id = 1").fetchone()
    user = connection.execute("SELECT name, date_of_birth, password_hash FROM users WHERE id = 1").fetchone()
    categories = connection.execute(
        "SELECT name, monthly_budget_pence FROM expense_categories WHERE household_id = 1 ORDER BY name"
    ).fetchall()

    state = {
        "route": cached.get("route", "dashboard"),
        "month": cached.get("month"),
        "userName": user["name"] if user else cached.get("userName", ""),
        "householdName": household["name"] if household else cached.get("householdName", ""),
        "passwordHash": user["password_hash"] if user else cached.get("passwordHash", ""),
        "userDateOfBirth": user["date_of_birth"] if user else cached.get("userDateOfBirth", ""),
        "secondPensionDateOfBirth": household["second_pension_date_of_birth"] if household else cached.get("secondPensionDateOfBirth", ""),
        "expenseFilter": cached.get("expenseFilter", "All"),
        "expenseView": cached.get("expenseView", "overview"),
        "retirementSimulator": cached.get("retirementSimulator", {}),
        "expenses": load_expenses(connection),
        "expenseCategories": [row["name"] for row in categories],
        "expenseBudgets": {
            row["name"]: pence_to_pounds(row["monthly_budget_pence"])
            for row in categories
            if row["monthly_budget_pence"] > 0
        },
        "savingsView": cached.get("savingsView", "overview"),
        "savings": load_savings(connection),
    }
    return {key: value for key, value in state.items() if value is not None}


def cached_ui_state(connection):
    row = connection.execute("SELECT state_json FROM app_state WHERE id = 1").fetchone()
    if not row:
        return {}
    try:
        return json.loads(row["state_json"])
    except json.JSONDecodeError:
        return {}


def load_expenses(connection):
    rows = connection.execute(
        """
        SELECT expenses.*, expense_categories.name AS category_name
        FROM expenses
        LEFT JOIN expense_categories ON expense_categories.id = expenses.category_id
        WHERE expenses.household_id = 1
        ORDER BY expenses.expense_date DESC, expenses.id DESC
        """
    ).fetchall()
    return [
        {
            "id": row["id"],
            "vendor": row["vendor"],
            "category": row["category_name"] or "Unassigned",
            "date": row["expense_date"],
            "type": expense_type_from_db(row["expense_type"]),
            "amount": pence_to_pounds(row["amount_pence"]),
            "status": expense_status_from_db(row["status"]),
            "frequency": row["frequency"] or "",
            "paymentCount": row["payment_count"] or "",
            "finalPaymentDate": row["final_payment_date"] or "",
            "account": row["payment_account"] or "",
            "notes": row["notes"] or "",
        }
        for row in rows
    ]


def load_savings(connection):
    rows = connection.execute(
        """
        SELECT savings_contributions.*, savings_goals.name AS goal_name,
               savings_goals.target_pence, savings_accounts.account_name
        FROM savings_contributions
        JOIN savings_goals ON savings_goals.id = savings_contributions.goal_id
        LEFT JOIN savings_accounts ON savings_accounts.id = savings_contributions.account_id
        WHERE savings_contributions.household_id = 1
        ORDER BY savings_contributions.contribution_date DESC, savings_contributions.id DESC
        """
    ).fetchall()
    return [
        {
            "id": row["id"],
            "goal": row["goal_name"],
            "account": row["account_name"] or "Unassigned",
            "date": row["contribution_date"],
            "type": saving_type_from_db(row["contribution_type"]),
            "amount": pence_to_pounds(row["amount_pence"]),
            "target": pence_to_pounds(row["target_pence"]),
            "source": row["source_account"] or "",
            "owner": row["owner_name"] or "",
            "frequency": row["frequency"] or "",
            "notes": row["notes"] or "",
            "status": saving_status_from_db(row["status"]),
        }
        for row in rows
    ]


def text_value(value):
    return str(value).strip() if value is not None else ""


def integer_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def nullable_int(value):
    try:
        number = int(value)
        return number if number > 0 else None
    except (TypeError, ValueError):
        return None


def pounds_to_pence(value):
    try:
        return int(round(float(value or 0) * 100))
    except (TypeError, ValueError):
        return 0


def pence_to_pounds(value):
    return round((value or 0) / 100, 2)


def expense_type_to_db(value):
    return "recurring" if "recurring" in text_value(value).lower() else "one_off"


def expense_type_from_db(value):
    return "Recurring" if value == "recurring" else "One-off"


def expense_status_to_db(value):
    normalized = text_value(value).lower()
    if normalized == "due":
        return "due"
    if normalized == "paid":
        return "paid"
    return "scheduled"


def expense_status_from_db(value):
    return {"paid": "Paid", "due": "Due", "scheduled": "Scheduled"}.get(value, "Scheduled")


def saving_type_to_db(value):
    return "one_off" if "one" in text_value(value).lower() else "regular"


def saving_type_from_db(value):
    return "One-off" if value == "one_off" else "Regular"


def saving_status_to_db(status, saving_type):
    normalized = text_value(status).lower()
    if normalized == "saved" or saving_type_to_db(saving_type) == "one_off":
        return "saved"
    return "scheduled"


def saving_status_from_db(value):
    return "Saved" if value == "saved" else "Scheduled"


class FinanceCentreHandler(SimpleHTTPRequestHandler):
    db_path = DEFAULT_DB_PATH

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(ROOT if directory is None else directory), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self.write_json({"ok": True})
            return

        if self.path == "/api/state":
            self.write_json({"state": load_state(self.db_path)})
            return

        super().do_GET()

    def do_PUT(self):
        if self.path != "/api/state":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            body = self.read_json_body()
            state = body.get("state")
            if not isinstance(state, dict):
                raise ValueError("state must be an object")
            save_state(self.db_path, state)
        except (json.JSONDecodeError, ValueError) as error:
            self.write_json({"ok": False, "error": str(error)}, HTTPStatus.BAD_REQUEST)
            return

        self.write_json({"ok": True})

    def do_POST(self):
        self.do_PUT()

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length).decode("utf-8")
        return json.loads(raw_body or "{}")

    def write_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path):
        path = unquote(path.split("?", 1)[0].split("#", 1)[0])
        if path == "/":
            path = "/index.html"
        return super().translate_path(path)


def main():
    parser = argparse.ArgumentParser(description="Run the local Finance Centre SQLite server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "4273")))
    parser.add_argument("--db", default=os.environ.get("FINANCE_CENTRE_DB", str(DEFAULT_DB_PATH)))
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    connect(db_path).close()
    FinanceCentreHandler.db_path = db_path
    server = ThreadingHTTPServer((args.host, args.port), FinanceCentreHandler)
    print(f"Finance Centre serving http://{args.host}:{args.port}/")
    print(f"SQLite database: {db_path}")
    server.serve_forever()


if __name__ == "__main__":
    main()
