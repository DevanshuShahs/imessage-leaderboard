// Port of attributed_body.py - see that file for the full explanation of
// why this scan works (typedstream NSString/NSMutableString framing).

const MARKERS = ["NSMutableString", "NSString"].map((s) =>
  new TextEncoder().encode(s)
);

export function extractText(blob) {
  if (!blob || blob.length === 0) return null;

  for (const marker of MARKERS) {
    const idx = indexOfBytes(blob, marker);
    if (idx === -1) continue;
    const text = readLengthPrefixedString(blob, idx + marker.length);
    if (text) return text;
  }

  return null;
}

function indexOfBytes(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function readLengthPrefixedString(blob, searchFrom) {
  const windowEnd = Math.min(searchFrom + 16, blob.length);
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);

  for (let pos = searchFrom; pos < windowEnd; pos++) {
    const markerByte = blob[pos];
    let length;
    let lengthEnd;

    if (markerByte === 0x81) {
      lengthEnd = pos + 3;
      if (lengthEnd > blob.length) continue;
      length = view.getUint16(pos + 1, true);
    } else if (markerByte === 0x82) {
      lengthEnd = pos + 5;
      if (lengthEnd > blob.length) continue;
      length = view.getUint32(pos + 1, true);
    } else if (markerByte > 0 && markerByte < 0x81) {
      length = markerByte;
      lengthEnd = pos + 1;
    } else {
      continue;
    }

    if (length === 0 || lengthEnd + length > blob.length) continue;

    const candidate = blob.subarray(lengthEnd, lengthEnd + length);
    let decoded;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(candidate);
    } catch {
      continue;
    }

    if (decoded && isDisplayable(decoded)) return decoded;
  }

  return null;
}

function isDisplayable(str) {
  for (const ch of str) {
    if (ch === "\n" || ch === "\r" || ch === "\t") continue;
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
