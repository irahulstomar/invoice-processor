# Slate

An invoice and receipt processor that reads PDFs, images, and photos of paper invoices with a vision model and turns them into clean, structured, accounting-ready data with a P&L view and CSV export.

> **Demo / portfolio project.** Slate runs on sample data. The `backend/samples/` folder ships example invoices you can upload, and `seed_sales.py` seeds sample revenue. Live extraction needs a Gemini API key; the Gmail inbox poller is optional and off unless you add OAuth credentials. No real users, no client data.

## The problem

Small businesses lose hours to manual data entry, keying vendor, date, line items, tax, and totals off invoices and receipts into a spreadsheet or accounting tool. Slate does that pass automatically: drop in a batch of invoices, a vision model extracts the fields, low-confidence values are flagged for a quick human check, and the approved rows export straight to CSV. It also separates purchases (expenses) from sales (revenue) to produce a simple profit-and-loss view.

## Key features

- **Batch extraction from any format.** Drag and drop PDFs, images, or photos of paper invoices. A vision model extracts vendor, date, invoice number, line items, amounts, tax, and total.
- **Confidence flags and human review.** Each field carries a confidence score; low-confidence values are badged for review before anything is exported.
- **Auto-categorization.** Line items are mapped to a chart-of-accounts category, editable in the review table.
- **P&L view.** Purchases and sales are tracked separately with GST handled as a balance-sheet pass-through, so revenue and expenses stay net of tax. Includes month-over-month comparison.
- **CSV export.** Approved rows export in a format ready for tools like QuickBooks or Xero.
- **Email ingestion (optional).** A Gmail poller pulls invoice attachments from an inbox into the same review queue.
- **Chat panel.** Ask questions about the processed data.

## Tech stack

**Backend** (`backend/requirements.txt`)
- Python + FastAPI, uvicorn
- Google Gemini (`google-genai`) for vision extraction
- Google API client + OAuth libraries for the optional Gmail poller
- SQLite for storage
- python-dotenv, python-multipart

**Frontend** (`frontend/package.json`)
- Next.js + React
- Tailwind CSS + shadcn/ui
- TypeScript

## How it works

```
Input                     Processing                        Output
-----                     ----------                        ------
PDF / image / photo  ─►   vision extract (Gemini):     ─►   review table
(upload or Gmail          vendor, date, #, line items,       (confidence badges,
 attachment)              tax, total                          editable category)
                                │                                   │
                          auto-categorize                     approve rows
                          + confidence score                       │
                                │                             ┌─────┴─────┐
                          split sales vs purchases       CSV export    P&L view
```

## Run it locally

Requirements: Python 3.11+, Node 18+.

**1. Backend**

```bash
cd backend
python -m venv venv
# Windows:  venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env     # then add your Gemini key (see below)
python seed_sales.py           # optional: seed sample sales revenue
uvicorn app.main:app --reload
```

Environment variables (`.env` in the repo root, see `.env.example`):

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API key for vision extraction |

**Optional Gmail ingestion.** To enable the inbox poller, download an OAuth Desktop client from Google Cloud, save it as `backend/credentials.json`, then run `python gmail_auth.py` once to authorize (it writes `backend/token.json`). Both files are gitignored.

**2. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The backend must be running for extraction and export to work.

**Try it:** upload the example invoices in `backend/samples/` (purchases) and `backend/samples/sales/` (sales) to see extraction, the review table, and the P&L populate.

## Notes

- Tax handling targets Indian GST (INR). See `Taxation system/tax-handling-research.md` for the accounting rationale. Rates change with each budget, so re-verify before relying on any hard-coded rate.

## Screenshots / Demo

<!-- Add a demo GIF or screenshots here. -->
_Demo GIF coming soon._
