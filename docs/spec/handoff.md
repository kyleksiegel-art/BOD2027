# Handoff — 2026-11-18

Branch `hole-in-one` (off `main`), **uncommitted**.

- Bug (Kyle, testing): a 1 on a par 3 was called "a real eagle" (it is two under par).
- Fix: `ace` shot kind (`grossStrokes === 1`) in `fieldStory.ts` and `report.ts`.
- Radio call: the announcer goes wild on the hole (`holeCall`), keeps bringing it up for the
  rest of the round, makes it play of the day in the wrap, and names it in the trip finale.
- Field Report says "makes a hole in one"; the round report always carries a sentence for it.
- Tests: `radioCall.test.ts` 20; `vitest run --dir src` → 274. `npm run build` clean.
- Next: Kyle re-enters a 1 on a par 3 and listens (Admin → Radio call).
