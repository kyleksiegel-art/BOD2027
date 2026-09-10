# Handoff — 2026-09-09 (Bone Valley card)

- Branch `bone-valley-card` off `main`. **Not yet committed/pushed.**
- Kyle photographed the printed Bone Valley card; migration `20260909120000_seed_bone_valley_card.sql`
  seeds par 72 (36/36), men's SI, **7 tees incl. the three combos**, 126 yardages, `year_opened` 2026,
  and **publishes** (a `do` block re-runs the RPC's checks, flips `data_is_placeholder`). See CLAUDE.md §"Bone Valley card".
- Combos from the card's ▲/▼ row (`▼▼▲▲▼▼▲▼▲ / ▼▲▲▼▲▲▲▼▼`, ▲ = back tee); all three totals reconcile.
  Two fuzzy Black cells (16 = 185, 17 = 365) settled by that reconciliation — the only consistent reading.
- Four par 3s (3, 7, 12, 16), same as the other courses; CTP rule unchanged.
- Tests: `supabase test db` → **234** (seed_integrity plan 25; write_path/admin_path re-open the placeholder
  in-transaction). `scripts/verify-card-data.py` → 0 problems (all 4 cards). `vitest run` → 184.
  `scripts/verify-admin-path.sh` §4 now uses a throwaway course for the empty-card refusal.
- Local DB reset + verified; browser check of `/info/courses/…0004` this session.
- **Hosted: pushed by Kyle 2026-09-09** and read back over PostgREST — published, 7 tees, par 3s 3/7/12/16.
- **Still owed:** commit + merge to `main` (the migration is live on hosted but uncommitted — do this
  first); on-phone look at Round 4 / the Bone Valley scorecard page. Real player indexes still outstanding.
