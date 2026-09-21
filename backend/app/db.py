"""SQLite storage for the invoice review queue."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from . import pnl
from .schemas import Extraction

DB_PATH = Path(__file__).resolve().parent.parent / "invoices.db"

# Fields scoring below this are flagged for human review.
CONFIDENCE_THRESHOLD = 0.8


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS invoices (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                filename        TEXT NOT NULL,
                source          TEXT NOT NULL DEFAULT 'upload',
                status          TEXT NOT NULL DEFAULT 'pending',
                direction       TEXT NOT NULL DEFAULT 'received',
                pl_account      TEXT,
                vendor          TEXT,
                invoice_date    TEXT,
                invoice_number  TEXT,
                currency        TEXT,
                subtotal        REAL,
                tax             REAL,
                total           REAL,
                category        TEXT,
                category_alternatives TEXT NOT NULL DEFAULT '[]',
                line_items      TEXT NOT NULL DEFAULT '[]',
                confidence      TEXT NOT NULL DEFAULT '{}',
                created_at      TEXT NOT NULL
            )
            """
        )
        # Migrate older DBs that predate the P&L columns.
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(invoices)")}
        if "direction" not in cols:
            conn.execute(
                "ALTER TABLE invoices ADD COLUMN direction TEXT NOT NULL DEFAULT 'received'"
            )
        if "pl_account" not in cols:
            conn.execute("ALTER TABLE invoices ADD COLUMN pl_account TEXT")
        if "category_alternatives" not in cols:
            conn.execute(
                "ALTER TABLE invoices ADD COLUMN category_alternatives TEXT NOT NULL DEFAULT '[]'"
            )
        if "gst_treatment" not in cols:
            # How a no-GST-line sale was resolved (inclusive/exempt/zero_rated/no_gst).
            conn.execute("ALTER TABLE invoices ADD COLUMN gst_treatment TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pl_entries (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                period      TEXT NOT NULL,
                pl_account  TEXT NOT NULL,
                amount      REAL NOT NULL,
                note        TEXT,
                created_at  TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )


def get_setting(key: str, default: str) -> str:
    with _connect() as conn:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def insert_extraction(
    filename: str,
    extraction: Extraction,
    source: str = "upload",
    direction: str = "received",
) -> int:
    # P&L account: sales invoices -> Sales; bills -> the AI-assigned category.
    pl_account = (
        "sales" if direction == "sent"
        else pnl.category_to_account(extraction.category)
    )
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO invoices (
                filename, source, status, direction, pl_account,
                vendor, invoice_date, invoice_number,
                currency, subtotal, tax, total, category, category_alternatives,
                line_items, confidence, created_at
            ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                filename,
                source,
                direction,
                pl_account,
                extraction.vendor,
                extraction.invoice_date,
                extraction.invoice_number,
                extraction.currency,
                extraction.subtotal,
                extraction.tax,
                extraction.total,
                extraction.category,
                json.dumps([a.model_dump() for a in extraction.alternatives]),
                json.dumps([li.model_dump() for li in extraction.line_items]),
                json.dumps(extraction.confidence.model_dump()),
                _now(),
            ),
        )
        return int(cur.lastrowid)


# Columns a user is allowed to edit from the review table.
EDITABLE = {
    "vendor", "invoice_date", "invoice_number", "currency",
    "subtotal", "tax", "total", "category", "status",
    "direction", "pl_account", "gst_treatment",
}


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["line_items"] = json.loads(d["line_items"])
    d["category_alternatives"] = json.loads(d.get("category_alternatives") or "[]")
    confidence = json.loads(d["confidence"])
    d["confidence"] = confidence
    # Which fields fall below the review threshold.
    d["flagged_fields"] = [
        f for f, c in confidence.items() if c < CONFIDENCE_THRESHOLD
    ]
    d["needs_review"] = len(d["flagged_fields"]) > 0
    return d


def list_invoices() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM invoices ORDER BY created_at DESC"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_invoice(invoice_id: int) -> Optional[dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM invoices WHERE id = ?", (invoice_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def update_invoice(invoice_id: int, updates: dict[str, Any]) -> Optional[dict[str, Any]]:
    fields = {k: v for k, v in updates.items() if k in EDITABLE}
    # Editing the category re-points the P&L account so the two stay in sync.
    if "category" in fields and "pl_account" not in updates:
        fields["pl_account"] = pnl.category_to_account(fields["category"])
    if fields:
        assignments = ", ".join(f"{k} = ?" for k in fields)
        with _connect() as conn:
            conn.execute(
                f"UPDATE invoices SET {assignments} WHERE id = ?",
                (*fields.values(), invoice_id),
            )
    return get_invoice(invoice_id)


def set_categorization(
    invoice_id: int, category: str, confidence: float, alternatives: list[dict[str, Any]]
) -> Optional[dict[str, Any]]:
    """Apply a (re-)categorization: category, its P&L account, alternatives, confidence."""
    inv = get_invoice(invoice_id)
    if not inv:
        return None
    conf = inv["confidence"]
    conf["category"] = confidence
    pl_account = (
        "sales" if inv["direction"] == "sent" else pnl.category_to_account(category)
    )
    with _connect() as conn:
        conn.execute(
            "UPDATE invoices SET category = ?, pl_account = ?, "
            "category_alternatives = ?, confidence = ? WHERE id = ?",
            (category, pl_account, json.dumps(alternatives), json.dumps(conf), invoice_id),
        )
    return get_invoice(invoice_id)


def approved_invoices() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM invoices WHERE status = 'approved' ORDER BY created_at"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


# --- Manual P&L entries (non-invoice lines: wages, rent, tax, etc.) ---


def add_pl_entry(period: str, pl_account: str, amount: float, note: str = "") -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO pl_entries (period, pl_account, amount, note, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (period, pl_account, amount, note, _now()),
        )
        return int(cur.lastrowid)


def list_pl_entries(period: Optional[str] = None) -> list[dict[str, Any]]:
    with _connect() as conn:
        if period:
            rows = conn.execute(
                "SELECT * FROM pl_entries WHERE period = ? ORDER BY id", (period,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM pl_entries ORDER BY period, id"
            ).fetchall()
    return [dict(r) for r in rows]


def delete_pl_entry(entry_id: int) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM pl_entries WHERE id = ?", (entry_id,))
