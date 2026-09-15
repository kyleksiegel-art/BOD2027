# Handoff — 2026-09-14 (App complete; January pre-trip checklist)
- State: PR #30 (player card) merged, live on bod2027.netlify.app. `main` clean, `vitest run` → 220,
  `tsc -b` + `npm run build` clean. Kyle: "this all seems pretty perfect" — maintenance only until Feb 4–7 2027.
- The logic is proven (220 vitest + 241 pgTAP); the system has never run under real conditions. Remaining
  risk is operational. Work through this in late January, on the actual phones:
  1. **Supabase awake, on a tier that won't pause** (free tier sleeps after 7 idle days). Open the app,
     confirm hydrate returns rows, confirm `pin-verify` still deploys and unlocks.
  2. **Production data is real**: fake seed scores cleared (`rpc_clear_round_scores` per round), all four
     rounds `upcoming`, real indexes entered, tees chosen, tee times set, money amounts confirmed.
  3. **All four phones**: install the PWA over HTTPS, accept one SW update prompt, confirm storage persists.
  4. **Share once on-device**: recap card, round report, strokes card — iOS Safari will have moved since Sept.
  5. **Drive one real hole**: airplane mode on, save, airplane mode off; confirm the flush, the other phone's
     Realtime update, and an empty outbox in Diagnostics.
  6. **Process rule, no mechanism**: never edit a handicap index on Players after Thursday's tee — the live
     index re-derives finalized rounds' points (only money is frozen).
