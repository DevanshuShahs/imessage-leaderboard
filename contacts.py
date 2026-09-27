"""Best-effort automatic name resolution from the macOS Contacts app.

Reads the local Contacts (AddressBook) SQLite database(s) directly in
read-only mode - same pattern as db.py uses for chat.db - so this can never
write to or corrupt anything. Requires the same Full Disk Access grant
already needed to read chat.db, since Contacts is another TCC-protected
location.

This is inherently best-effort: phone number matching is done on the last 10
digits (works for US/Canada numbers; may under- or over-match for other
country formats), and if Contacts can't be read at all (no FDA, iCloud-only
contacts not synced locally, schema drift across macOS versions) this quietly
returns an empty mapping rather than raising - callers fall back to raw
handles, and the manual --names config always wins over anything here.
"""

from __future__ import annotations

import glob
import os
import re
import sqlite3


def _addressbook_paths() -> list[str]:
    home = os.path.expanduser("~")
    base = os.path.join(home, "Library/Application Support/AddressBook")
    candidates = [os.path.join(base, "AddressBook-v22.abcddb")]
    candidates += glob.glob(os.path.join(base, "Sources/*/AddressBook-v22.abcddb"))
    return [p for p in candidates if os.path.exists(p)]


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    return digits[-10:] if len(digits) >= 10 else digits


def _full_name(row: sqlite3.Row) -> str | None:
    first = (row["ZFIRSTNAME"] or "").strip()
    last = (row["ZLASTNAME"] or "").strip()
    name = f"{first} {last}".strip()
    if name:
        return name
    nickname = (row["ZNICKNAME"] or "").strip()
    if nickname:
        return nickname
    org = (row["ZORGANIZATION"] or "").strip()
    return org or None


def load_contact_names() -> dict[str, str]:
    """Returns a dict mapping normalized phone (last 10 digits) or lowercased
    email -> contact display name, merged across every local Contacts source.
    """
    result: dict[str, str] = {}

    for path in _addressbook_paths():
        try:
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row

            records = {
                row["Z_PK"]: _full_name(row)
                for row in conn.execute(
                    "SELECT Z_PK, ZFIRSTNAME, ZLASTNAME, ZNICKNAME, ZORGANIZATION "
                    "FROM ZABCDRECORD"
                )
            }

            for row in conn.execute("SELECT ZOWNER, ZFULLNUMBER FROM ZABCDPHONENUMBER"):
                name = records.get(row["ZOWNER"])
                if name and row["ZFULLNUMBER"]:
                    result[normalize_phone(row["ZFULLNUMBER"])] = name

            for row in conn.execute("SELECT ZOWNER, ZADDRESS FROM ZABCDEMAILADDRESS"):
                name = records.get(row["ZOWNER"])
                if name and row["ZADDRESS"]:
                    result[row["ZADDRESS"].strip().lower()] = name

            conn.close()
        except sqlite3.Error:
            continue  # unreadable or unexpected schema for this source - skip it

    return result


def lookup(handle: str, contact_names: dict[str, str]) -> str | None:
    if "@" in handle:
        return contact_names.get(handle.strip().lower())
    return contact_names.get(normalize_phone(handle))
