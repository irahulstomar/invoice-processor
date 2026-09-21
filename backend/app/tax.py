"""India tax rules: GST resolution for sales + income-tax provision estimate.

Rates are FY 2025-26 / GST 2.0 (slabs 0/5/18/40, effective 22 Sep 2025).
Rates change every Union Budget and GST Council meeting - update RATES_AS_OF
and the tables below together.

This module is pure (no db/pnl imports): callers pass a settings dict
{"gst_registration", "gstin", "entity_type"} read from app_settings.
"""
from __future__ import annotations

import re
from typing import Any, Optional

RATES_AS_OF = "FY 2025-26"

# GST 2.0 slabs. Standard rate applies to most services and goods.
GST_RATES = [0.0, 5.0, 18.0, 40.0]
GST_STANDARD_RATE = 18.0

# How a sale with no GST line was resolved by the user (invoices.gst_treatment).
GST_TREATMENTS = {
    "inclusive": "GST-inclusive price",
    "exempt": "Exempt / nil-rated",
    "zero_rated": "Zero-rated (export/SEZ)",
    "no_gst": "No GST applies",
}

GST_REGISTRATIONS = {
    "regular": "Registered (regular)",
    "composition": "Registered (composition)",
    "unregistered": "Not registered",
}

# Effective income-tax rates incl. 4% cess (surcharge ignored - estimates).
# Proprietors use the new-regime slabs instead of a flat rate.
ENTITY_TYPES = {
    "proprietor": {"label": "Proprietor / Individual", "rate": None,
                   "rate_label": "new-regime slabs"},
    "firm_llp": {"label": "Partnership Firm / LLP", "rate": 0.312,
                 "rate_label": "31.2% flat"},
    "company_small": {"label": "Company (turnover ≤ ₹400 cr)", "rate": 0.26,
                      "rate_label": "26% (25% + cess)"},
    "company_115baa": {"label": "Company (Sec 115BAA)", "rate": 0.2517,
                       "rate_label": "25.17% (22% + cess)"},
}

DEFAULT_SETTINGS = {
    "gst_registration": "regular",
    "gstin": "",
    "entity_type": "company_115baa",
}

# New-regime slabs FY 2025-26: (upper bound, rate). Rebate u/s 87A makes
# income up to Rs 12L effectively tax-free.
_SLABS = [(400_000, 0.0), (800_000, 0.05), (1_200_000, 0.10),
          (1_600_000, 0.15), (2_000_000, 0.20), (2_400_000, 0.25),
          (float("inf"), 0.30)]
_REBATE_LIMIT = 1_200_000


def _individual_tax(income: float) -> float:
    """New-regime slab tax + 4% cess, with the 87A rebate. An estimate."""
    if income <= _REBATE_LIMIT:
        return 0.0
    tax, prev = 0.0, 0.0
    for cap, rate in _SLABS:
        if income <= prev:
            break
        tax += (min(income, cap) - prev) * rate
        prev = cap
    return tax * 1.04  # health & education cess


def income_tax_provision(pbt: float, entity_type: str) -> dict[str, Any]:
    """Estimated current-tax provision on profit before tax.

    Returns {"amount", "rate_label", "entity_label"}; amount is 0 on a loss.
    """
    ent = ENTITY_TYPES.get(entity_type) or ENTITY_TYPES["company_115baa"]
    base = max(pbt, 0.0)
    if ent["rate"] is None:
        amount = _individual_tax(base)
    else:
        amount = base * ent["rate"]
    return {
        "amount": round(amount, 2),
        "rate_label": ent["rate_label"],
        "entity_label": ent["label"],
    }


# --- GSTIN validation + entity inference ------------------------------------

_GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# 4th character of the embedded PAN encodes the holder's constitution.
_PAN_ENTITY = {
    "P": "proprietor",   # individual
    "F": "firm_llp",     # firm
    "C": "company_115baa",
}


def _gstin_checksum(first14: str) -> str:
    total = 0
    for i, ch in enumerate(first14):
        product = _B36.index(ch) * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    return _B36[(36 - total % 36) % 36]


def gstin_info(gstin: str) -> dict[str, Any]:
    """Validate a GSTIN (format + checksum) and infer the entity type."""
    g = (gstin or "").strip().upper()
    if not g:
        return {"valid": False, "reason": "empty", "entity_type": None}
    if not _GSTIN_RE.match(g):
        return {"valid": False, "reason": "bad format", "entity_type": None}
    if _gstin_checksum(g[:14]) != g[14]:
        return {"valid": False, "reason": "checksum mismatch", "entity_type": None}
    # PAN is chars 3-12; its 4th char (gstin[5]) is the entity code.
    return {"valid": True, "reason": "", "entity_type": _PAN_ENTITY.get(g[5])}


# --- GST resolution for sales ------------------------------------------------


def resolve_sale(inv: dict[str, Any], settings: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """Resolve the GST position of one sales invoice.

    Returns {"base": revenue net of GST, "gst": output tax, "flag": needs review,
             "treatment": how it was resolved}.

    The core rule (see Taxation system/tax-handling-research.md): GST liability
    depends on whether the supply is taxable, not on whether the invoice
    itemised tax. A registered seller's taxable sale with no GST line is
    assumed GST-INCLUSIVE at the standard rate and flagged - never silent 0.
    """
    s = settings or DEFAULT_SETTINGS
    total = float(inv.get("total") or 0.0)
    tax = float(inv.get("tax") or 0.0)

    if tax > 0:  # invoice itemised GST: trust it (exclusive pricing)
        subtotal = inv.get("subtotal")
        base = float(subtotal) if subtotal is not None else total - tax
        return {"base": base, "gst": tax, "flag": False, "treatment": "itemised"}

    # No GST line. An unregistered/composition seller charges none - correct.
    if s.get("gst_registration") != "regular":
        return {"base": total, "gst": 0.0, "flag": False, "treatment": "no_gst"}

    treatment = inv.get("gst_treatment")
    if treatment in ("exempt", "zero_rated", "no_gst"):
        return {"base": total, "gst": 0.0, "flag": False, "treatment": treatment}

    # inclusive (user-confirmed) or unresolved (assume inclusive + flag)
    base = round(total * 100 / (100 + GST_STANDARD_RATE), 2)
    return {
        "base": base,
        "gst": round(total - base, 2),
        "flag": treatment != "inclusive",
        "treatment": treatment or "assumed_inclusive",
    }
