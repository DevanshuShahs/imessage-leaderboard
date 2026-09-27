// Client-side replacement for contacts.py's macOS AddressBook read: parses
// a user-provided .vcf (vCard) export into the same shape - a map from a
// normalized phone (last 10 digits) or lowercased email to a display name.
// vCard is simple enough that no dependency is needed.

export function normalizePhone(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function lookupContact(handle, contactNames) {
  if (!contactNames) return null;
  if (handle.includes("@")) {
    return contactNames[handle.trim().toLowerCase()] || null;
  }
  return contactNames[normalizePhone(handle)] || null;
}

export function parseVCard(text) {
  const result = {};
  const cards = text.split(/BEGIN:VCARD/i).slice(1);

  for (const rawCard of cards) {
    const card = rawCard.split(/END:VCARD/i)[0];
    const lines = unfoldLines(card);

    let fn = null;
    let nComposed = null;
    const handles = [];

    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const rawKey = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1).trim();
      const key = rawKey.split(";")[0].toUpperCase();

      if (key === "FN" && !fn) {
        fn = value;
      } else if (key === "N" && !nComposed) {
        // N: Family;Given;Middle;Prefix;Suffix
        const parts = value.split(";");
        const composed = [parts[1], parts[0]].filter(Boolean).join(" ").trim();
        if (composed) nComposed = composed;
      } else if (key === "TEL") {
        handles.push(value);
      } else if (key === "EMAIL") {
        handles.push(value.toLowerCase());
      }
    }

    // FN (formatted name) is the vCard-spec-preferred display name;
    // N (structured name) is only a fallback, regardless of line order.
    const name = fn || nComposed;
    if (!name) continue;
    for (const handle of handles) {
      const key = handle.includes("@")
        ? handle.toLowerCase()
        : normalizePhone(handle);
      if (key) result[key] = name;
    }
  }

  return result;
}

// vCard line folding: a line starting with a space or tab continues the
// previous line (RFC 6350 section 3.2).
function unfoldLines(text) {
  const rawLines = text.split(/\r\n|\r|\n/);
  const unfolded = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else if (line.trim() !== "") {
      unfolded.push(line);
    }
  }
  return unfolded;
}
