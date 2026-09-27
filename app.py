#!/usr/bin/env python3
"""Local web UI for the reaction leaderboard.

Never point --db at ~/Library/Messages/chat.db directly - always a copy.
"""

from __future__ import annotations

import argparse
import secrets

from flask import Flask, Response, jsonify, render_template, request

import contacts
import db
import report
from reactions import build_reactions

app = Flask(__name__)
STATE: dict = {}


@app.before_request
def require_password():
    password = STATE.get("password")
    if not password:
        return None  # no --share-password set - open, for pure localhost use
    auth = request.authorization
    if not auth or not secrets.compare_digest(auth.password or "", password):
        return Response(
            "Password required.",
            401,
            {"WWW-Authenticate": 'Basic realm="Reaction Leaderboard"'},
        )
    return None


def serialize_row(row: report.LeaderboardRow, columns: list[str]) -> dict:
    # dataclasses.asdict() mishandles the Counter field here: Counter(iterable
    # of (k, v) pairs) counts each pair as an element rather than building a
    # mapping, so it silently turns string keys into tuples. Serialize by hand.
    # breakdown is filtered to the chat's displayed columns only - a person's
    # full Counter may hold identities outside the top 6 (they still count
    # toward total_reactions, just aren't itemized in the UI).
    return {
        "handle": row.handle,
        "name": row.name,
        "total_reactions": row.total_reactions,
        "breakdown": {c: row.breakdown.get(c, 0) for c in columns},
        "messages_sent": row.messages_sent,
        "reactions_per_message": row.reactions_per_message,
    }


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/chats")
def api_chats():
    conn = db.connect(STATE["db_path"])
    try:
        chats = db.list_chats(conn)
    finally:
        conn.close()
    return jsonify(
        [
            {
                "id": c.rowid,
                "name": c.display_name or c.chat_identifier,
                "participant_count": c.participant_count,
            }
            for c in chats
        ]
    )


@app.get("/api/leaderboard")
def api_leaderboard():
    chat_param = request.args.get("chat", "")
    if not chat_param.isdigit():
        return jsonify({"error": "chat query param must be a chat ROWID"}), 400
    chat_id = int(chat_param)

    conn = db.connect(STATE["db_path"])
    try:
        chat = db.get_chat(conn, chat_id)
        if chat is None:
            return jsonify({"error": f"no chat with id {chat_id}"}), 404

        messages = db.fetch_messages(conn, chat_id)
    finally:
        conn.close()

    reactions, message_counts = build_reactions(messages, include_self=False)
    contact_names = contacts.load_contact_names()
    rows, columns = report.aggregate(reactions, message_counts, STATE["name_map"], contact_names)

    return jsonify(
        {
            "chat": {
                "id": chat.rowid,
                "name": chat.display_name or chat.chat_identifier,
                "participant_count": chat.participant_count,
            },
            "totals": {
                "messages": sum(message_counts.values()),
                "reactions": len(reactions),
            },
            "tapback_columns": columns,
            "rows": [serialize_row(r, columns) for r in rows],
        }
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="path to the local chat.db copy")
    parser.add_argument("--port", type=int, default=5050)
    parser.add_argument("--names", help="path to a handle -> name JSON config")
    parser.add_argument(
        "--share-password",
        help="require this password (HTTP Basic Auth) on every request - "
        "set this before exposing the server via a tunnel to anyone else",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    STATE["db_path"] = args.db
    STATE["name_map"] = report.load_name_map(args.names)
    STATE["password"] = args.share_password
    if not args.share_password:
        print(
            "WARNING: no --share-password set. Fine for 127.0.0.1-only use; "
            "set one before exposing this server to anyone else via a tunnel."
        )
    app.run(host="127.0.0.1", port=args.port, debug=False)


if __name__ == "__main__":
    main()
