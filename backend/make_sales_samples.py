"""Dev helper: generate sample *sales* (sent) invoices into samples/sales/.

These are invoices your company issues to clients -> revenue in the P&L.
Dated across the months that already have expense data so the P&L shows profit.

Not part of the app. Run: python make_sales_samples.py
"""
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent / "samples" / "sales"
OUT.mkdir(parents=True, exist_ok=True)

SELLER = "Meridian Studio"


def sales_invoice(filename, number, date, bill_to, rows, tax_rate=0.18, currency="INR"):
    c = canvas.Canvas(str(OUT / filename), pagesize=letter)
    w, h = letter
    y = h - inch

    c.setFont("Helvetica-Bold", 20)
    c.drawString(inch, y, SELLER)
    c.setFont("Helvetica", 10)
    c.drawRightString(w - inch, y, "TAX INVOICE")
    y -= 14
    c.drawRightString(w - inch, y, f"Invoice #: {number}")
    y -= 14
    c.drawRightString(w - inch, y, f"Date: {date}")
    y -= 28
    c.setFont("Helvetica", 10)
    c.drawString(inch, y, f"Bill To: {bill_to}")
    y -= 30

    c.setFont("Helvetica-Bold", 10)
    c.drawString(inch, y, "Description")
    c.drawString(4.2 * inch, y, "Qty")
    c.drawString(5.0 * inch, y, "Unit")
    c.drawRightString(w - inch, y, "Amount")
    y -= 6
    c.line(inch, y, w - inch, y)
    y -= 18

    subtotal = 0.0
    c.setFont("Helvetica", 10)
    for desc, qty, unit in rows:
        amount = qty * unit
        subtotal += amount
        c.drawString(inch, y, desc)
        c.drawString(4.2 * inch, y, str(qty))
        c.drawString(5.0 * inch, y, f"{unit:,.2f}")
        c.drawRightString(w - inch, y, f"{amount:,.2f}")
        y -= 18

    tax = round(subtotal * tax_rate, 2)
    total = round(subtotal + tax, 2)
    y -= 10
    c.line(4.5 * inch, y, w - inch, y)
    y -= 18
    c.drawString(4.5 * inch, y, "Subtotal")
    c.drawRightString(w - inch, y, f"{currency} {subtotal:,.2f}")
    y -= 16
    c.drawString(4.5 * inch, y, f"GST ({tax_rate * 100:.0f}%)")
    c.drawRightString(w - inch, y, f"{currency} {tax:,.2f}")
    y -= 16
    c.setFont("Helvetica-Bold", 11)
    c.drawString(4.5 * inch, y, "Total")
    c.drawRightString(w - inch, y, f"{currency} {total:,.2f}")

    c.setFont("Helvetica-Oblique", 9)
    c.drawString(inch, inch, "Payment due within 15 days. Thank you for your business.")
    c.save()
    print(f"wrote {filename}  total={currency} {total:,.2f}")


INVOICES = [
    ("sale_nov_apex.pdf", "INV-2025-018", "2025-11-08", "Apex Retail Pvt. Ltd.",
     [("AI automation retainer - November", 1, 75000.00),
      ("Invoice extraction setup (one-time)", 1, 10000.00)]),
    ("sale_jan_brightway.pdf", "INV-2026-002", "2026-01-15", "Brightway Logistics",
     [("Custom analytics dashboard - build", 1, 95000.00),
      ("Data pipeline integration", 1, 25000.00)]),
    ("sale_feb_corehealth.pdf", "INV-2026-006", "2026-02-10", "CoreHealth Clinics",
     [("AI automation retainer - February", 1, 75000.00),
      ("Onboarding & training", 2, 9000.00)]),
    ("sale_mar_delta.pdf", "INV-2026-011", "2026-03-22", "Delta Foods Co.",
     [("Chatbot deployment", 1, 55000.00)]),
    ("sale_may_evergreen.pdf", "INV-2026-019", "2026-05-19", "Evergreen Estates",
     [("AI automation retainer - May", 1, 75000.00),
      ("Document processing add-on", 1, 18000.00)]),
]

if __name__ == "__main__":
    for args in INVOICES:
        sales_invoice(*args)
    print(f"\n{len(INVOICES)} sales invoices in {OUT}")
