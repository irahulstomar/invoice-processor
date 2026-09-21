"""Gmail ingestion: pull invoice attachments from unread emails into the queue.

Auth is done once via gmail_auth.py (writes token.json). This module loads that
token, finds unread emails with supported attachments, runs each through the same
extraction engine, stores them with source='email', and marks the email read so
it isn't processed again.
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from . import db
from .extractor import SUPPORTED_MIME, extract

# gmail.modify lets us remove the UNREAD label after processing.
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]

_BACKEND = Path(__file__).resolve().parent.parent
CREDENTIALS_PATH = _BACKEND / "credentials.json"
TOKEN_PATH = _BACKEND / "token.json"

# Only pull emails that have an attachment and are unread.
QUERY = "is:unread has:attachment"


def is_configured() -> bool:
    return CREDENTIALS_PATH.exists()


def is_authed() -> bool:
    return TOKEN_PATH.exists()


def _service():
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds.valid and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _iter_attachments(part: dict) -> list[dict]:
    """Flatten a message payload into attachment parts (filename + body.attachmentId)."""
    found: list[dict] = []
    if part.get("filename") and part.get("body", {}).get("attachmentId"):
        found.append(part)
    for sub in part.get("parts", []) or []:
        found.extend(_iter_attachments(sub))
    return found


def poll_inbox() -> dict[str, Any]:
    """Process new emails. Returns created invoices + per-attachment errors."""
    if not is_authed():
        raise RuntimeError(
            "Gmail not authorized. Place credentials.json in backend/ and run "
            "`python gmail_auth.py` once."
        )

    service = _service()
    created: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    listing = (
        service.users()
        .messages()
        .list(userId="me", q=QUERY, maxResults=25)
        .execute()
    )
    for ref in listing.get("messages", []):
        msg_id = ref["id"]
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=msg_id, format="full")
            .execute()
        )
        attachments = _iter_attachments(msg.get("payload", {}))
        processed_any = False
        for att in attachments:
            mime = att.get("mimeType", "")
            filename = att.get("filename", "attachment")
            if mime not in SUPPORTED_MIME:
                continue
            try:
                body = (
                    service.users()
                    .messages()
                    .attachments()
                    .get(userId="me", messageId=msg_id, id=att["body"]["attachmentId"])
                    .execute()
                )
                data = base64.urlsafe_b64decode(body["data"])
                extraction = extract(data, mime)
                invoice_id = db.insert_extraction(filename, extraction, source="email")
                created.append(db.get_invoice(invoice_id))
                processed_any = True
            except Exception as e:
                errors.append({"filename": filename, "error": str(e)})

        # Mark read so we don't reprocess, even if it had no usable attachments.
        if processed_any or attachments:
            service.users().messages().modify(
                userId="me", id=msg_id, body={"removeLabelIds": ["UNREAD"]}
            ).execute()

    return {"invoices": created, "errors": errors}
