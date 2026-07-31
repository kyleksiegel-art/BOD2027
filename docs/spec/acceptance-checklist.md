# Acceptance checklist

Updated at the end of every phase with:

- Requirements implemented
- Automated tests covering them
- Manual tests performed
- **How each was verified** — concrete evidence, not an assertion
- Requirements deferred, and to which phase
- Any deviation from the brief, with the reason

A requirement is not complete merely because the UI exists.

---

## Phase 0 — Spec, decisions, plan

### Implemented

| Requirement | Verification |
|---|---|
| Phase plan proposed with two accepted adjustments (pgTAP smoke in Phase 2; pre-committed Phase 6 split) | `docs/spec/phase-plan.md` |
| File/route structure proposed | Presented in chat, captured in `phase-plan.md` per-phase deliverables |
| Supabase schema, RLS policies, RPC signatures written out | `docs/spec/schema.md` |
| `docs/spec/decisions.md` written listing every decision made outside the brief, every ambiguity resolved, and every place two requirements appeared to conflict | `docs/spec/decisions.md` |
| Answer to the open offline question: (a) — day-of tee changes carved into the outbox | `docs/spec/decisions.md` §"Answer to the open question" |
| Photo upload path chosen: Edge Function | `docs/spec/decisions.md` §"Photo upload path" |
| `CLAUDE.md` in place with architecture summary, data-layering rule, schema shape, conventions | `CLAUDE.md` |
| `docs/spec/brief.md` — verbatim copy of the brief | `docs/spec/brief.md` |
| `docs/spec/handoff.md` — 15-line session-end note | `docs/spec/handoff.md` |
| First push to GitHub | Manual push command handed to Kyle; verified once he confirms the push landed |

### Automated tests

None. Phase 0 is spec-only.

### Manual tests

None. Phase 0 is spec-only.

### Deferred requirements

Everything in the brief is deferred to a later phase per the phase plan. The brief's `CONFIG — FILL THIS IN` block (player indexes, tees, tee times, lodging, dining, travel, purse mode + amounts) is deferred to seeds and admin editors in later phases; working values acceptable until 2027-02-01, final index snapshot on that date.

### Deviations

1. **Phase 0 pushed directly to `main`**, not a `phase-0-spec` branch. Reason: repo was empty, Netlify blocked on empty repo. Phase 0 is docs only. From Phase 1 forward, one branch per phase.
2. **Phase 0 committed before verbal sign-off.** Reason: implicit go-signal from Kyle's Netlify screenshot. Any correction is a follow-up commit; no code built on top yet.

---

## Phase 1 — Scaffold

_(To be filled in at end of Phase 1.)_

---

## Phase 2 — Supabase schema + RLS + seeds

_(To be filled in at end of Phase 2.)_

---

## Phase 3 — Scoring engine

_(To be filled in at end of Phase 3.)_

---

## Phase 4 — Read-only UI

_(To be filled in at end of Phase 4.)_

---

## Phase 5 — Auth + score entry

_(To be filled in at end of Phase 5.)_

---

## Phase 6 — Offline

_(To be filled in at end of Phase 6.)_

---

## Phase 7 — Money

_(To be filled in at end of Phase 7.)_

---

## Phase 8 — Info + admin editors

_(To be filled in at end of Phase 8.)_

---

## Phase 9 — Polish

_(To be filled in at end of Phase 9.)_

---

## Definition-of-done tracker (from the brief)

These are the final acceptance criteria. Every line needs verification evidence before the trip.

- [ ] All four rounds enterable end to end, hole by hole, from a phone, including picked-up holes
- [ ] Round 4 entry is blocked until the Bone Valley card is complete and validated, and unblocks the moment it is
- [ ] Changing a point value in admin instantly recalculates every leaderboard from stored gross scores
- [ ] Changing an index or allowance does not, and requires an explicit re-snapshot
- [ ] Handicaps verify by hand (Red, Blue, Black) against a manual calculation
- [ ] Strokes-received hole list matches the printed scorecard's stroke index
- [ ] No playing handicap anywhere in the app exceeds 18
- [ ] Two phones open at once: a score on one appears on the other without a refresh
- [ ] Airplane-mode test: 18 holes × 4 players entered offline, force-quit, cold reopen offline, then reconnect syncs without loss or duplication
- [ ] Admin screens clearly refuse to write while offline; score entry in the same session stays fully functional
- [ ] Stale offline writes never clobber newer data; losing device rolls back to the winner
- [ ] A refetch on reconnect never wipes unsynced local entry
- [ ] Every server-side validation rule is enforced against a direct API call
- [ ] Anon cannot write to any table without a valid PIN session (demonstrate with `curl`)
- [ ] Anon can read every public table and Realtime events actually arrive (demonstrate with `curl` and a socket client)
- [ ] Failed PIN attempts on one device never lock out a device that already holds a valid session
- [ ] Buy-in mode reconciles to the cent
- [ ] Lighthouse mobile performance and accessibility both above 90
- [ ] Deployed and reachable at a live Netlify URL
