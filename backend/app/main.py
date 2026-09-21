"""FastAPI app: upload -> extract -> review queue -> CSV export."""
from __future__ import annotations

import asyncio
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

# Load the project-root .env (one level above backend/).
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import Response  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from . import db, duplicates, gmail_poller, insights, pnl, tax  # noqa: E402
from .csv_export import to_csv  # noqa: E402
from .extractor import (  # noqa: E402
    SUPPORTED_MIME,
    categorize,
    chat,
    extract,
    finance_review,
)

app = FastAPI(title="Invoice / Data-Entry Processor")

# --- Email auto-poll settings (persisted in app_settings) ---
AUTO_KEY = "email_auto_enabled"
INTERVAL_KEY = "email_interval_seconds"
DEFAULT_INTERVAL = 300
MIN_INTERVAL = 30
# How often the loop wakes to check whether a poll is due.
_LOOP_CADENCE = 10
# When the last poll ran (any trigger), so auto-poll spaces itself correctly.
_last_poll_at: Optional[datetime] = None


def _auto_enabled() -> bool:
    return db.get_setting(AUTO_KEY, "0") == "1"


def _interval() -> int:
    try:
        return max(MIN_INTERVAL, int(db.get_setting(INTERVAL_KEY, str(DEFAULT_INTERVAL))))
    except ValueError:
        return DEFAULT_INTERVAL


async def _run_poll() -> dict[str, Any]:
    """Run the (blocking) Gmail poll off the event loop, tracking last-poll time."""
    global _last_poll_at
    result = await asyncio.to_thread(gmail_poller.poll_inbox)
    _last_poll_at = datetime.now(timezone.utc)
    return result


async def _auto_poll_loop() -> None:
    global _last_poll_at
    while True:
        await asyncio.sleep(_LOOP_CADENCE)
        try:
            if not (_auto_enabled() and gmail_poller.is_authed()):
                continue
            due = (
                _last_poll_at is None
                or (datetime.now(timezone.utc) - _last_poll_at).total_seconds()
                >= _interval()
            )
            if due:
                await _run_poll()
        except Exception:  # never let the loop die on a transient failure
            _last_poll_at = datetime.now(timezone.utc)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    db.init_db()
    asyncio.create_task(_auto_poll_loop())


def _guess_mime(upload: UploadFile) -> str:
    if upload.content_type and upload.content_type in SUPPORTED_MIME:
        return upload.content_type
    guessed, _ = mimetypes.guess_type(upload.filename or "")
    return guessed or ""


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# --- Business profile (drives GST resolution + tax provision) ---


def _business_settings() -> dict[str, str]:
    return {
        k: db.get_setting(f"biz_{k}", default)
        for k, default in tax.DEFAULT_SETTINGS.items()
    }


class BusinessSettings(BaseModel):
    gst_registration: str
    gstin: str = ""
    entity_type: str


def _business_state() -> dict[str, Any]:
    s = _business_settings()
    return {
        **s,
        "gstin_check": tax.gstin_info(s["gstin"]),
        "entity_types": [
            {"key": k, "label": v["label"], "rate_label": v["rate_label"]}
            for k, v in tax.ENTITY_TYPES.items()
        ],
        "registrations": [
            {"key": k, "label": v} for k, v in tax.GST_REGISTRATIONS.items()
        ],
        "rates_as_of": tax.RATES_AS_OF,
    }


@app.get("/settings/business")
def get_business_settings() -> dict[str, Any]:
    return _business_state()


@app.get("/settings/gstin-check")
def check_gstin(gstin: str) -> dict[str, Any]:
    """Validate a GSTIN (format + checksum) and infer entity type, live."""
    return tax.gstin_info(gstin)


