"""Profit & Loss model: account taxonomy + statement computation.

The P&L is built from a single ledger: every invoice and every manual entry
resolves to one account in a given month. The statement is that ledger grouped
by account, with the standard subtotals computed on top.

Amounts are booked NET OF TAX (industry standard): recoverable GST/VAT is a
balance-sheet item, not a P&L line. The "Tax Expense" line is income tax,
entered manually.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from . import tax

# --- Account taxonomy -------------------------------------------------------
# Each account belongs to a section. `contra` accounts reduce their section
# total (e.g. sales returns reduce revenue), so they display as negatives.

REVENUE = [
    ("sales", "Sales", False),
    ("sales_return", "Sales Return", True),
    ("discounts_allowances", "Discounts and Allowances", True),
]
COGS = [
    ("cost_of_goods", "Cost of Goods Sold", False),
]
# These labels are the categories the AI assigns to each bill (see schemas.py),
# so an assigned category maps 1:1 onto a P&L account.
OPERATING_EXPENSES = [
    ("cloud_infrastructure", "Cloud Infrastructure", False),
    ("software_subscriptions", "Software Subscriptions", False),
    ("it_services", "IT Services", False),
    ("marketing_advertising", "Marketing & Advertising", False),
    ("professional_services", "Professional Services", False),
    ("office_supplies", "Office Supplies", False),
    ("rent_utilities", "Rent & Utilities", False),
    ("travel", "Travel", False),
    ("meals_entertainment", "Meals & Entertainment", False),
    ("bank_fees", "Bank & Payment Fees", False),
    ("salaries_wages", "Salaries & Wages", False),
    ("equipment_hardware", "Equipment & Hardware", False),
    ("shipping_postage", "Shipping & Postage", False),
    ("other_expenses", "Other Expenses", False),
]
OTHER_INCOME = [
    ("interest_income", "Interest Income", False),
    ("other_income", "Other Income", False),
]
TAX = [("tax_expense", "Tax Expense", False)]

# Flat lookup of every assignable account key -> label, plus the section it
# belongs to (used by the frontend to populate the account dropdowns).
_GROUPS = {
    "revenue": REVENUE,
    "cogs": COGS,
    "operating_expenses": OPERATING_EXPENSES,
    "other_income": OTHER_INCOME,
    "tax": TAX,
}
ACCOUNTS: dict[str, dict[str, Any]] = {
    key: {"label": label, "section": section, "contra": contra}
    for section, items in _GROUPS.items()
    for (key, label, contra) in items
}


def accounts_catalog() -> list[dict[str, Any]]:
    """Ordered account list for building UI dropdowns."""
    return [
        {"key": k, "label": v["label"], "section": v["section"], "contra": v["contra"]}
        for k, v in ACCOUNTS.items()
    ]


def _norm(s: str) -> str:
    """Lowercase, map '&'->'and', and strip everything but a-z0-9."""
    return re.sub(r"[^a-z0-9]", "", s.strip().lower().replace("&", "and"))


def resolve_account(text: str) -> Optional[str]:
    """Match a sheet cell to an account key, accepting either the key or label."""
    norm = _norm(text)
    for key, v in ACCOUNTS.items():
        if norm == _norm(key) or norm == _norm(v["label"]):
            return key
    return None


def category_to_account(category: Optional[str]) -> str:
    """Map an AI-assigned category to its P&L account key, defaulting to Other Expenses."""
    return resolve_account(category or "") or "other_expenses"


# --- Amounts ----------------------------------------------------------------


def invoice_pl_amount(inv: dict[str, Any]) -> float:
    """Net (ex-tax) amount an invoice contributes to the P&L."""
    subtotal = inv.get("subtotal")
    if subtotal is not None:
        return float(subtotal)
    total, tax = inv.get("total"), inv.get("tax")
    if total is not None and tax is not None:
        return float(total) - float(tax)
    return float(total) if total is not None else 0.0


def _period_of(date_str: Optional[str]) -> Optional[str]:
    """YYYY-MM from an ISO date, or None if unparseable."""
    if not date_str or len(date_str) < 7:
        return None
    return date_str[:7]


_MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def expand_period(spec: str) -> tuple[str, list[str]]:
    """Expand a period spec into (display label, [YYYY-MM, ...]).

    Accepts a month ('2026-01'), quarter ('2026-Q1'), or year ('2026').
    """
    spec = spec.strip()
    q = re.match(r"^(\d{4})-Q([1-4])$", spec, re.IGNORECASE)
    if q:
        year, quarter = q.group(1), int(q.group(2))
        start = (quarter - 1) * 3 + 1
        months = [f"{year}-{m:02d}" for m in range(start, start + 3)]
        return f"Q{quarter} {year}", months
    if re.match(r"^\d{4}-\d{2}$", spec):
        y, m = spec.split("-")
        return f"{_MONTH_NAMES[int(m)]} {y}", [spec]
    if re.match(r"^\d{4}$", spec):
        return spec, [f"{spec}-{m:02d}" for m in range(1, 13)]
    return spec, [spec]  # fallback: treat as a literal month


# --- Statement --------------------------------------------------------------


def _row(label: str, amount: Optional[float], *, level: int = 1,
         total: bool = False, grand: bool = False, key: Optional[str] = None,
         contra: bool = False, redundant: bool = False,
         estimated: bool = False) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "amount": None if amount is None else round(amount, 2),
        "level": level,
        "total": total,
        "grand": grand,
        "contra": contra,
        # A subtotal that equals the next one because nothing sat between them
        # (e.g. no COGS, no tax). The single-period statement hides these; the
        # Compare view keeps every row so periods stay aligned by index.
        "redundant": redundant,
        # Computed estimate (the tax provision), not a booked figure.
        "estimated": estimated,
    }


def compute(period: str, invoices: list[dict[str, Any]],
            entries: list[dict[str, Any]],
            settings: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """Compute the full P&L statement for a period (month, quarter, or year).

    `settings` is the business profile (GST registration, entity type); it
    drives GST resolution on sales and the estimated tax provision.
    """
    period_label, months = expand_period(period)
    monthset = set(months)
    totals: dict[str, float] = {k: 0.0 for k in ACCOUNTS}

    for inv in invoices:
        if _period_of(inv.get("invoice_date")) not in monthset:
            continue
        acct = inv.get("pl_account") or (
            "sales" if inv.get("direction") == "sent" else "other_expenses"
        )
        if acct in totals:
            if inv.get("direction") == "sent":
                # Revenue net of GST, even when the invoice hid the tax in an
                # inclusive price (tax.resolve_sale backs it out).
                totals[acct] += tax.resolve_sale(inv, settings)["base"]
            else:
                totals[acct] += invoice_pl_amount(inv)

    for e in entries:
        if e.get("period") in monthset and e.get("pl_account") in totals:
            totals[e["pl_account"]] += float(e["amount"])

    def amt(key: str) -> float:
        return totals.get(key, 0.0)

    # Section subtotals
    net_sales = amt("sales") - amt("sales_return") - amt("discounts_allowances")
    total_cogs = sum(amt(k) for k, _, _ in COGS)
    gross_profit = net_sales - total_cogs
    total_opex = sum(amt(k) for k, _, _ in OPERATING_EXPENSES)
    operating_profit = gross_profit - total_opex
    other_income_total = amt("interest_income") + amt("other_income")
    pbt = operating_profit + other_income_total

    # Income tax: a booked (manual) Tax Expense wins; otherwise estimate a
    # "Provision for Tax" from the entity type. Approving the estimate in the
    # UI simply books it as a manual entry, which then takes over here.
    manual_tax = amt("tax_expense")
    tax_detail: Optional[dict[str, Any]] = None
    if round(manual_tax, 2) == 0:
        est = tax.income_tax_provision(
            pbt, (settings or tax.DEFAULT_SETTINGS).get("entity_type", "")
        )
        tax_expense = est["amount"]
        tax_detail = {
            "estimated": True,
            "rate_label": est["rate_label"],
            "entity_label": est["entity_label"],
            "pbt": round(pbt, 2),
            "rates_as_of": tax.RATES_AS_OF,
        }
    else:
        tax_expense = manual_tax
    profit = pbt - tax_expense

    # A tier is redundant when nothing between it and the next subtotal moved the
    # number: no COGS makes Gross Profit == Net Sales; no other income + no tax
    # makes Operating Profit == Net Profit; no tax makes Before-Tax == Net Profit.
    def is_zero(x: float) -> bool:
        return round(x, 2) == 0

    cogs_empty = is_zero(total_cogs)
    no_tax = is_zero(tax_expense)
    no_other_income = is_zero(other_income_total)

    rows: list[dict[str, Any]] = []
    rows.append(_row("Revenue", None, level=0))
    for k, label, contra in REVENUE:
        rows.append(_row(label, -amt(k) if contra else amt(k), key=k, contra=contra))
    rows.append(_row("Net Sales", net_sales, total=True))

    rows.append(_row("Cost of Goods Sold", None, level=0))
    for k, label, _ in COGS:
        rows.append(_row(label, amt(k), key=k))
    rows.append(_row("Total Cost of Goods Sold", total_cogs, total=True))

    rows.append(_row("Gross Profit", gross_profit, total=True, grand=True,
                     redundant=cogs_empty))

    rows.append(_row("Operating Expenses", None, level=0))
    for k, label, _ in OPERATING_EXPENSES:
        rows.append(_row(label, amt(k), key=k))
    rows.append(_row("Total Operating Expenses", total_opex, total=True))

    rows.append(_row("Operating Profit (Loss)", operating_profit, total=True, grand=True,
                     redundant=no_other_income and no_tax))

    rows.append(_row("Other Income", None, level=0))
    for k, label, _ in OTHER_INCOME:
        rows.append(_row(label, amt(k), key=k))

    rows.append(_row("Profit (Loss) Before Taxes", pbt, total=True, grand=True,
                     redundant=no_tax))
    rows.append(_row(
        "Provision for Tax (estimated)" if tax_detail else "Tax Expense",
        tax_expense, key="tax_expense", estimated=bool(tax_detail),
    ))
    rows.append(_row("Net Profit (Loss)", profit, total=True, grand=True))

    return {
        "period": period,
        "label": period_label,
        "rows": rows,
        "tax_detail": tax_detail,
        "totals": {
            "net_sales": round(net_sales, 2),
            "total_cogs": round(total_cogs, 2),
            "gross_profit": round(gross_profit, 2),
            "total_operating_expenses": round(total_opex, 2),
            "operating_profit": round(operating_profit, 2),
            "other_income": round(other_income_total, 2),
            "profit_before_taxes": round(pbt, 2),
            "tax_expense": round(tax_expense, 2),
            "profit": round(profit, 2),
        },
    }
