// Port of reactions.py - tapback (reaction) parsing and matching logic.

import { extractText } from "./attributedBody.js";

export const TAPBACK_TYPES = {
  2000: "loved",
  2001: "liked",
  2002: "disliked",
  2003: "laughed",
  2004: "emphasized",
  2005: "questioned",
};

export const ME = "me";

const GUID_PREFIX_RE = /^(?:p:\d+\/|bp:)/;

export function stripGuidPrefix(guid) {
  return guid.replace(GUID_PREFIX_RE, "");
}

export function senderOf(row) {
  return row.is_from_me ? ME : row.handle_id || "unknown";
}

export function resolveMessageText(row) {
  if (row.text) return row.text;
  return extractText(row.attributed_body);
}

// Resolve a reaction row's identity: a canonical tapback name, a raw custom
// emoji (iOS's "any emoji" tapback, associated_message_type 2006+), or null
// if this type isn't a reaction addition at all.
export function reactionIdentity(assocType, emoji) {
  const canonical = TAPBACK_TYPES[assocType];
  if (canonical !== undefined) return canonical;
  if (assocType >= 2000 && assocType < 3000) return emoji || null;
  return null;
}

export function buildReactions(messages, includeSelf = false) {
  const authorByGuid = new Map();
  for (const row of messages) {
    if (row.associated_message_type === 0) {
      authorByGuid.set(stripGuidPrefix(row.guid), senderOf(row));
    }
  }

  const messageCounts = new Map();
  for (const row of messages) {
    if (row.associated_message_type === 0) {
      const s = senderOf(row);
      messageCounts.set(s, (messageCounts.get(s) || 0) + 1);
    }
  }

  const reactions = [];
  for (const row of messages) {
    const t = row.associated_message_type;
    if (t >= 3000 && t < 4000) continue; // a reaction *removal* - never counted
    if (!(t >= 2000 && t < 3000)) continue; // not a reaction at all
    if (!row.associated_message_guid) continue;

    const identity = reactionIdentity(t, row.associated_message_emoji);

    const targetGuid = stripGuidPrefix(row.associated_message_guid);
    const targetAuthor = authorByGuid.get(targetGuid);
    if (targetAuthor === undefined) continue; // original message not fetched

    const reactor = senderOf(row);
    if (reactor === targetAuthor && !includeSelf) continue;

    reactions.push({
      reactor,
      targetAuthor,
      tapbackType: identity,
      date: row.date,
    });
  }

  return { reactions, messageCounts };
}
