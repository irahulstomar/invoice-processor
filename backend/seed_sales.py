"""Dev helper: seed sample *sales* (sent) invoices straight into the DB.

These are invoices the company issued -> revenue in the P&L. Seeded directly
(no Gemini calls) with full confidence. Idempotent: skips invoice numbers that
already exist. Run: python seed_sales.py
"""
from app import db
from app.schemas import Extraction, FieldConfidence, LineItem

# (filename, number, date, customer, [(desc, qty, unit), ...]); GST 18%, INR.
SALES = [
    ("sale_nov_apex.pdf", "INV-2025-018", "2025-11-08", "Apex Retail Pvt. Ltd.",
     [("AI automation retainer - November", 1, 75000.0),
      ("Invoice extraction setup (one-time)", 1, 10000.0)]),
    ("sale_jan_brightway.pdf", "INV-2026-002", "2026-01-15", "Brightway Logistics",
     [("Custom analytics dashboard - build", 1, 95000.0),
      ("Data pipeline integration", 1, 25000.0)]),
    ("sale_feb_corehealth.pdf", "INV-2026-006", "2026-02-10", "CoreHealth Clinics",
     [("AI automation retainer - February", 1, 75000.0),
      ("Onboarding & training", 2, 9000.0)]),
    ("sale_mar_delta.pdf", "INV-2026-011", "2026-03-22", "Delta Foods Co.",
     [("Chatbot deployment", 1, 55000.0)]),
    ("sale_may_evergreen.pdf", "INV-2026-019", "2026-05-19", "Evergreen Estates",
     [("AI automation retainer - May", 1, 75000.0),
      ("Document processing add-on", 1, 18000.0)]),
]
TAX_RATE = 0.18


def build(number, date, customer, rows) -> Extraction:
    items = [
        LineItem(description=d, quantity=q, unit_price=u, amount=round(q * u, 2))
        for d, q, u in rows
    ]
    subtotal = round(sum(i.amount for i in items), 2)
    tax = round(subtotal * TAX_RATE, 2)
    total = round(subtotal + tax, 2)
    return Extraction(
        vendor=customer,  # counterparty (the client paying us)
        invoice_date=date,
        invoice_number=number,
        currency="INR",
        line_items=items,
        subtotal=subtotal,
        tax=tax,
        total=total,
        category="Professional Services",  # ignored for sent (-> Sales), required field
        alternatives=[],
        confidence=FieldConfidence(
            vendor=1.0, invoice_date=1.0, invoice_number=1.0,
            subtotal=1.0, tax=1.0, total=1.0, category=1.0,
        ),
    )


def main() -> None:
    db.init_db()
    existing = {i.get("invoice_number") for i in db.list_invoices()}
    added = 0
    for filename, number, date, customer, rows in SALES:
        if number in existing:
            print(f"skip {number} (already present)")
            continue
        ext = build(number, date, customer, rows)
        db.insert_extraction(filename, ext, direction="sent")
        print(f"seeded {number}  {customer}  INR {ext.total:,.2f}")
        added += 1
    print(f"\n{added} sales invoice(s) added.")


if __name__ == "__main__":
    main()
