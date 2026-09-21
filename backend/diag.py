"""Diagnostic: is the key valid? which models have quota?"""
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import os  # noqa: E402

from google import genai  # noqa: E402

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

print("== list_models (auth check) ==")
try:
    names = [m.name for m in client.models.list()]
    print(f"OK, {len(names)} models visible. Sample:", names[:5])
except Exception as e:
    print("list_models FAILED:", type(e).__name__, str(e)[:300])

for model in ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-flash-latest"]:
    print(f"\n== generate_content: {model} ==")
    try:
        r = client.models.generate_content(model=model, contents="Reply with the word OK.")
        print("SUCCESS:", (r.text or "").strip()[:40])
    except Exception as e:
        msg = str(e)
        short = "limit: 0" if "limit: 0" in msg else msg[:160]
        print(f"{type(e).__name__}: {short}")
