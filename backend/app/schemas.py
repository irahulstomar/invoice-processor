"""Pydantic models for extraction output and API responses."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

# Chart-of-accounts categories the model must pick from. These are exactly the
# expense-side account *labels* in pnl.py, so a category maps 1:1 to a P&L
# account (via pnl.resolve_account) and flows straight into the statement.
CATEGORIES = [
    "Cost of Goods Sold",
    "Cloud Infrastructure",
    "Software Subscriptions",
    "IT Services",
    "Marketing & Advertising",
    "Professional Services",
    "Office Supplies",
    "Rent & Utilities",
    "Travel",
    "Meals & Entertainment",
    "Bank & Payment Fees",
    "Salaries & Wages",
    "Equipment & Hardware",
    "Shipping & Postage",
    "Other Expenses",
]

Category = Literal[
    "Cost of Goods Sold",
    "Cloud Infrastructure",
    "Software Subscriptions",
    "IT Services",
    "Marketing & Advertising",
    "Professional Services",
    "Office Supplies",
    "Rent & Utilities",
    "Travel",
    "Meals & Entertainment",
    "Bank & Payment Fees",
    "Salaries & Wages",
    "Equipment & Hardware",
    "Shipping & Postage",
    "Other Expenses",
]


class LineItem(BaseModel):
    description: str
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    amount: Optional[float] = None


class CategoryGuess(BaseModel):
    """An alternative account the document could plausibly belong to."""
    category: Category
    confidence: float


class CategoryResult(BaseModel):
    """Result of (re-)categorizing an already-extracted invoice from text alone."""
    category: Category
    confidence: float
    alternatives: list[CategoryGuess] = []


class FieldConfidence(BaseModel):
    """Model's self-reported confidence per field, 0.0–1.0."""
    vendor: float
    invoice_date: float
    invoice_number: float
    subtotal: float
    tax: float
    total: float
    category: float


class Extraction(BaseModel):
    """The structured result Gemini returns for one document."""
    vendor: str
    invoice_date: str  # ISO 8601 (YYYY-MM-DD); empty string if not found
    invoice_number: str
    currency: str  # ISO 4217 code, e.g. USD
    line_items: list[LineItem]
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    total: float
    category: Category
    alternatives: list[CategoryGuess] = []
    confidence: FieldConfidence
