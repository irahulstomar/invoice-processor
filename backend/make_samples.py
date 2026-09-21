"""Dev helper: generate a few varied fake invoice PDFs into samples/.

Not part of the app. Run: python make_samples.py
"""
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

SAMPLES = Path(__file__).resolve().parent / "samples"
SAMPLES.mkdir(exist_ok=True)


def invoice(filename, vendor, number, date, rows, tax_rate, currency="USD", note=""):
    c = canvas.Canvas(str(SAMPLES / filename), pagesize=letter)
    w, h = letter
    y = h - inch

    c.setFont("Helvetica-Bold", 20)
    c.drawString(inch, y, vendor)
    c.setFont("Helvetica", 10)
    c.drawRightString(w - inch, y, "INVOICE")
    y -= 14
    c.drawRightString(w - inch, y, f"Invoice #: {number}")
    y -= 14
    c.drawRightString(w - inch, y, f"Date: {date}")
    y -= 40

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
    c.drawString(4.5 * inch, y, f"Tax ({tax_rate * 100:.0f}%)")
    c.drawRightString(w - inch, y, f"{currency} {tax:,.2f}")
    y -= 16
    c.setFont("Helvetica-Bold", 11)
    c.drawString(4.5 * inch, y, "Total")
    c.drawRightString(w - inch, y, f"{currency} {total:,.2f}")

    if note:
        c.setFont("Helvetica-Oblique", 9)
        c.drawString(inch, inch, note)

    c.save()
    print(f"wrote {filename}  total={currency} {total:,.2f}")


invoice(
    "acme_software.pdf",
    vendor="Acme Cloud Inc.",
    number="ACM-2026-0412",
    date="2026-04-12",
    rows=[
        ("Pro plan subscription (monthly)", 1, 49.00),
        ("Additional seats", 3, 12.00),
        ("Priority support add-on", 1, 25.00),
    ],
    tax_rate=0.0,
    note="Thank you for your business. Auto-renews monthly.",
)

invoice(
    "northwind_supplies.pdf",
    vendor="Northwind Office Supplies Ltd.",
    number="NW-88217",
    date="2026-05-03",
    rows=[
        ("Printer paper, A4 (case of 5)", 4, 22.50),
        ("Ballpoint pens, box of 50", 2, 8.75),
        ("Stapler, heavy-duty", 1, 14.99),
        ("Sticky notes, assorted", 6, 3.20),
    ],
    tax_rate=0.08,
    currency="USD",
    note="Net 30. Remit to accounts@northwind.example",
)
