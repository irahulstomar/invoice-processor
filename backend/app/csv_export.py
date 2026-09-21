"""Render approved invoices as a QuickBooks/Xero-friendly CSV."""
from __future__ import annotations

import csv
import io
from typing import Any

# One row per invoice. Columns map to common QuickBooks/Xero bill-import fields.
COLUMNS = [
    "Date",
    "Type",
    "Vendor",
    "Invoice Number",
    "Category",
    "Currency",
    "Subtotal",
    "Tax",
    "Total",
    "GST Treatment",
]


def to_csv(invoices: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(COLUMNS)
    for inv in invoices:
        writer.writerow(
            [
                inv.get("invoice_date") or "",
                "Sale" if inv.get("direction") == "sent" else "Bill",
                inv.get("vendor") or "",
                inv.get("invoice_number") or "",
                inv.get("category") or "",
                inv.get("currency") or "",
                inv.get("subtotal") if inv.get("subtotal") is not None else "",
                inv.get("tax") if inv.get("tax") is not None else "",
                inv.get("total") if inv.get("total") is not None else "",
                inv.get("gst_treatment") or "",
            ]
        )
    return buf.getvalue()
