# Handoff — 2026-11-18

Branch `radio-call-round-two`, stacked on `hole-in-one` (PR #71, open). **Uncommitted.**

- Second commentary pass on the radio call, all six items Kyle approved:
  eagles shouted on the hole, closest to the pin called on the hole, blow-up holes (gross four
  over or worse), the turn as a halftime show, a real week segment after rounds 2 and 3, and
  the trip finale with a play of the trip, each player's week and a blooper of the week.
- Recap card "Shot of the day" now says "hole in one".
- Variety pass: 209 takes appended across the 73 new pools (appended, never inserted).
- New fixture: `ROUND_TWO` + `weekDb` in `src/test/reportFixture.ts`.
- Tests: `radioCall.test.ts` 26; `vitest run --dir src` → 280. `npm run build` clean.
- Not heard on a phone. Rounds 3 and 4 and a real finale only exist as fixture data.
- Next: merge #71 first, then this; Kyle listens to takes from Admin → Radio call.
