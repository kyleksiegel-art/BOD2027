# Handoff

**Phase just finished:** 6b — the rest of offline. **Phase 6 is now complete.** Branch
`phase-6-offline` (Phases 4–6 all still uncommitted to `main`). Nothing is stubbed.

**Built:** `vite-plugin-pwa` (`registerType:'prompt'`, `injectRegister:false`, explicit
`globPatterns` + 4 MiB cap; update toast `PwaUpdatePrompt.tsx` suppressed while the outbox is
non-empty; icons in `public/` from `sips`). `navigator.storage.persist()` after unlock
(`src/lib/storage.ts`). Offline PIN: `pin-verify` returns a bcrypt hash (cost 10, env
`APP_PIN_BCRYPT_HASH`) cached in Dexie; `unlockOffline()` verifies with `bcryptjs`; an offline
session is **tokenless** so token-gated writes wait for online. `round_player` is the 3rd outbox
kind (editor's "Save tees & handicaps" always queues, works offline, defers with no token, rides
all four comparator sites). `/diagnostics` screen (PIN-gated, not connection-gated). CSV export
(`src/lib/data/csv.ts`).

**Verified:** `vitest run` → **122** (was 106; +7 round_player, +6 offline-PIN, +3 CSV);
`test:sync` → 46; `tsc`/`build` clean; build emits `sw.js`+`manifest.webmanifest`, precache 22
entries. `supabase test db` → **232**, unchanged (no migration changed). Browser at 375 px:
online unlock cached the `$2b$10$` hash in Dexie; Diagnostics rendered; a live
`rpc_upsert_round_player` accepted the client payload and recomputed strokes 13→10. DB reset after.

**Deviations (all in `decisions.md` + checklist):** offline hash delivered on unlock, not bundled;
offline session carries no server token; the editor's tee-save always goes through the outbox
(replacing the online admin variant for that button) and preserves `manual_override`.

**Harness note (unchanged):** click injection still times out (`visibilityState:'hidden'`); taps
were dispatched as DOM events to the same React handlers. Everything else was real.

**Kyle still owes (carried):** real indexes + assignments + tees; the real 4-digit PIN as Supabase
secrets — now **BOTH** `APP_PIN_ARGON2_HASH` **and** `APP_PIN_BCRYPT_HASH` (`npx tsx
scripts/hash-pin.ts <pin>` prints both); a hosted Supabase + `db push`; Netlify env vars.
**PWA install/update needs a real HTTPS origin — verify on an iPhone pre-trip** (install, unlock
inside the installed app, confirm the update toast waits while the outbox is non-empty). Two real
phones + a full airplane-mode round are still manual. **`origin/main` is still only the countdown
page — nothing has ever merged.**

**PIN is now `1922`** (Kyle's choice, 2026-08-21 — replaced the `2718` dev placeholder; both
argon2 + bcrypt hashes regenerated in `.env` and `.env.example`). Run `supabase functions serve
--env-file supabase/functions/.env --no-verify-jwt` alongside `supabase start` so the edge
function picks up the env.

**Next phase:** 7 — Money: CTP entry inside Rounds detail (par-3 rows, feet, no-winner + carry),
`round_money` snapshot on `rpc_finalize_round`, buy-in reconciliation, greedy settlement. Read
`CLAUDE.md` §"Offline path (Phase 6b)", `acceptance-checklist.md` §Phase 6b, this file, and
Phase 7 in `phase-plan.md`.
