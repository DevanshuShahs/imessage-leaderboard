#!/usr/bin/env python3
"""CLI entry point: chat.db copy -> reaction leaderboard.

Never point --db at ~/Library/Messages/chat.db directly - always a copy.
"""

from __future__ import annotations

import argparse
import sys

import contacts
import db
import report
from reactions import build_reactions, resolve_message_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="path to the local chat.db copy")
    parser.add_argument("--list-chats", action="store_true", help="list chats and exit")
    parser.add_argument("--chat", help="chat ROWID or display_name/identifier substring")
    parser.add_argument(
        "--include-self-reactions",
        action="store_true",
        help="count reactions where the reactor is also the original author",
    )
    parser.add_argument("--names", help="path to a handle -> name JSON config (overrides Contacts)")
    parser.add_argument(
        "--no-contacts",
        action="store_true",
        help="skip automatic name lookup from the macOS Contacts app",
    )
    parser.add_argument(
        "--csv-out", default="reactions_leaderboard.csv", help="output CSV path"
    )
    parser.add_argument("--chart", help="also write a PNG bar chart to this path")
    parser.add_argument(
        "--dump-messages",
        type=int,
        metavar="N",
        help="print the first N resolved message texts for this chat and exit (debugging)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    conn = db.connect(args.db)

    if args.list_chats:
        for chat in db.list_chats(conn):
            label = chat.display_name or chat.chat_identifier
            print(f"{chat.rowid}\t{chat.participant_count} participants\t{label}")
        return 0

    if not args.chat:
        print("error: --chat is required (or use --list-chats)", file=sys.stderr)
        return 1

    try:
        chat_id = db.resolve_chat(conn, args.chat)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    messages = db.fetch_messages(conn, chat_id)

    if args.dump_messages:
        content_rows = [m for m in messages if m.associated_message_type == 0]
        for row in content_rows[: args.dump_messages]:
            text = resolve_message_text(row)
            source = "text" if row.text else "attributedBody"
            print(f"[{source}] {row.guid}: {text!r}")
        return 0

    reactions, message_counts = build_reactions(
        messages, include_self=args.include_self_reactions
    )
    name_map = report.load_name_map(args.names)
    contact_names = {} if args.no_contacts else contacts.load_contact_names()
    rows, columns = report.aggregate(reactions, message_counts, name_map, contact_names)

    report.print_table(rows, columns)
    report.write_csv(rows, columns, args.csv_out)
    print(f"\nCSV written to {args.csv_out}")

    if args.chart:
        report.write_chart(rows, args.chart)
        print(f"Chart written to {args.chart}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