@app.put("/settings/business")
def put_business_settings(settings: BusinessSettings) -> dict[str, Any]:
    if settings.gst_registration not in tax.GST_REGISTRATIONS:
        raise HTTPException(status_code=400, detail="Unknown registration type")
    if settings.entity_type not in tax.ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Unknown entity type")
    db.set_setting("biz_gst_registration", settings.gst_registration)
    db.set_setting("biz_gstin", settings.gstin.strip().upper())
    db.set_setting("biz_entity_type", settings.entity_type)
    return _business_state()


@app.post("/upload")
async def upload(
    files: list[UploadFile] = File(...),
    direction: str = Form("received"),
) -> dict[str, Any]:
    """Extract one or many documents and add them to the review queue.

    `direction`: 'received' (a bill you got -> expense) or 'sent' (a sales
    invoice you issued -> revenue).
    """
    direction = "sent" if direction == "sent" else "received"
    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for f in files:
        mime = _guess_mime(f)
        if mime not in SUPPORTED_MIME:
            errors.append({"filename": f.filename or "", "error": f"unsupported type ({mime or 'unknown'})"})
            continue
        try:
            data = await f.read()
            extraction = extract(data, mime)
            invoice_id = db.insert_extraction(
                f.filename or "untitled", extraction, direction=direction
            )
            results.append(db.get_invoice(invoice_id))
        except Exception as e:  # surface extraction failures per-file, don't fail the batch
            errors.append({"filename": f.filename or "", "error": str(e)})
    return {"invoices": results, "errors": errors}


@app.get("/invoices")
def list_invoices() -> dict[str, Any]:
    return {"invoices": db.list_invoices()}


@app.get("/invoices/duplicates")
def invoice_duplicates() -> dict[str, Any]:
    """Map of invoice id -> duplicate/double-billing flag (computed, not stored)."""
    return {"duplicates": duplicates.find_duplicates(db.list_invoices())}


@app.get("/invoices/gst-flags")
def invoice_gst_flags() -> dict[str, Any]:
    """Map of invoice id -> unresolved GST flag on sales (computed, not stored).

    A registered seller's taxable sale with no GST line is assumed
    GST-inclusive @ the standard rate until the user resolves it.
    """
    settings = _business_settings()
    flags: dict[int, dict[str, Any]] = {}
    for inv in db.list_invoices():
        if inv.get("direction") != "sent":
            continue
        r = tax.resolve_sale(inv, settings)
        if r["flag"]:
            flags[inv["id"]] = {
                "gst": r["gst"],
                "base": r["base"],
                "rate": tax.GST_STANDARD_RATE,
            }
    return {"flags": flags, "treatments": tax.GST_TREATMENTS}


