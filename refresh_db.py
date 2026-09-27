#!/usr/bin/env python3
"""Periodically refresh data/chat_copy.db from the live chat.db.

Uses sqlite3's backup API for a safe, consistent snapshot even while
Messages.app is actively writing to the source - no need to quit
Messages.app first. Only ever opens the source read-only; never writes to
~/Library/Messages/chat.db.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import time

SOURCE = os.path.expanduser("~/Library/Messages/chat.db")
DEST = "data/chat_copy.db"


def refresh(dest: str) -> None:
    tmp_path = dest + ".tmp"
    src = sqlite3.connect(f"file:{SOURCE}?mode=ro", uri=True)
    dst = sqlite3.connect(tmp_path)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    os.replace(tmp_path, dest)  # atomic - the web app never sees a partial file


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", default=DEST, help="path to refresh (default: data/chat_copy.db)")
    parser.add_argument("--interval", type=int, default=120, help="seconds between refreshes")
    parser.add_argument("--once", action="store_true", help="refresh once and exit")
    args = parser.parse_args()

    while True:
        start = time.monotonic()
        try:
            refresh(args.dest)
            print(f"refreshed {args.dest} ({time.monotonic() - start:.1f}s)")
        except Exception as e:
            print(f"refresh failed: {e}")
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
