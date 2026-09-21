"""Dev check: run extraction on a sample PDF and print the result."""
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.extractor import extract  # noqa: E402

path = Path(__file__).resolve().parent / "samples" / "northwind_supplies.pdf"
result = extract(path.read_bytes(), "application/pdf")
print(result.model_dump_json(indent=2))