@app.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int) -> dict[str, Any]:
    inv = db.get_invoice(invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv


@app.patch("/invoices/{invoice_id}")
def patch_invoice(invoice_id: int, updates: dict[str, Any]) -> dict[str, Any]:
    if not db.get_invoice(invoice_id):
        raise HTTPException(status_code=404, detail="Invoice not found")
    return db.update_invoice(invoice_id, updates)


@app.post("/invoices/recategorize")
def recategorize_invoices() -> dict[str, Any]:
    """Re-run AI categorization on received bills using their extracted text.

    Cheap text-only calls (no vision) — used to (re)classify invoices that were
    processed before categorization was wired up.
    """
    updated, errors = 0, []
    for inv in db.list_invoices():
        if inv["direction"] == "sent":
            continue  # sales invoices are revenue, not an expense category
        try:
            res = categorize(inv.get("vendor") or "", inv["line_items"], inv.get("currency") or "")
            db.set_categorization(
                inv["id"], res.category, res.confidence,
                [a.model_dump() for a in res.alternatives],
            )
            updated += 1
        except Exception as e:
            errors.append({"id": inv["id"], "error": str(e)})
    return {"updated": updated, "errors": errors}


@app.get("/export.csv")
def export_csv(ids: Optional[str] = None) -> Response:
    """Export approved invoices, or a specific set when `ids` is given (e.g. one session)."""
    if ids:
        wanted = [int(x) for x in ids.split(",") if x.strip().isdigit()]
        rows = [inv for i in wanted if (inv := db.get_invoice(i))]
    else:
        rows = db.approved_invoices()
    return Response(
        content=to_csv(rows),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=invoices.csv"},
    )


@app.get("/invoices/{invoice_id}/export.csv")
def export_invoice_csv(invoice_id: int) -> Response:
    inv = db.get_invoice(invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    csv_text = to_csv([inv])
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=invoice-{invoice_id}.csv"},
    )


# --- Overview: insights + AI finance review ---


@app.get("/insights")
def get_insights(period: str) -> dict[str, Any]:
    """Computed dashboard metrics for a period (deterministic, no model call)."""
    invoices = db.list_invoices()
    entries = db.list_pl_entries()
    dup = duplicates.find_duplicates(invoices)
    return insights.compute_insights(period, invoices, entries, dup, _business_settings())


@app.get("/insights/review")
def get_insights_review(period: str) -> dict[str, Any]:
    """AI-written executive review of the period (one LLM call)."""
    invoices = db.list_invoices()
    entries = db.list_pl_entries()
    dup = duplicates.find_duplicates(invoices)
    metrics = insights.compute_insights(period, invoices, entries, dup, _business_settings())
    return {"review": finance_review(metrics), "metrics": metrics}


class ChatIn(BaseModel):
    question: str
    history: list[dict[str, str]] = []


@app.post("/chat")
def chat_endpoint(body: ChatIn) -> dict[str, str]:
    """Answer a question about the invoice data (one LLM call, grounded in the DB)."""
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Empty question")
    context = insights.chat_context(db.list_invoices())
    try:
        return {"answer": chat(body.question, body.history, context)}
    except Exception as e:  # Gemini overload (503) etc. — return a real error, not an uncaught 500
        raise HTTPException(
            status_code=503,
            detail="The assistant is busy right now (the AI model is under high demand). Please try again in a moment.",
        ) from e


# --- Profit & Loss ---


class PLEntryIn(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")  # YYYY-MM
    pl_account: str
    amount: float
    note: str = ""


def _valid_account(key: str) -> None:
    if key not in pnl.ACCOUNTS:
        raise HTTPException(status_code=400, detail=f"Unknown P&L account: {key}")


@app.get("/pnl/accounts")
def pnl_accounts() -> dict[str, Any]:
    return {"accounts": pnl.accounts_catalog()}


@app.get("/pnl")
def get_pnl(period: str) -> dict[str, Any]:
    """Computed P&L statement for a period: month (2026-01), quarter (2026-Q1), or year (2026)."""
    invoices = db.list_invoices()
    entries = db.list_pl_entries()
    return pnl.compute(period, invoices, entries, _business_settings())


@app.get("/pnl/compare")
def compare_pnl(periods: str) -> dict[str, Any]:
    """Statements for several periods at once (comma-separated specs of the same kind)."""
    wanted = [p.strip() for p in periods.split(",") if p.strip()]
    invoices = db.list_invoices()
    entries = db.list_pl_entries()
    settings = _business_settings()
    statements = [pnl.compute(p, invoices, entries, settings) for p in wanted]
    return {"statements": statements}


@app.get("/pnl/entries")
def list_pnl_entries(month: Optional[str] = None) -> dict[str, Any]:
    return {"entries": db.list_pl_entries(month)}


@app.post("/pnl/entries")
def create_pnl_entry(entry: PLEntryIn) -> dict[str, Any]:
    _valid_account(entry.pl_account)
    entry_id = db.add_pl_entry(entry.period, entry.pl_account, entry.amount, entry.note)
    return {"id": entry_id}


@app.delete("/pnl/entries/{entry_id}")
def delete_pnl_entry(entry_id: int) -> dict[str, str]:
    db.delete_pl_entry(entry_id)
    return {"status": "deleted"}


@app.post("/pnl/tax-provision/approve")
def approve_tax_provision(period: str) -> dict[str, Any]:
    """Book the estimated tax provision as a manual entry, confirming it.

    The estimate is computed on the period's profit; approving writes it to the
    tax_expense account in the period's final month, after which compute() shows
    the booked figure (no longer an estimate). Delete that entry to revert.
    """
    invoices = db.list_invoices()
    entries = db.list_pl_entries()
    settings = _business_settings()
    stmt = pnl.compute(period, invoices, entries, settings)
    if not stmt.get("tax_detail"):
        raise HTTPException(status_code=400, detail="Tax is already booked for this period")
    amount = stmt["totals"]["tax_expense"]
    if round(amount, 2) == 0:
        raise HTTPException(status_code=400, detail="No tax to provision (nil estimate)")
    _, months = pnl.expand_period(period)
    detail = stmt["tax_detail"]
    note = f"Provision for tax — {detail['entity_label']} ({detail['rate_label']}), approved estimate"
    entry_id = db.add_pl_entry(months[-1], "tax_expense", amount, note)
    return {"id": entry_id, "amount": amount, "period": months[-1]}


@app.get("/pnl/entries/template.csv")
def pnl_entries_template() -> Response:
    """A blank sheet users can fill offline and upload back."""
    lines = ["period,account,amount,note",
             "2026-01,salaries_wages,12000,Example: staff salaries",
             "2026-01,rent_utilities,8000,Example: office rent"]
    return Response(
        content="\n".join(lines) + "\n",
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=pnl-entries-template.csv"},
    )


@app.post("/pnl/entries/upload")
async def upload_pnl_entries(file: UploadFile = File(...)) -> dict[str, Any]:
    """Bulk-add manual entries from a filled-in sheet (period,account,amount,note)."""
    import csv as _csv
    import io as _io

    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = _csv.DictReader(_io.StringIO(raw))
    added, errors = 0, []
    for i, row in enumerate(reader, start=2):  # row 1 is the header
        norm = { (k or "").strip().lower(): (v or "").strip() for k, v in row.items() }
        period, acct_text, amount_text = norm.get("period", ""), norm.get("account", ""), norm.get("amount", "")
        if not (period and acct_text and amount_text):
            continue  # skip blank lines
        acct = pnl.resolve_account(acct_text)
        if not acct:
            errors.append({"row": i, "error": f"unknown account '{acct_text}'"})
            continue
        try:
            amount = float(amount_text)
        except ValueError:
            errors.append({"row": i, "error": f"bad amount '{amount_text}'"})
            continue
        if not re.match(r"^\d{4}-\d{2}$", period):
            errors.append({"row": i, "error": f"bad period '{period}' (use YYYY-MM)"})
            continue
        db.add_pl_entry(period, acct, amount, norm.get("note", ""))
        added += 1
    return {"added": added, "errors": errors}


# --- Email ingestion ---


class EmailSettings(BaseModel):
    auto_enabled: bool
    interval_seconds: int = Field(ge=MIN_INTERVAL)


def _email_state() -> dict[str, Any]:
    return {
        "auto_enabled": _auto_enabled(),
        "interval_seconds": _interval(),
        "configured": gmail_poller.is_configured(),
        "authed": gmail_poller.is_authed(),
        "last_poll": _last_poll_at.isoformat() if _last_poll_at else None,
    }


@app.get("/email/settings")
def get_email_settings() -> dict[str, Any]:
    return _email_state()


@app.put("/email/settings")
def put_email_settings(settings: EmailSettings) -> dict[str, Any]:
    db.set_setting(AUTO_KEY, "1" if settings.auto_enabled else "0")
    db.set_setting(INTERVAL_KEY, str(settings.interval_seconds))
    return _email_state()


@app.post("/email/poll")
async def poll_email() -> dict[str, Any]:
    if not gmail_poller.is_authed():
        raise HTTPException(
            status_code=400,
            detail="Gmail not connected. Add credentials.json and run gmail_auth.py.",
        )
    try:
        return await _run_poll()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
