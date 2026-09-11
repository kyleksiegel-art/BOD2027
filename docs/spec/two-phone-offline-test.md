# Two-phone offline test script

The manual, on-device checks that no unit test or single-browser run can prove. These are the
last real unknowns before the trip (see `audit/REPORT.md` §"Remaining limitations"). Run the
whole thing once end to end; it takes about 20 minutes. Record the result at the bottom.

**App:** https://bod2027.netlify.app · **Admin/Diagnostics PIN:** the trip PIN (4 digits).

## What you need

- **Two phones.** Ideally one iPhone (for Test A) plus any second phone or a laptop browser.
- Both on the same wifi to start, so both can load the app and cache the trip.
- A **throwaway round to score on.** The hosted data is all demo data until February, so nothing
  here is precious — but to keep it tidy, pick one round (this script uses **Round 4 · Bone
  Valley**) and reset it at the end (Cleanup below).

## One-time setup (both phones, on wifi)

1. On each phone open https://bod2027.netlify.app. If it shows an old look, pull to refresh or
   accept the **"New version — reload"** prompt so you're on the current build.
2. On each phone, open **Info → (scroll) → Diagnostics** or go to `/diagnostics`, enter the PIN,
   and note the **client_id** (they must be different — that's what makes them "two devices").
   Leave this tab handy; you'll re-check the **Outbox** and **Dead letter** here.
3. Make sure **Round 4** is scoreable: open **Admin → Rounds → Round 4**. If it's "Upcoming",
   set a tee for each player, **Save tees & status**, then **Start round**. It should read
   **In progress**. Both phones must have opened the app *while online* at least once after this,
   so the tees/handicaps are cached for offline scoring.

> Going offline = **Airplane mode** (Control Center). The app checks real reachability, not just
> the wifi icon, so airplane mode is the reliable way to simulate no signal. The connection badge
> in the top bar should switch to **Offline** within a few seconds.

---

## Test A — iOS install, then unlock (iPhone)

Why: a home-screen PWA can get separate storage from Safari, so unlocking in Safari and *then*
installing can leave you locked out with no signal. Order matters.

1. In Safari, open the app. **Share → Add to Home Screen.** Add it.
2. Close Safari. Open the app **from the home-screen icon** (not Safari).
3. Go to **Admin**, enter the PIN, **Unlock**. It should unlock.
4. Turn on **Airplane mode**. Fully close the app (swipe it away) and reopen it from the icon.
5. Go to **Enter** and tap a stepper on any player.

- [ ] **PASS** if: the app opens offline, Enter works, and scores can be entered with no network.
- Notes: ____________________________________________

---

## Test B — two phones online, live update (~seconds)

Why: a score on one phone must appear on the other without a refresh (Realtime).

1. Both phones online. Both open **Enter → Round 4**, same hole (say hole 1).
2. On **Phone 1**, enter all four scores and tap **Save hole 1**.
3. Watch **Phone 2** — open **Standings** or **Rounds → Round 4** on it and don't touch it.

- [ ] **PASS** if: within a few seconds, Phone 2's board/scorecard shows Phone 1's scores with no
  manual refresh.
- Notes: ____________________________________________

---

## Test C — full offline round, force-quit, cold reopen, reconnect (the big one)

Why: this is the airplane-mode scenario the whole trip depends on — a round entered with no
signal must survive a force-quit and land correctly when signal returns, with nothing lost and
nothing duplicated.

Do this on **Phone 1** only.

1. **Airplane mode ON.** Confirm the badge reads **Offline**.
2. Open **Enter → Round 4**. Enter **all four players on every hole, 1 through 18** (a mix of
   real scores and a couple of **PU** pick-ups). Tap **Save** on each hole. The badge climbs:
   **"N to sync"**.
3. Open **Standings** and **Rounds → Round 4**. Both should render fully **from cache** — totals,
   scorecard, the points — even though you're offline. On the scorecard, unsynced cells show a
   small **amber dot** (legend: "on this phone, awaiting sync").
4. Open **Diagnostics**: the **Outbox** should list your holes; **Dead letter** should be empty.
5. **Force-quit the app** (swipe it away) while still in Airplane mode.
6. **Reopen** the app, still in Airplane mode. Go to **Standings** and **Rounds → Round 4**.
   Everything you entered should still be there.
7. **Turn Airplane mode OFF.** Watch the badge: **"N to sync"** should count down to **Online**
   within a minute or so (or immediately if you reopen Enter).
8. Re-check **Diagnostics → Outbox** (should be **empty**) and **Dead letter** (should be
   **empty**). Open **Standings** — the totals should be unchanged from what you saw offline.
9. On **Phone 2** (online the whole time), open Round 4 — the same scores should be there.

- [ ] **PASS** if: every hole survived the force-quit and cold reopen offline; after reconnect the
  outbox drained to zero with no dead-letter; Phone 2 shows the same scores; and **nothing is
  duplicated or missing** (spot-check a few holes on both phones and the totals match).
- Notes: ____________________________________________

Reset Round 4 before Test D: **Admin → Round 4 → Clear scores → confirm.**

---

## Test D — same hole, both offline, converge + "replaced" notice (F-013)

Why: two carts can score the same hole while both are offline. When they reconnect the later
entry must win, both phones must end up identical, and the phone that lost must be *told* — not
left showing its own value under "Saved."

1. Both phones **online**, both open **Enter → Round 4 → hole 5**. (Round 4 is empty again after
   the Test C reset.)
2. **Both phones: Airplane mode ON.** Badge reads **Offline** on both.
3. On **Phone 1**: set hole 5 for all four players, one of them to **gross 5**. Tap **Save**.
4. Wait ~10 seconds. On **Phone 2**: set hole 5 for all four, that same player to **gross 6**.
   Tap **Save**. (Phone 2 saved later, so its 6 should win.)
5. **Reconnect Phone 2 first** (Airplane mode OFF). Wait for its badge to reach **Online**.
6. **Then reconnect Phone 1** (Airplane mode OFF).

- [ ] **PASS** if: after both sync, **both phones show gross 6** on that player at hole 5; **Phone 1
  shows a notice** that a newer score from another phone replaced its entry (on the Enter screen
  message line); and **Diagnostics → Dead letter is empty on both**. No hole is lost or doubled.
- Notes: ____________________________________________

Reset again before Test E: **Admin → Round 4 → Clear scores.**

---

## Test E — a cleared round doesn't leave ghosts (F-014)

Why: if an admin clears a round's scores while a phone is closed/offline, that phone must not keep
stale rows that resurface later.

1. **Phone 1:** score a few holes on Round 4 (online), so it has data. Then **close the app**
   (don't just background it — swipe it away).
2. **Phone 2 (or Admin on any device):** **Admin → Round 4 → Clear scores → confirm.**
3. **Reopen Phone 1** and let it load (it re-syncs on open). Open **Rounds → Round 4** and
   **Standings**.

- [ ] **PASS** if: Round 4 shows **no scores** on Phone 1 (the cleared state), not the rows it had
  before. Nothing "comes back."
- Notes: ____________________________________________

---

## Cleanup

- **Admin → Round 4 → Clear scores** (and re-set its status to Upcoming if you started it just for
  testing: there's no "un-start", so leaving it In progress with no scores is fine — it just shows
  as live until the real trip setup).
- If you entered anything on other rounds, clear those too.
- Nothing you did here touches the real February data; it's all demo state.

## Result

| Test | Date | Tester | Devices | Pass / Fail | Notes |
|---|---|---|---|---|---|
| A — install then unlock | | | | | |
| B — live update | | | | | |
| C — full offline round | | | | | |
| D — same-hole convergence | | | | | |
| E — cleared-round ghosts | | | | | |

If any test **fails**, capture: which phone, what you saw vs. expected, and a screenshot of
**Diagnostics → Copy state as JSON** from the affected phone — that's everything needed to debug it.
