"""Minimal extractor for message text hidden in the `attributedBody` blob.

Since macOS Ventura, `message.text` is frequently NULL and the real content
lives in `attributedBody`, an `NSArchiver`-serialized (typedstream format,
*not* NSKeyedArchiver/bplist) `NSAttributedString`. Rather than pull in a full
typedstream parser, this scans for the `NSString`/`NSMutableString` class
marker and reads the length-prefixed byte run that immediately follows it:

  - a single byte < 0x81 is the length itself
  - 0x81 is followed by a little-endian uint16 length
  - 0x82 is followed by a little-endian uint32 length

The first such string found is the message body; any subsequent NSString
occurrences are attribute-run dictionary keys/values we don't care about.
"""

from __future__ import annotations

import struct

_MARKERS = (b"NSMutableString", b"NSString")


def extract_text(blob: bytes | None) -> str | None:
    if not blob:
        return None

    for marker in _MARKERS:
        idx = blob.find(marker)
        if idx == -1:
            continue
        text = _read_length_prefixed_string(blob, idx + len(marker))
        if text:
            return text

    return None


def _read_length_prefixed_string(blob: bytes, search_from: int) -> str | None:
    # The class marker is followed by a few typedstream framing bytes before
    # the actual length-prefixed string payload; scan forward a short window
    # for a plausible length prefix rather than assuming a fixed offset.
    window_end = min(search_from + 16, len(blob))
    for pos in range(search_from, window_end):
        marker_byte = blob[pos]

        if marker_byte == 0x81:
            length_end = pos + 3
            if length_end > len(blob):
                continue
            (length,) = struct.unpack_from("<H", blob, pos + 1)
        elif marker_byte == 0x82:
            length_end = pos + 5
            if length_end > len(blob):
                continue
            (length,) = struct.unpack_from("<I", blob, pos + 1)
        elif 0 < marker_byte < 0x81:
            length = marker_byte
            length_end = pos + 1
        else:
            continue

        if length == 0 or length_end + length > len(blob):
            continue

        candidate = blob[length_end:length_end + length]
        try:
            decoded = candidate.decode("utf-8")
        except UnicodeDecodeError:
            continue

        if decoded and all(c.isprintable() or c in "\n\r\t" for c in decoded):
            return decoded

    return None
