# Handoff

**Phase just finished:** 7 — Money. Built on branch `phase-7-money` (off `phase-6-offline`;
Phases 4–7 unmerged, `origin/main` is still only the countdown page — Kyle's call). **Not yet
committed/pushed** — commit and push `phase-7-money`. Nothing stubbed. **No migration, no new
RPC** — the tables + `rpc_upsert_ctp` + `rpc_finalize_round` shipped earlier; Phase 7 is compute
+ UI only.

**Built:** `src/lib/data/money.ts` `buildMoney()` — the whole ledger, pure, offline-identical,
integer cents, derived live from `settings` + par-3 counts (never reads `round_money`). CTP entry
`src/components/round/CtpEntry.tsx` inside `/rounds/:n` (par-3 rows, playing-only winner chips,
feet input, no-winner/carry, per-hole Save → `saveCtp` → same outbox as scores, no PIN). Money
page `src/routes/Money.tsx`: pots, 40/30/30, buy-in reconciliation, per-round cards, per-player
ledger, greedy settlement (gated until all rounds final), footnotes. `ctp_results` added to the
`Db` interface + `useDbData`. `formatMoney`/`formatMoneySigned` in `format.ts`.

**Verified:** `vitest run` → **131** (+9 `money.test.ts`); `tsc`/`build` clean; `supabase test
db` unchanged (no migration). Browser 375 px vs local Supabase: pot breakdown correct, a real CTP
save (Jon, R3 h5, 14.5 ft) landed in the DB via the outbox and flowed back to the Money page,
reconciliation "to the cent."

**Bug caught + fixed live:** a shortened round (Black, 15 holes) dropped its 4th par 3's CTP
slice → $10 reconciliation gap. Fix: cut-off par-3 slices fold into the last **played** par 3.
Locked by `money.test.ts` §"shortened round". (`decisions.md` has this + settlement-gating +
CTP-in-round-detail.)

**Deviations (all in `decisions.md` + checklist):** cut-off-par-3 fold; settlement hidden until
every round is final (zero-sum); CTP entry in the round detail, no PIN; voided CTP refunds evenly
to contributors.

**Left a harmless demo `ctp_results` row** (R3 h5) in the local fake-data DB — service_role has
no DELETE grant and a `db reset` would disrupt another active session on the stack. Clears on the
next reset.

**Kyle still owes (carried):** real indexes/tees/PIN secrets (BOTH `APP_PIN_ARGON2_HASH` +
`APP_PIN_BCRYPT_HASH`), hosted Supabase + `db push`, Netlify env. PWA install/update + two-phone +
airplane-mode + end-of-trip real settlement are pre-trip manual checks. **PIN is `1922`.**

**Next phase:** 8 — Info + admin editors (itinerary/lodging editors; the RPCs already exist +
gated). Read `CLAUDE.md` §"Money path (Phase 7)", `acceptance-checklist.md` §Phase 8, this file,
Phase 8 in `phase-plan.md`.
