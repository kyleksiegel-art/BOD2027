# Handoff

**Not a numbered phase.** Design-refinement pass from Kyle's external brief (typography axes,
leader/winner color hierarchy, course identity colors, contrast). Branch `design-refinements` off
`main` (Phases 0–8 + the tiebreaker chain are merged to `main`; not yet pushed).

**Built:** Fraunces swapped to Fontsource's `full` build (was `wght`-only) to unlock `opsz`/`SOFT`
— font payload ~169 KB, over the ≤80 KB checklist target, accepted (`decisions.md`). New
`.fx-display/.fx-head/.fx-title/.fx-serif-sm` axis utilities; `.leader-row` gold spine/tint reused
on Standings, round Leaderboard, Money's 1st place, Enter's round-so-far; `courseSlug()` +
`.round[data-course]` accent rails/swatches on Rounds/Home/RoundDetail (rail uses `box-shadow`,
not `border-left` — see CLAUDE.md for why); `--paper-dim`/`--paper-faint` darkened ~12%. Also:
`HeroPhoto` now recovers from a failed hero-image fetch (drops `<source>`s on `onError`, falls
through to the JPG) — found live during this session's own browser verification, not a bad deploy.

**Verified:** `vitest run` → 148 (unchanged, no logic touched). `tsc -b` + `npm run build` clean.
Browser-checked Home, Standings, Money, Rounds, RoundDetail on the local dev server — leader
spine/tint, course rails, and sharper display type all confirmed live (some via computed-style
JS checks, not just screenshots).

Committed and pushed to `design-refinements`; Kyle to review the Netlify deploy preview and merge.

**Next:** Phase 9 — Polish (Lighthouse pass, README) is still the next numbered phase; this
session didn't touch it.
