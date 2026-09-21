"""One-time Gmail OAuth. Run once after placing credentials.json in backend/.

    python gmail_auth.py

Opens a browser for consent, then writes token.json next to credentials.json.
The poller uses that token from then on.
"""
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

from app.gmail_poller import SCOPES, CREDENTIALS_PATH, TOKEN_PATH

if __name__ == "__main__":
    if not Path(CREDENTIALS_PATH).exists():
        raise SystemExit(
            f"Missing {CREDENTIALS_PATH}. Download an OAuth *Desktop* client "
            "credentials.json from Google Cloud Console and place it there."
        )
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), SCOPES)
    creds = flow.run_local_server(port=0)
    Path(TOKEN_PATH).write_text(creds.to_json())
    print(f"Authorized. Wrote {TOKEN_PATH}.")
