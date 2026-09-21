"""Duplicate / double-billing detection over the invoice list (no LLM).

Each invoice is compared against the ones entered before it. Two signals:
  - exact:     same vendor + same invoice number  -> the same document re-entered
  - potential: same vendor + same amount + same date, but a different/blank
               invoice number -> possible double-billing (tight enough to not
               flag legitimate same-amount monthly retainers on different dates)
"""
from __future__ import annotations

import re
from typing import Any, Optional


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def find_duplicates(invoices: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Map invoice id -> duplicate info for invoices that repeat an earlier one."""
    # Earliest first (insertion order), so a later entry is the duplicate of the
    # earlier original rather than the other way round.
    ordered = sorted(invoices, key=lambda i: i.get("created_at") or "")
    flags: dict[int, dict[str, Any]] = {}
    seen: list[dict[str, Any]] = []

    for inv in ordered:
        vend = _norm(inv.get("vendor"))
        num = _norm(inv.get("invoice_number"))
        total = inv.get("total")
        date = inv.get("invoice_date") or ""
        match: Optional[dict[str, Any]] = None
        kind: Optional[str] = None

        for prev in seen:
            if not vend or _norm(prev.get("vendor")) != vend:
                continue
            pnum = _norm(prev.get("invoice_number"))
            if num and pnum and num == pnum:
                match, kind = prev, "exact"
                break  # exact beats potential
            if (
                total is not None
                and prev.get("total") == total
                and date
                and prev.get("invoice_date") == date
            ):
                match, kind = prev, "potential"  # keep scanning for an exact match

        if match:
            if kind == "exact":
                when = f" (dated {match['invoice_date']})" if match.get("invoice_date") else ""
                reason = (
                    f"Invoice {inv.get('invoice_number') or '(no number)'} was already "
                    f"processed{when}."
                )
            else:
                reason = (
                    f"Same vendor, amount, and date as invoice "
                    f"{match.get('invoice_number') or '(no number)'}."
                )
            flags[inv["id"]] = {
                "type": kind,
                "of_id": match["id"],
                "of_date": match.get("invoice_date") or "",
                "vendor": inv.get("vendor"),
                "invoice_number": inv.get("invoice_number"),
                "amount": total,
                "currency": inv.get("currency"),
                "reason": reason,
            }
        seen.append(inv)

    return flags
