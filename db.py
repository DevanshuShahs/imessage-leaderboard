"""Read-only sqlite access to a local copy of chat.db.

Every connection is opened with mode=ro so it is structurally impossible for
this tool to write to the database file it's pointed at. Never point this at
~/Library/Messages/chat.db directly - only at a copy.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta

APPLE_EPOCH = datetime(2001, 1, 1)


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def apple_ts_to_datetime(raw: int | None) -> datetime | None:
    if not raw:
        return None
    return APPLE_EPOCH + timedelta(seconds=raw / 1_000_000_000)


@dataclass
class ChatRow:
    rowid: int
    chat_identifier: str
    display_name: str | None
    participant_count: int


def list_chats(conn: sqlite3.Connection) -> list[ChatRow]:
    rows = conn.execute(
        """
        SELECT c.ROWID AS rowid,
               c.chat_identifier AS chat_identifier,
               c.display_name AS display_name,
               COUNT(chj.handle_id) AS participant_count
        FROM chat c
        LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
        GROUP BY c.ROWID
        ORDER BY participant_count DESC, c.ROWID ASC
        """
    ).fetchall()
    return [
        ChatRow(
            rowid=row["rowid"],
            chat_identifier=row["chat_identifier"],
            display_name=row["display_name"],
            participant_count=row["participant_count"],
        )
        for row in rows
    ]


def get_chat(conn: sqlite3.Connection, chat_id: int) -> ChatRow | None:
    row = conn.execute(
        """
        SELECT c.ROWID AS rowid,
               c.chat_identifier AS chat_identifier,
               c.display_name AS display_name,
               COUNT(chj.handle_id) AS participant_count
        FROM chat c
        LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
        WHERE c.ROWID = ?
        GROUP BY c.ROWID
        """,
        (chat_id,),
    ).fetchone()
    if row is None:
        return None
    return ChatRow(
        rowid=row["rowid"],
        chat_identifier=row["chat_identifier"],
        display_name=row["display_name"],
        participant_count=row["participant_count"],
    )


def resolve_chat(conn: sqlite3.Connection, selector: str) -> int:
    if selector.isdigit():
        rowid = int(selector)
        row = conn.execute(
            "SELECT ROWID FROM chat WHERE ROWID = ?", (rowid,)
        ).fetchone()
        if row is None:
            raise ValueError(f"No chat with ROWID {rowid}")
        return rowid

    matches = conn.execute(
        """
        SELECT ROWID, chat_identifier, display_name FROM chat
        WHERE display_name LIKE ? OR chat_identifier LIKE ?
        """,
        (f"%{selector}%", f"%{selector}%"),
    ).fetchall()

    if not matches:
        raise ValueError(f"No chat matched {selector!r}")
    if len(matches) > 1:
        options = ", ".join(
            f"{m['ROWID']} ({m['display_name'] or m['chat_identifier']})"
            for m in matches
        )
        raise ValueError(f"{selector!r} matched multiple chats: {options}")

    return matches[0]["ROWID"]


@dataclass
class MessageRow:
    rowid: int
    guid: str
    date: int | None
    is_from_me: bool
    handle_id: str | None
    text: str | None
    attributed_body: bytes | None
    associated_message_type: int
    associated_message_guid: str | None
    associated_message_emoji: str | None


def fetch_messages(conn: sqlite3.Connection, chat_id: int) -> list[MessageRow]:
    rows = conn.execute(
        """
        SELECT m.ROWID AS rowid,
               m.guid AS guid,
               m.date AS date,
               m.is_from_me AS is_from_me,
               h.id AS handle_id,
               m.text AS text,
               m.attributedBody AS attributed_body,
               m.associated_message_type AS associated_message_type,
               m.associated_message_guid AS associated_message_guid,
               m.associated_message_emoji AS associated_message_emoji
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE cmj.chat_id = ?
        ORDER BY m.date ASC
        """,
        (chat_id,),
    ).fetchall()
    return [
        MessageRow(
            rowid=row["rowid"],
            guid=row["guid"],
            date=row["date"],
            is_from_me=bool(row["is_from_me"]),
            handle_id=row["handle_id"],
            text=row["text"],
            attributed_body=row["attributed_body"],
            associated_message_type=row["associated_message_type"] or 0,
            associated_message_guid=row["associated_message_guid"],
            associated_message_emoji=row["associated_message_emoji"],
        )
        for row in rows
    ]
