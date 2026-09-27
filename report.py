"""Aggregation and output (table, CSV, chart) for the reaction leaderboard."""

from __future__ import annotations

import csv
import json
from collections import Counter
from dataclasses import dataclass

import contacts
from reactions import ME, TAPBACK_TYPES, Reaction

MAX_BREAKDOWN_COLUMNS = 6


def load_name_map(path: str | None) -> dict[str, str]:
    if not path:
        return {}
    with open(path) as f:
        return json.load(f)


def display_name(
    handle_id: str,
    name_map: dict[str, str],
    contact_names: dict[str, str] | None = None,
) -> str:
    if handle_id == ME:
        return name_map.get(ME, "Me")
    if handle_id in name_map:
        return name_map[handle_id]
    if contact_names:
        match = contacts.lookup(handle_id, contact_names)
        if match:
            return match
    return handle_id


@dataclass
class LeaderboardRow:
    handle: str
    name: str
    total_reactions: int
    breakdown: Counter
    messages_sent: int
    reactions_per_message: float


def top_breakdown_columns(reactions: list[Reaction]) -> list[str]:
    """The chat's 6 most common reaction identities - the 6 canonical tapback
    names (even if unseen, at count 0) pooled with every distinct custom
    emoji seen in this chat, ranked by chat-wide count. A chat with no custom
    emoji tapbacks gets the same 6 canonical types as always; a chat where
    custom emoji dominate has them displace the least-used canonical types.
    """
    totals: Counter = Counter({name: 0 for name in TAPBACK_TYPES.values()})
    for r in reactions:
        if r.tapback_type is not None:
            totals[r.tapback_type] += 1
    return [identity for identity, _ in totals.most_common(MAX_BREAKDOWN_COLUMNS)]


def aggregate(
    reactions: list[Reaction],
    message_counts: Counter,
    name_map: dict[str, str],
    contact_names: dict[str, str] | None = None,
) -> tuple[list[LeaderboardRow], list[str]]:
    totals: Counter = Counter()
    breakdowns: dict[str, Counter] = {}

    for r in reactions:
        totals[r.target_author] += 1
        if r.tapback_type is not None:
            breakdowns.setdefault(r.target_author, Counter())[r.tapback_type] += 1

    participants = set(totals) | set(message_counts)

    rows = []
    for handle in participants:
        sent = message_counts.get(handle, 0)
        total = totals.get(handle, 0)
        rows.append(
            LeaderboardRow(
                handle=handle,
                name=display_name(handle, name_map, contact_names),
                total_reactions=total,
                breakdown=breakdowns.get(handle, Counter()),
                messages_sent=sent,
                reactions_per_message=(total / sent) if sent else 0.0,
            )
        )

    rows.sort(key=lambda r: r.total_reactions, reverse=True)
    return rows, top_breakdown_columns(reactions)


def print_table(rows: list[LeaderboardRow], columns: list[str]) -> None:
    from rich.console import Console
    from rich.table import Table

    table = Table(title="Reaction Leaderboard")
    table.add_column("Name")
    table.add_column("Total Reactions", justify="right")
    table.add_column("Messages Sent", justify="right")
    table.add_column("Reactions/Msg", justify="right")
    for column in columns:
        table.add_column(column.capitalize(), justify="right")

    for row in rows:
        table.add_row(
            row.name,
            str(row.total_reactions),
            str(row.messages_sent),
            f"{row.reactions_per_message:.2f}",
            *(str(row.breakdown.get(c, 0)) for c in columns),
        )

    Console().print(table)


def write_csv(rows: list[LeaderboardRow], columns: list[str], path: str) -> None:
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["name", "handle", "total_reactions", "messages_sent", "reactions_per_message"]
            + columns
        )
        for row in rows:
            writer.writerow(
                [row.name, row.handle, row.total_reactions, row.messages_sent,
                 f"{row.reactions_per_message:.4f}"]
                + [row.breakdown.get(c, 0) for c in columns]
            )


def write_chart(rows: list[LeaderboardRow], path: str) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed - skipping chart output")
        return

    ordered = list(reversed(rows))  # largest bar at top
    names = [r.name for r in ordered]
    totals = [r.total_reactions for r in ordered]

    fig, ax = plt.subplots(figsize=(8, max(3, len(names) * 0.4)))
    ax.barh(names, totals)
    ax.set_xlabel("Reactions received")
    ax.set_title("Reaction Leaderboard")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
