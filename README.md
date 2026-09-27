# iMessage Reaction Leaderboard

Ranks a group chat's participants by tapback reactions (loved/liked/disliked/
laughed/emphasized/questioned) received, using a local copy of your iMessage
database. Never reads or writes the live `~/Library/Messages/chat.db`.

## 1. Grant Full Disk Access

macOS blocks Terminal from reading `~/Library/Messages/chat.db` by default:

1. System Settings > Privacy & Security > Full Disk Access
2. Enable it for your terminal app (Terminal.app, iTerm, etc.)
3. Restart the terminal app

## 2. Copy the database (never touch the original)

Quit Messages.app first, so nothing is left uncommitted in the write-ahead log,
then:

```bash
mkdir -p data
cp ~/Library/Messages/chat.db data/chat_copy.db
```

If Messages.app is running you may also need the `-wal`/`-shm` files copied
alongside it for the copy to be complete; simplest is to just quit Messages
first.

## 3. Install dependencies

```bash
python3 -m pip install -r requirements.txt
```

(use `python3 -m pip`, not bare `pip` - some macOS Python installs don't put
a `pip` command on PATH even though the module is there)

## 4. Find your chat

```bash
python3 main.py --db data/chat_copy.db --list-chats
```

Prints every chat's ROWID, participant count, and name/identifier.

## 5. Run the leaderboard

```bash
python3 main.py --db data/chat_copy.db --chat <ROWID or name>
```

Prints a table, writes `reactions_leaderboard.csv`, and optionally a chart:

```bash
python3 main.py --db data/chat_copy.db --chat <ROWID> --chart leaderboard.png
```

Other flags:

- `--include-self-reactions` - count someone reacting to their own message
  (excluded by default)
- Names are resolved automatically from the macOS Contacts app (same Full
  Disk Access grant as chat.db covers it). Pass `--names handle_names.json`
  (copy `handle_names.example.json` to start) to manually override or fill
  in anyone Contacts doesn't resolve; use `--no-contacts` to disable the
  automatic lookup entirely.
- `--dump-messages N` - print the first N resolved message texts (and
  whether each came from `text` or the `attributedBody` fallback) for
  debugging/verification, then exit.

## 6. Web UI (optional)

For a visual leaderboard instead of the terminal table:

```bash
python3 app.py --db data/chat_copy.db
```

Then open <http://127.0.0.1:5050>. Type part of a group chat's name, pick it
from the dropdown, and see a ranked list of participants with their total
reactions, reactions-per-message rate, and a breakdown by tapback type.
Contacts lookup works the same as the CLI (automatic, on by default); pass
`--names handle_names.json` the same way as `main.py` for manual overrides.
The web UI always excludes self-reactions - use the CLI's
`--include-self-reactions` flag if you need that mode.

## 7. Public, shareable version (optional)

`public/` is a separate, standalone site anyone can use with their own
`chat.db` - no server, no upload, everything runs in their browser via
SQLite-in-WebAssembly. See `public/README.md` for how to run or deploy it.

## Notes on how this works

- `message.date` is nanoseconds since 2001-01-01, not Unix epoch - handled in
  `db.apple_ts_to_datetime`.
- When `message.text` is NULL (common for richly formatted messages since
  Ventura), the text is recovered from the `attributedBody` blob via a small
  hand-rolled typedstream scanner in `attributed_body.py` rather than a full
  parser library.
- Reactions are `message` rows with `associated_message_type` in `2000-2005`
  (the 6 classic tapbacks) or `2000-2999` more generally, since iOS also
  lets you tapback with *any* emoji - those land as custom types like `2006`
  with the actual emoji in `associated_message_emoji`. Their
  `associated_message_guid` (after stripping a `p:<n>/` or `bp:` prefix)
  links back to the original message's `guid`. Any type `3000-3999` is the
  same reaction being *removed* and is always ignored.
- The breakdown shown (table columns / CSV columns / web UI pills) isn't a
  fixed set of 6 - it's whichever 6 reaction identities (standard tapback or
  custom emoji) are actually most common in that specific chat
  (`report.top_breakdown_columns`). A chat full of 💀 reactions will show 💀
  as its own column instead of, say, "disliked" if disliked is rarer there.
  Each person's total reactions and reactions-per-message always include
  *every* reaction they received, even ones outside that chat's top 6.
