# Handoff — 2026-09-10 (Audit fixes shipped)

- Full QA/product/ops audit done (`audit/REPORT.md`): **21 findings, all resolved**. Branch
  `audit/p1-fixes` merged to `main` (PR #26), production deployed, and both new migrations
  pushed to hosted (`supabase migration list --linked` is clean).
- 4 P1s: DNP survives "Save tees" + a status picker (F-001); final rounds are closed to scoring
  with an admin **Reopen round** (`rpc_reopen_round`, F-009); one round-winner resolver shared by
  the recap and Money (F-010); an expired session costs no retry attempts (F-021).
- P2/P3: one `buildOverallTiebreak` feeds standings/recap/report (right week leader on a tie,
  `T1`/`LEVEL`/tiebreak note); reachability-backed admin offline gate; hydrate now deletes
  server-removed rows (ghost-row fix — the old "clear IndexedDB" caveat is retired); superseded-
  write notice; scorecard unsynced mark; finalize lists the missing hole numbers; live-index copy.
- Kyle's rulings: keep the live index (locked pre-trip), final-round lock + Reopen, CTP "par or
  better", money page as-is (F-004 closed). See CLAUDE.md §"Audit P2/P3 fixes" and decisions.md.
- Tests: `vitest run` **201**, `supabase test db` **241**, `tsc -b` + `npm run build` clean.
- **Phones:** installed PWAs keep the old build until they accept the "New version — reload"
  prompt (verified: a fresh visitor gets the new build; a cached shell shows the old one).
- **Still owed:** real player indexes (working values in now); everyone reloads to get the fixes.
