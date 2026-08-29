# Handoff

**Phase just finished:** 8 — Info + admin editors. Built on branch `phase-8-info` (off
`phase-7-money`; Phases 4–8 unmerged, `origin/main` is still only the countdown page — Kyle's
call). **Not yet committed** — commit and push `phase-8-info`. Nothing stubbed.

**No migration, no new RPC.** The three Info RPCs (`rpc_upsert_itinerary` / `_lodging` /
`_lodging_assignment`) and `rpc_upsert_round` already existed + gated (Phase 5B). Phase 8 is
client wiring + UI only, so `supabase test db` is unchanged (232).

**Built:** Dexie **v6** (`itinerary_items`/`lodging`/`lodging_assignments` — plain reference
tables, hydrated + read); compute `buildItinerary`/`buildLodging`/`buildCoursesIndex`/
`buildCourseDetail`/`buildPlayerCourseHandicaps`; selectors + `PlayerCardVM.courseHandicaps`.
Public pages: Itinerary timeline (current-day highlight), Courses index + `/info/courses/:id`
scorecard, Players (per-course handicap, live from index), Rules (money section rewritten to the
buy-in model). Admin: Itinerary + Lodging editors, tee-time field in RoundsEditor, two new tabs,
writes in `admin.ts`. Time helpers in `format.ts`, all `America/New_York`. See CLAUDE.md §"Info +
admin editors (Phase 8)" and `decisions.md §"Phase 8"`.

**Verified:** `vitest run` → **140** (+10 `info.test.ts`); `tsc -b` + `npm run build` clean.
Browser (local Supabase, 375 px): all four Info pages render on real data; a real itinerary add
via the admin editor round-tripped through the server to the public timeline ("Thu Feb 4 · 7:00
PM ET"); demo row cleaned up via SQL.

**Deviations (in `decisions.md` + checklist):** no delete path for Info editors (Kyle — small
fixed data set); Rules money copy corrected to the buy-in model. Player photo **upload** stays
Phase 9.

**Kyle still owes (carried):** real indexes/tees/PIN secrets (`APP_PIN_ARGON2_HASH` +
`APP_PIN_BCRYPT_HASH`), hosted Supabase + `db push`, Netlify env. PWA install/two-phone/airplane
are pre-trip manual checks. **PIN is `1922`.** Local admin session had gone stale (server
token) — re-unlock with the PIN after a `db reset`.

**Next phase:** 9 — Polish (incl. player photo upload Edge Function). Read CLAUDE.md §"Info +
admin editors (Phase 8)", `acceptance-checklist.md` §Phase 9, this file, Phase 9 in
`phase-plan.md`.
