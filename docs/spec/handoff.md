# Handoff

**Phase just finished:** 1 — Vite/React/TS/Tailwind scaffold, routing, app shell, design tokens, self-hosted fonts, `netlify.toml`. On branch `phase-1-scaffold`; `main` (live countdown) untouched.

**Next phase:** 2 — Supabase schema + RLS + seeds (no UI). Read `docs/spec/schema.md` + phase-plan §"Phase 2".

**What's built:** Five tab routes (Standings/Rounds/Enter/Money/Info) + `/`, `/admin`, Info sub-routes (itinerary/courses/players/rules), 404. Home is the live countdown ported to React (target `FIRST_TEE_ISO`, 1:10 PM ET Feb 4 2027). Persistent top bar (wordmark + `navigator.onLine` badge **stub**) + bottom tab bar. Streamsong palette tokens in `src/index.css`. Static trip copy in `src/config/trip.ts`.

**Half-finished / deferred:** Font payload 84.9 KB (target ≤80 — Phase 9). No favicon (Phase 9). Connection badge + reachability = Phase 6. No Supabase/Dexie/TanStack wired yet (by design — scaffold only).

**Kyle still owes:** (1) Push `phase-1-scaffold`, confirm the Netlify **deploy-preview URL** loads + capture Lighthouse baseline. (2) Phase 3 tiebreaker: R3 is Blue, Black is R2 after the swap — confirm countback stays positional (R3 first) or re-pins to Black.

**Verified:** `npm run build` clean; live preview of Home/Standings/Info/404 on 375px mobile, no console errors; countdown ticking; active-tab highlight works.

**Read at start of next session:** `CLAUDE.md`, `docs/spec/acceptance-checklist.md`, this file, `docs/spec/schema.md`, phase-plan §"Phase 2".
