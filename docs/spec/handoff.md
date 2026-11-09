# Handoff — 2026-11-08 (radio call: more lines)
- Branch `radio-call-more-lines`: every line pool in `src/lib/data/radioCall.ts` doubled (~290 new
  takes) — openers, recent-action lead-ins, stretch review, colour notes, round/week stakes, next
  hole, sign-offs, trip opener, previews, round wrap, finale. Blank "no quip" entries doubled too,
  so quips stay as rare as before.
- New takes are appended after the originals; `rand = () => 0` still picks the original wording.
- Fixed single lines (strokes line, tee time, "Big news on the week", most of the finale) unchanged.
- Rules kept: first names (full names only in opener/finale), no pronouns, walking not carts, CTP
  paid outside the app, no em dashes. Diff scanned for pronouns/CTP/dashes: clean.
- `vitest run --dir src` → 262, `npm run build` clean. Not listened to on a phone.
- Discussed, not built: Claude-written calls via an Edge Function, fed the call log so nothing repeats.
- Pre-trip checklist (late January, real phones) unchanged from the 2026-10-10 handoff.
