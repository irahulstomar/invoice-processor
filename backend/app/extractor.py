"""Gemini 2.0 Flash vision extraction: document bytes -> structured Extraction."""
from __future__ import annotations

import os

from google import genai
from google.genai import types

from .schemas import CATEGORIES, CategoryResult, Extraction

# Spec called for gemini-2.0-flash, but this account's free tier allots no quota
# for it (limit: 0). gemini-2.5-flash is newer, also has vision, and has quota.
MODEL = "gemini-2.5-flash"

SUPPORTED_MIME = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
}

_PROMPT = f"""You are an expert accounting data-entry assistant. Extract structured
data from this invoice or receipt image/PDF.

Rules:
- Extract the vendor/supplier name, invoice or receipt date, invoice/receipt number,
  currency (ISO 4217 code), all line items, subtotal, tax, and grand total.
- Dates must be ISO 8601 (YYYY-MM-DD). If a field is genuinely absent, use an empty
  string for text fields and null for numbers. Never invent values.
- Pick the single best-fit chart-of-accounts `category` from this list, based on
  the vendor and what was actually bought:
  {", ".join(CATEGORIES)}.
- In `alternatives`, list up to 2 other plausible categories from that same list
  (never repeat the chosen one), each with its own confidence. If nothing else
  fits, return an empty list.
- For every field in `confidence`, report how sure you are from 0.0 to 1.0 based on
  how clearly that value appears in the document. Blurry, ambiguous, handwritten, or
  inferred values should score low (< 0.7). Crisp, unambiguous values score high.
"""

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key or api_key == "PASTE_YOUR_KEY_HERE":
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Add it to the project .env file."
            )
        _client = genai.Client(api_key=api_key)
    return _client


def extract(file_bytes: bytes, mime_type: str) -> Extraction:
    """Run Gemini vision extraction on one document, return a validated Extraction."""
    if mime_type not in SUPPORTED_MIME:
        raise ValueError(f"Unsupported file type: {mime_type}")

    client = _get_client()
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            _PROMPT,
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Extraction,
            temperature=0.0,
        ),
    )
    # The SDK parses response_schema into .parsed when it's a Pydantic model.
    parsed = response.parsed
    if isinstance(parsed, Extraction):
        return parsed
    return Extraction.model_validate_json(response.text)


def categorize(vendor: str, line_items: list[dict], currency: str = "") -> CategoryResult:
    """Categorize an already-extracted invoice from its text fields (no vision call)."""
    items = "; ".join(
        str(li.get("description")) for li in line_items if li.get("description")
    ) or "(no line items listed)"
    prompt = f"""Classify this business purchase into one chart-of-accounts category.

Vendor: {vendor or "(unknown)"}
Line items: {items}
Currency: {currency or "(unknown)"}

Pick the single best-fit `category` from this list, based on the vendor and what
was bought: {", ".join(CATEGORIES)}.
Set `confidence` (0.0-1.0) for that choice. In `alternatives`, give up to 2 other
plausible categories from the same list (never repeat the chosen one) with their
own confidence; return an empty list if nothing else fits."""

    client = _get_client()
    response = client.models.generate_content(
        model=MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=CategoryResult,
            temperature=0.0,
        ),
    )
    parsed = response.parsed
    if isinstance(parsed, CategoryResult):
        return parsed
    return CategoryResult.model_validate_json(response.text)


def finance_review(metrics: dict) -> str:
    """Write a short executive review of the books from computed metrics (1 call)."""
    import json

    cur = metrics.get("currency") or "INR"
    prompt = f"""You are a sharp finance analyst reviewing the books for a business
owner. Here is the computed data for {metrics.get('label')} (all amounts in {cur}):

{json.dumps(metrics, indent=2)}

Write a concise review:
- Start with one 2-3 sentence summary of revenue, expenses and profit for the period.
- Then 3-5 short points on what matters: notable changes vs {metrics.get('prev_label')},
  the biggest expense or supplier, any duplicate invoices or invoices missing info that
  need attention, and the GST position.
Be concrete with the actual numbers. Professional, plain, no fluff.
Output PLAIN TEXT only: the summary paragraph, then each point on its own line
starting with "- ". Do not use markdown bold, headings, or asterisks."""

    client = _get_client()
    response = client.models.generate_content(
        model=MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(temperature=0.3),
    )
    return (response.text or "").strip()


def chat(question: str, history: list[dict], data_context: str) -> str:
    """Answer a question grounded in the invoice data passed as context (1 call).

    `history` is prior turns [{role: 'user'|'assistant', content: str}]; the small
    invoice dataset is injected as text, so no retrieval/embeddings are needed.
    """
    system = f"""You are a finance assistant for a small business. Answer the user's
questions using ONLY the invoice data below. Amounts are as stored (net figures
are subtotals; totals include tax). Be concise and concrete — quote vendors,
dates and amounts from the data. If something isn't in the data, say so plainly.
Do not invent invoices or numbers. Answer in plain text; for lists put each item
on its own line starting with "• " — never use markdown asterisks, bold or headings.

=== INVOICE DATA ===
{data_context}
=== END DATA ==="""

    contents = [system]
    for turn in history[-8:]:  # keep the prompt small
        who = "User" if turn.get("role") == "user" else "Assistant"
        contents.append(f"{who}: {turn.get('content', '')}")
    contents.append(f"User: {question}\nAssistant:")

    client = _get_client()
    response = client.models.generate_content(
        model=MODEL,
        contents=["\n\n".join(contents)],
        config=types.GenerateContentConfig(temperature=0.2),
    )
    return (response.text or "").strip()
