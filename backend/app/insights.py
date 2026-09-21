"""Analytics over the invoice set for the Overview tab.

One deterministic engine (no LLM) that produces every number the dashboard
cards show *and* the structured input the AI finance review is written from.
Amounts are net of tax, consistent with pnl.py.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from . import pnl, tax


def previous_period(spec: str) -> str:
    """The period immediately before this one (same granularity)."""
    spec = spec.strip()
    q = re.match(r"^(\d{4})-Q([1-4])$", spec, re.IGNORECASE)
    if q:
        year, quarter = int(q.group(1)), int(q.group(2))
        return f"{year - 1}-Q4" if quarter == 1 else f"{year}-Q{quarter - 1}"
    if re.match(r"^\d{4}-\d{2}$", spec):
        y, m = (int(x) for x in spec.split("-"))
        return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"
    if re.match(r"^\d{4}$", spec):
        return str(int(spec) - 1)
    return spec


def _pct_change(curr: float, prev: float) -> Optional[float]:
    """Percent change from prev to curr; None when there's no prior base."""
    if not prev:
        return None
    return round((curr - prev) / abs(prev) * 100, 1)


def _dominant_currency(invoices: list[dict[str, Any]]) -> str:
    counts: dict[str, int] = {}
    for i in invoices:
        c = (i.get("currency") or "").strip()
        if c:
            counts[c] = counts.get(c, 0) + 1
    return max(counts, key=counts.get) if counts else "INR"


def _expense_by_account(received: list[dict[str, Any]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for i in received:
        key = i.get("pl_account") or "other_expenses"
        out[key] = out.get(key, 0.0) + pnl.invoice_pl_amount(i)
    return out


def chat_context(invoices: list[dict[str, Any]]) -> str:
    """Compact, model-readable dump of every invoice for the chat assistant."""
    lines = []
    for i in sorted(invoices, key=lambda x: x.get("invoice_date") or ""):
        acct = i.get("pl_account") or ""
        label = pnl.ACCOUNTS.get(acct, {}).get("label", acct or "uncategorized")
        kind = "SALE" if i.get("direction") == "sent" else "BILL"
        lines.append(
            f"#{i['id']} {kind} {i.get('invoice_date') or '?'} | "
            f"{i.get('vendor') or '?'} | no:{i.get('invoice_number') or '-'} | "
            f"{label} | subtotal={i.get('subtotal')} tax={i.get('tax')} "
            f"total={i.get('total')} {i.get('currency') or ''} | {i.get('status')}"
        )
    header = (
        f"{len(invoices)} invoices total. SALE = revenue (invoice we issued), "
        f"BILL = expense (invoice we received). One per line:"
    )
    return header + "\n" + "\n".join(lines)


def compute_insights(
    period: str,
    invoices: list[dict[str, Any]],
    entries: list[dict[str, Any]],
    dup_map: dict[int, dict[str, Any]],
    settings: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    label, months = pnl.expand_period(period)
    monthset = set(months)
    in_period = [i for i in invoices if pnl._period_of(i.get("invoice_date")) in monthset]
    received = [i for i in in_period if i.get("direction") != "sent"]
    sent = [i for i in in_period if i.get("direction") == "sent"]

    stmt = pnl.compute(period, invoices, entries, settings)
    t = stmt["totals"]
    revenue = t["net_sales"]
    expenses = round(t["total_cogs"] + t["total_operating_expenses"], 2)
    profit = t["profit"]

    # Expense breakdown + top categories
    cat = _expense_by_account(received)
    top_categories = [
        {"key": k, "label": pnl.ACCOUNTS.get(k, {}).get("label", k), "amount": round(v, 2)}
        for k, v in sorted(cat.items(), key=lambda kv: kv[1], reverse=True)[:5]
    ]

    # Single biggest expense (by gross total) and biggest supplier (by total spend)
    biggest = max(received, key=lambda i: i.get("total") or 0, default=None)
    biggest_expense = (
        {"vendor": biggest.get("vendor"), "amount": biggest.get("total")}
        if biggest else None
    )
    vendor_spend: dict[str, float] = {}
    for i in received:
        v = (i.get("vendor") or "Unknown").strip() or "Unknown"
        vendor_spend[v] = vendor_spend.get(v, 0.0) + (i.get("total") or 0)
    top_vendor = None
    if vendor_spend:
        name, amt = max(vendor_spend.items(), key=lambda kv: kv[1])
        top_vendor = {"vendor": name, "amount": round(amt, 2)}

    totals_list = [i.get("total") or 0 for i in in_period]
    avg_invoice = round(sum(totals_list) / len(totals_list), 2) if totals_list else 0.0
    needs_review = sum(1 for i in in_period if i.get("needs_review"))
    missing_info = sum(1 for i in in_period if not (i.get("invoice_number") or "").strip())
    period_ids = {i["id"] for i in in_period}
    dup_count = sum(1 for iid in dup_map if int(iid) in period_ids)

    # GST payable = output tax collected on sales − input tax paid on purchases.
    # Sales GST comes from tax.resolve_sale so a no-GST-line sale is assumed
    # inclusive @ standard rate (flagged) instead of silently booking ₹0.
    resolved = [tax.resolve_sale(i, settings) for i in sent]
    output_tax = round(sum(r["gst"] for r in resolved), 2)
    gst_flagged = sum(1 for r in resolved if r["flag"])
    gst_assumed = round(sum(r["gst"] for r in resolved if r["flag"]), 2)
    input_tax = round(sum(i.get("tax") or 0 for i in received), 2)
    gst_payable = round(output_tax - input_tax, 2)

    # Trends vs the previous period
    prev = previous_period(period)
    prev_label, prev_months = pnl.expand_period(prev)
    pt = pnl.compute(prev, invoices, entries, settings)["totals"]
    prev_expenses = round(pt["total_cogs"] + pt["total_operating_expenses"], 2)
    revenue_change = _pct_change(revenue, pt["net_sales"])
    expenses_change = _pct_change(expenses, prev_expenses)

    prev_received = [
        i for i in invoices
        if pnl._period_of(i.get("invoice_date")) in set(prev_months)
        and i.get("direction") != "sent"
    ]
    prev_cat = _expense_by_account(prev_received)
    movers = []
    for k, v in cat.items():
        pc = _pct_change(v, prev_cat.get(k, 0.0))
        if pc is not None and abs(pc) >= 10:
            movers.append(
                {"key": k, "label": pnl.ACCOUNTS.get(k, {}).get("label", k), "pct": pc}
            )
    movers.sort(key=lambda m: abs(m["pct"]), reverse=True)

    return {
        "period": period,
        "label": label,
        "prev_label": prev_label,
        "currency": _dominant_currency(in_period),
        "count": len(in_period),
        "received": len(received),
        "sent": len(sent),
        "revenue": revenue,
        "expenses": expenses,
        "profit": profit,
        "revenue_change": revenue_change,
        "expenses_change": expenses_change,
        "avg_invoice": avg_invoice,
        "needs_review": needs_review,
        "missing_info": missing_info,
        "duplicates": dup_count,
        "gst_payable": gst_payable,
        "output_tax": output_tax,
        "input_tax": input_tax,
        "gst_flagged": gst_flagged,
        "gst_assumed": gst_assumed,
        "biggest_expense": biggest_expense,
        "top_vendor": top_vendor,
        "top_categories": top_categories,
        "category_changes": movers[:4],
    }
