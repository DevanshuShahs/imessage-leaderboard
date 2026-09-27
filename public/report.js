// Port of report.py's aggregation logic.

import { ME, TAPBACK_TYPES } from "./reactions.js";
import { lookupContact } from "./vcard.js";

const MAX_BREAKDOWN_COLUMNS = 6;

export function displayName(handleId, contactNames) {
  if (handleId === ME) return "Me";
  const match = lookupContact(handleId, contactNames);
  return match || handleId;
}

// The chat's 6 most common reaction identities - the 6 canonical tapback
// names (even if unseen, at count 0) pooled with every distinct custom
// emoji seen in this chat, ranked by chat-wide count. A chat with no custom
// emoji tapbacks gets the same 6 canonical types as always; a chat where
// custom emoji dominate has them displace the least-used canonical types.
export function topBreakdownColumns(reactions) {
  const totals = new Map(Object.values(TAPBACK_TYPES).map((name) => [name, 0]));
  for (const r of reactions) {
    if (r.tapbackType != null) {
      totals.set(r.tapbackType, (totals.get(r.tapbackType) || 0) + 1);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_BREAKDOWN_COLUMNS)
    .map(([identity]) => identity);
}

export function aggregate(reactions, messageCounts, contactNames) {
  const totals = new Map();
  const breakdowns = new Map();

  for (const r of reactions) {
    totals.set(r.targetAuthor, (totals.get(r.targetAuthor) || 0) + 1);
    if (r.tapbackType != null) {
      if (!breakdowns.has(r.targetAuthor)) breakdowns.set(r.targetAuthor, new Map());
      const b = breakdowns.get(r.targetAuthor);
      b.set(r.tapbackType, (b.get(r.tapbackType) || 0) + 1);
    }
  }

  const participants = new Set([...totals.keys(), ...messageCounts.keys()]);

  const rows = [];
  for (const handle of participants) {
    const sent = messageCounts.get(handle) || 0;
    const total = totals.get(handle) || 0;
    rows.push({
      handle,
      name: displayName(handle, contactNames),
      totalReactions: total,
      breakdown: breakdowns.get(handle) || new Map(),
      messagesSent: sent,
      reactionsPerMessage: sent ? total / sent : 0,
    });
  }

  rows.sort((a, b) => b.totalReactions - a.totalReactions);
  return { rows, columns: topBreakdownColumns(reactions) };
}
