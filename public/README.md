# Reaction Leaderboard (public, client-side)

A standalone static site: anyone can upload their own `chat.db` (and
optionally a `.vcf` contacts export) and get the same reaction leaderboard
as the local tool - entirely in their own browser. No server, no upload,
nothing persisted. This is separate from `../main.py`/`../app.py` (the
personal local tool) - it doesn't read this machine's Contacts or chat.db.

## How it works

SQLite is compiled to WebAssembly ([`sql.js`](https://sql.js.org), vendored
in `vendor/`) and run inside a Web Worker (`sqlClient.js`) so a large
database doesn't freeze the page. The uploaded `.vcf` is parsed locally
(`vcard.js`) into a phone/email -> name map, replacing the local tool's
macOS-only Contacts lookup. `db.js`/`reactions.js`/`report.js`/
`attributedBody.js` are direct ports of the same-named Python modules -
same SQL, same reaction-matching logic, same dynamic top-6 breakdown - kept
that way so the two can be diffed against each other when either changes.

## Run it locally

ES modules and the WASM worker need a real HTTP origin, not `file://`:

```bash
cd public
python3 -m http.server 8000
```

Then open <http://127.0.0.1:8000>.

## Deploy

Pure static files - no build step, no environment variables. Deploy the
`public/` folder as-is to Vercel, Netlify, GitHub Pages, or Cloudflare
Pages. Confirm the host serves `.wasm` as `application/wasm` (Vercel/Netlify
do this by default).

## Known limitations

- Very large `chat.db` files (hundreds of MB+) load entirely into memory in
  the visitor's browser tab - fine on a modern desktop, may be slow or
  memory-heavy on lower-end devices/mobile.
- Names only resolve for people in the uploaded `.vcf` - there's no live
  Contacts/Google API integration.
- Nothing is saved between visits; every analysis is a one-time, in-browser
  session.
