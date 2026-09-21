from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "dispute_expert.db"


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS matters (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                project_name TEXT NOT NULL DEFAULT '',
                stance TEXT NOT NULL DEFAULT '',
                counterparty TEXT NOT NULL DEFAULT '',
                stage TEXT NOT NULL DEFAULT '',
                dispute_type TEXT NOT NULL DEFAULT '',
                amount TEXT NOT NULL DEFAULT '',
                current_step INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS matter_sections (
                matter_id TEXT NOT NULL,
                section_type TEXT NOT NULL,
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (matter_id, section_type),
                FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS citations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                matter_id TEXT NOT NULL,
                library_type TEXT NOT NULL,
                doc_id TEXT NOT NULL,
                title TEXT NOT NULL,
                source_label TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(matter_id, library_type, doc_id),
                FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE
            );
            """
        )


def _matter_detail(db: sqlite3.Connection, matter_id: str) -> dict | None:
    row = db.execute("SELECT * FROM matters WHERE id = ?", (matter_id,)).fetchone()
    if not row:
        return None
    matter = dict(row)
    sections = db.execute("SELECT section_type, data_json FROM matter_sections WHERE matter_id = ?", (matter_id,)).fetchall()
    matter["sections"] = {item["section_type"]: json.loads(item["data_json"]) for item in sections}
    matter["citations"] = [dict(item) for item in db.execute("SELECT * FROM citations WHERE matter_id = ? ORDER BY id", (matter_id,))]
    return matter


def list_matters() -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT * FROM matters ORDER BY updated_at DESC").fetchall()
        return [dict(row) for row in rows]


def get_matter(matter_id: str) -> dict | None:
    with connect() as db:
        return _matter_detail(db, matter_id)


def create_matter(payload: dict) -> dict:
    now = datetime.now().isoformat(timespec="seconds")
    matter_id = uuid4().hex[:12]
    title = (payload.get("title") or payload.get("project_name") or "未命名纠纷").strip()
    with connect() as db:
        db.execute(
            "INSERT INTO matters (id,title,project_name,stance,counterparty,stage,dispute_type,amount,current_step,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (matter_id, title, payload.get("project_name", ""), payload.get("stance", ""), payload.get("counterparty", ""), payload.get("stage", ""), payload.get("dispute_type", ""), payload.get("amount", ""), int(payload.get("current_step", 1)), now, now),
        )
        return _matter_detail(db, matter_id)


def update_matter(matter_id: str, payload: dict) -> dict | None:
    now = datetime.now().isoformat(timespec="seconds")
    fields = ["title", "project_name", "stance", "counterparty", "stage", "dispute_type", "amount", "current_step"]
    with connect() as db:
        current = db.execute("SELECT * FROM matters WHERE id = ?", (matter_id,)).fetchone()
        if not current:
            return None
        values = {field: payload.get(field, current[field]) for field in fields}
        db.execute(
            "UPDATE matters SET title=?,project_name=?,stance=?,counterparty=?,stage=?,dispute_type=?,amount=?,current_step=?,updated_at=? WHERE id=?",
            (values["title"], values["project_name"], values["stance"], values["counterparty"], values["stage"], values["dispute_type"], values["amount"], int(values["current_step"]), now, matter_id),
        )
        for section_type, data in payload.get("sections", {}).items():
            db.execute(
                "INSERT INTO matter_sections (matter_id,section_type,data_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(matter_id,section_type) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at",
                (matter_id, section_type, json.dumps(data, ensure_ascii=False), now),
            )
        return _matter_detail(db, matter_id)


def delete_matter(matter_id: str) -> bool:
    with connect() as db:
        cursor = db.execute("DELETE FROM matters WHERE id = ?", (matter_id,))
        return cursor.rowcount > 0


def add_citation(matter_id: str, payload: dict) -> dict | None:
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as db:
        if not db.execute("SELECT 1 FROM matters WHERE id = ?", (matter_id,)).fetchone():
            return None
        db.execute(
            "INSERT OR IGNORE INTO citations (matter_id,library_type,doc_id,title,source_label,created_at) VALUES (?,?,?,?,?,?)",
            (matter_id, payload["library_type"], payload["doc_id"], payload["title"], payload["source_label"], now),
        )
        return _matter_detail(db, matter_id)
