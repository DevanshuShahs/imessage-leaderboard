"""Tapback (reaction) parsing and matching logic."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from attributed_body import extract_text
from db import MessageRow

TAPBACK_TYPES = {
    2000: "loved",
    2001: "liked",
    2002: "disliked",
    2003: "laughed",
    2004: "emphasized",
    2005: "questioned",
}

ME = "me"


def reaction_identity(assoc_type: int, emoji: str | None) -> str | None:
    """Resolve a reaction row's identity: a canonical tapback name, a raw
    custom emoji (iOS's "any emoji" tapback, associated_message_type 2006+),
    or None if this type isn't a reaction addition at all.
    """
    canonical = TAPBACK_TYPES.get(assoc_type)
    if canonical is not None:
        return canonical
    if 2000 <= assoc_type < 3000:
        return emoji  # custom emoji tapback; None for the rare un-emoji'd 2007 case
    return None


_GUID_PREFIX_RE = re.compile(r"^(?:p:\d+/|bp:)")


def strip_guid_prefix(guid: str) -> str:
    return _GUID_PREFIX_RE.sub("", guid)


def sender_of(row: MessageRow) -> str:
    return ME if row.is_from_me else (row.handle_id or "unknown")


def resolve_message_text(row: MessageRow) -> str | None:
    if row.text:
        return row.text
    return extract_text(row.attributed_body)


@dataclass
class Reaction:
    reactor: str
    target_author: str
    tapback_type: str | None
    date: int | None


def build_reactions(
    messages: list[MessageRow], include_self: bool = False
) -> tuple[list[Reaction], Counter]:
    author_by_guid = {
        strip_guid_prefix(row.guid): sender_of(row)
        for row in messages
        if row.associated_message_type == 0
    }

    message_counts: Counter = Counter()
    for row in messages:
        if row.associated_message_type == 0:
            message_counts[sender_of(row)] += 1

    reactions: list[Reaction] = []
    for row in messages:
        t = row.associated_message_type
        if 3000 <= t < 4000:
            continue  # a reaction *removal* - never counted
        if not (2000 <= t < 3000):
            continue  # not a reaction at all
        if not row.associated_message_guid:
            continue

        identity = reaction_identity(t, row.associated_message_emoji)

        target_guid = strip_guid_prefix(row.associated_message_guid)
        target_author = author_by_guid.get(target_guid)
        if target_author is None:
            continue  # original message not in this fetch (shouldn't happen normally)

        reactor = sender_of(row)
        if reactor == target_author and not include_self:
            continue

        reactions.append(
            Reaction(
                reactor=reactor,
                target_author=target_author,
                tapback_type=identity,
                date=row.date,
            )
        )

    return reactions, message_counts
