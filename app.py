



from flask import Flask, render_template, request, jsonify
import sqlite3
from pathlib import Path

app = Flask(__name__)
DB_PATH = Path(__file__).with_name("planner.db")

# Only these tables and fields can be accessed through the API.
TABLES = {
    "tasks": {
        "title", "subject", "task_type", "due_date",
        "priority", "status", "description"
    },
    "notes": {"title", "subject", "content"},
    "timetable": {
        "day", "start_time", "end_time", "subject", "topic"
    },
    "sessions": {
        "title", "subject", "session_date", "start_time",
        "duration_minutes", "status"
    },
    "profile": {"name", "course", "semester", "daily_goal"},
    "settings": {"theme"},
    "goals": {"goal_date", "target_minutes", "studied_minutes"}
}

def connect_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def initialize_database():
    with connect_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                subject TEXT DEFAULT '',
                task_type TEXT DEFAULT 'Study',
                due_date TEXT DEFAULT '',
                priority TEXT DEFAULT 'Medium',
                status TEXT DEFAULT 'Pending',
                description TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                subject TEXT DEFAULT '',
                content TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS timetable (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                day TEXT NOT NULL,
                start_time TEXT DEFAULT '',
                end_time TEXT DEFAULT '',
                subject TEXT DEFAULT '',
                topic TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                subject TEXT DEFAULT '',
                session_date TEXT DEFAULT '',
                start_time TEXT DEFAULT '',
                duration_minutes INTEGER DEFAULT 25,
                status TEXT DEFAULT 'Planned'
            );

            CREATE TABLE IF NOT EXISTS profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                name TEXT DEFAULT 'Student',
                course TEXT DEFAULT '',
                semester TEXT DEFAULT '',
                daily_goal INTEGER DEFAULT 120
            );

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                theme TEXT DEFAULT 'light'
            );

            CREATE TABLE IF NOT EXISTS goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                goal_date TEXT NOT NULL UNIQUE,
                target_minutes INTEGER DEFAULT 120,
                studied_minutes INTEGER DEFAULT 0
            );
        """)

        db.execute("""
            INSERT OR IGNORE INTO profile
            (id, name, course, semester, daily_goal)
            VALUES (1, 'Student', '', '', 120)
        """)

        db.execute("""
            INSERT OR IGNORE INTO settings (id, theme)
            VALUES (1, 'light')
        """)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/api/<table>", methods=["GET", "POST"])
def collection(table):
    if table not in TABLES:
        return jsonify({"error": "Unknown resource"}), 404

    with connect_db() as db:
        if request.method == "GET":
            rows = db.execute(
                f"SELECT * FROM {table} ORDER BY id DESC"
            ).fetchall()
            return jsonify([dict(row) for row in rows])

        data = request.get_json(silent=True) or {}
        fields = TABLES[table]
        values = {
            key: value for key, value in data.items()
            if key in fields
        }

        if not values:
            return jsonify({"error": "No valid information provided"}), 400

        if table == "profile":
            db.execute("""
                UPDATE profile
                SET name = ?, course = ?, semester = ?, daily_goal = ?
                WHERE id = 1
            """, (
                values.get("name", "Student"),
                values.get("course", ""),
                values.get("semester", ""),
                values.get("daily_goal", 120)
            ))
            row = db.execute(
                "SELECT * FROM profile WHERE id = 1"
            ).fetchone()
            return jsonify(dict(row))

        if table == "settings":
            db.execute("""
                UPDATE settings SET theme = ? WHERE id = 1
            """, (values.get("theme", "light"),))
            row = db.execute(
                "SELECT * FROM settings WHERE id = 1"
            ).fetchone()
            return jsonify(dict(row))

        columns = list(values.keys())
        placeholders = ", ".join("?" for _ in columns)
        column_names = ", ".join(columns)

        cursor = db.execute(
            f"INSERT INTO {table} ({column_names}) "
            f"VALUES ({placeholders})",
            [values[column] for column in columns]
        )

        row = db.execute(
            f"SELECT * FROM {table} WHERE id = ?",
            (cursor.lastrowid,)
        ).fetchone()

        return jsonify(dict(row)), 201

@app.route("/api/<table>/<int:item_id>", methods=["PUT", "DELETE"])
def item(table, item_id):
    if table not in TABLES or table in ("profile", "settings"):
        return jsonify({"error": "Unknown resource"}), 404

    with connect_db() as db:
        existing = db.execute(
            f"SELECT * FROM {table} WHERE id = ?",
            (item_id,)
        ).fetchone()

        if existing is None:
            return jsonify({"error": "Item not found"}), 404

        if request.method == "DELETE":
            db.execute(
                f"DELETE FROM {table} WHERE id = ?",
                (item_id,)
            )
            return jsonify({"message": "Deleted successfully"})

        data = request.get_json(silent=True) or {}
        values = {
            key: value for key, value in data.items()
            if key in TABLES[table]
        }

        if not values:
            return jsonify({"error": "No valid information provided"}), 400

        assignments = ", ".join(
            f"{column} = ?" for column in values
        )

        db.execute(
            f"UPDATE {table} SET {assignments} WHERE id = ?",
            list(values.values()) + [item_id]
        )

        row = db.execute(
            f"SELECT * FROM {table} WHERE id = ?",
            (item_id,)
        ).fetchone()

        return jsonify(dict(row))

if __name__ == "__main__":
    initialize_database()
    app.run(debug=True)
