import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { PlayerEntryRow } from '@/components/enter/PlayerEntryRow'
import { useEnterHole, usePendingHoles, useRoundChoices } from '@/lib/data/selectors'
import type { EnterDraft } from '@/lib/data/compute'
import { saveCells, subscribeWriteState, getWriteState } from '@/lib/data/mutations'

function useWriteState() {
  return useSyncExternalStore(subscribeWriteState, getWriteState, getWriteState)
}

/** Unsaved edits, per hole, per player. Cleared for a hole once its save succeeds. */
type DraftsByHole = Record<number, Record<string, EnterDraft>>

const EMPTY: Record<string, EnterDraft> = {}

export default function Enter() {
  const rounds = useRoundChoices()
  const write = useWriteState()

  const [roundNumber, setRoundNumber] = useState<number | null>(null)
  const [hole, setHole] = useState(1)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Which hole was most recently saved, so an untouched hole doesn't claim "Saved".
  const [justSaved, setJustSaved] = useState<number | null>(null)

  // Nothing is written until Save is tapped, so unsaved edits have to survive paging
  // between holes — otherwise walking back to check hole 12 would throw away hole 13.
  const [drafts, setDrafts] = useState<DraftsByHole>({})
  // The same map in a ref. React state does not settle within a single frame, so two taps
  // landing in one frame would both read the pre-tap value and one increment would vanish.
  // The ref is the value the next tap computes from; the state is what renders.
  const draftsRef = useRef<DraftsByHole>({})

  // Default to the round actually being played; failing that, the first one not yet final.
  useEffect(() => {
    if (roundNumber !== null || !rounds || rounds.length === 0) return
    const live = rounds.find((r) => r.status === 'in_progress')
    const next = rounds.find((r) => r.status === 'upcoming')
    setRoundNumber((live ?? next ?? rounds[0]).roundNumber)
  }, [rounds, roundNumber])

  const { vm, loading } = useEnterHole(roundNumber ?? 1, hole, drafts[hole] ?? EMPTY)
  // Holes recorded on this phone but not yet acknowledged by the server. Distinct from a
  // draft: a draft is not recorded anywhere, a pending hole is recorded and merely owed.
  const pendingHoles = usePendingHoles(vm?.round.id ?? null)

  function setDraft(playerId: string, draft: EnterDraft) {
    const forHole = { ...(draftsRef.current[hole] ?? {}), [playerId]: draft }
    draftsRef.current = { ...draftsRef.current, [hole]: forHole }
    setDrafts(draftsRef.current)
  }

  if (loading || !rounds || roundNumber === null) {
    return (
      <Page>
        <PageHeader eyebrow="Hole by Hole" title="Enter Scores" />
        <p className="mt-6 text-paper-dim">Loading…</p>
      </Page>
    )
  }

  if (!vm) {
    return (
      <Page>
        <PageHeader eyebrow="Hole by Hole" title="Enter Scores" />
        <p className="mt-6 text-paper-dim">That round doesn’t exist.</p>
      </Page>
    )
  }

  const canEdit = vm.blocked === null && vm.hole !== null
  const holeDrafts = drafts[hole] ?? EMPTY
  const dirtyHoles = Object.keys(drafts)
    .map(Number)
    .filter((h) => Object.keys(drafts[h] ?? {}).length > 0)
    .sort((a, b) => a - b)
  const holeIsDirty = Object.keys(holeDrafts).length > 0

  // A hole isn't saved until every playing player has a score on it — a gross or a pick-up.
  // Drafts are already overlaid into vm.players (buildEnterHole), so this counts unsaved
  // edits alongside cells saved earlier: editing one player of an already-complete hole
  // still passes, but a fresh hole stays locked until the fourth score is in.
  const playing = vm.players.filter((p) => p.status === 'playing')
  const stillNeed = playing.filter((p) => p.gross === null && !p.pickedUp).map((p) => p.name)
  const allEntered = playing.length > 0 && stillNeed.length === 0

  /** A stepper tap. `stored` is the value on screen; an unsaved edit outranks it. */
  function step(playerId: string, delta: number, stored: number) {
    const current = draftsRef.current[hole]?.[playerId]?.grossStrokes ?? stored
    setDraft(playerId, {
      grossStrokes: Math.min(25, Math.max(1, current + delta)),
      pickedUp: false,
    })
  }

  function togglePickedUp(playerId: string, pickedUp: boolean) {
    // Un-picking-up clears the cell back to "not entered yet" rather than inventing a score.
    setDraft(playerId, { grossStrokes: null, pickedUp: !pickedUp })
  }

  async function saveHole() {
    if (!vm || !holeIsDirty) return
    const ok = await saveCells(
      Object.entries(holeDrafts).map(([playerId, d]) => ({
        roundId: vm.round.id,
        playerId,
        holeNumber: hole,
        grossStrokes: d.grossStrokes,
        pickedUp: d.pickedUp,
      })),
    )
    // saveCells resolves true once the hole is durably queued — offline included. It is
    // false only if this device could not record it at all, and then the edits stay put.
    if (!ok) return
    const rest = { ...draftsRef.current }
    delete rest[hole]
    draftsRef.current = rest
    setDrafts(rest)
    setJustSaved(hole)
  }

  return (
    <Page>
      <PageHeader eyebrow="Hole by Hole" title="Enter Scores" meta={vm.course.name} />

      {/* Round picker */}
      <div className="mt-5 grid grid-cols-4 gap-2">
        {rounds.map((r) => (
          <button
            key={r.roundNumber}
            type="button"
            onClick={() => {
              setRoundNumber(r.roundNumber)
              setHole(1)
              draftsRef.current = {}
              setDrafts({})
            }}
            className={`tap rounded-md border px-2 py-2 text-[0.78rem] leading-tight ${
              r.roundNumber === roundNumber
                ? 'border-gold bg-gold/15 text-paper'
                : 'border-hair text-paper-dim'
            }`}
          >
            <span className="block font-semibold">R{r.roundNumber}</span>
            <span className="block truncate text-[0.7rem] text-paper-faint">{r.courseName}</span>
          </button>
        ))}
      </div>

      {/* Pre-flight: without a round_players row a device cannot compute strokes received,
          so it cannot score that player at all — offline least of all. Loud, not subtle. */}
      {vm.missingRoundPlayers.length > 0 ? (
        <p className="mt-4 rounded-md border border-gold/40 bg-gold/10 p-3 text-[0.85rem] leading-relaxed text-paper">
          <strong>No tee or handicap set</strong> for {vm.missingRoundPlayers.join(', ')}. They
          can’t be scored in this round until that’s done in{' '}
          <Link to="/admin" className="underline underline-offset-2">
            admin
          </Link>
          .
        </p>
      ) : null}

      {/* The Round 4 hard block. Not a dismissible banner — a genuine stop, with the list
          of what's missing and where to go fix it. */}
      {vm.blocked?.reason === 'course_card_incomplete' ? (
        <section className="mt-5 rounded-lg border border-hair bg-black/20 p-5">
          <span className="eyebrow block">Blocked</span>
          <h2 className="mt-2 font-display text-2xl text-paper">
            {vm.course.name}’s scorecard isn’t entered yet
          </h2>
          <p className="mt-2 text-[0.9rem] leading-relaxed text-paper-dim">
            Scoring stays off until the card is complete and validated. Still missing:
          </p>
          <ul className="mt-3 space-y-1 text-[0.88rem] text-paper">
            {vm.blocked.issues.map((issue) => (
              <li key={issue}>· {issue}</li>
            ))}
          </ul>
          <Link
            to="/admin"
            className="tap mt-4 inline-flex items-center rounded-md border border-gold px-4 py-2 text-[0.9rem] font-semibold text-gold"
          >
            Open the course editor
          </Link>
        </section>
      ) : null}

      {vm.blocked?.reason === 'round_upcoming' ? (
        <p className="mt-5 rounded-md border border-hair bg-black/20 p-4 text-[0.9rem] text-paper-dim">
          Round {vm.round.round_number} hasn’t started. Start it from{' '}
          <Link to="/admin" className="underline underline-offset-2">
            admin
          </Link>{' '}
          when you’re on the first tee.
        </p>
      ) : null}

      {canEdit && vm.hole ? (
        <>
          {/* Hole header */}
          <div className="mt-5 flex items-center justify-between gap-2 border-y border-hair py-3">
            <button
              type="button"
              aria-label="Previous hole"
              disabled={hole === 1}
              onClick={() => setHole((h) => Math.max(1, h - 1))}
              className="tap rounded-md border border-hair-strong px-4 text-xl text-paper disabled:opacity-30"
            >
              ‹
            </button>

            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="tap flex-1 text-center"
              aria-expanded={pickerOpen}
            >
              <span className="block font-display text-2xl text-paper tnum">Hole {hole}</span>
              <span className="block text-[0.78rem] text-paper-faint tnum">
                Par {vm.hole.par} · S.I. {vm.hole.strokeIndex}
                {vm.hole.yardage !== null ? ` · ${vm.hole.yardage} yds` : ''}
                {vm.hole.teeName ? ` (${vm.hole.teeName})` : ''}
              </span>
            </button>

            <button
              type="button"
              aria-label="Next hole"
              disabled={hole === 18}
              onClick={() => setHole((h) => Math.min(18, h + 1))}
              className="tap rounded-md border border-hair-strong px-4 text-xl text-paper disabled:opacity-30"
            >
              ›
            </button>
          </div>

          {pickerOpen ? (
            <div className="mt-3 grid grid-cols-6 gap-2">
              {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setHole(n)
                    setPickerOpen(false)
                  }}
                  className={`tap rounded-md border text-[0.9rem] tnum ${
                    n === hole
                      ? 'border-gold bg-gold/15 text-paper'
                      : dirtyHoles.includes(n)
                        ? // Unsaved holes are called out, since nothing auto-saves.
                          'border-gold/60 text-gold-bright'
                        : vm.holesWithEntries.includes(n)
                          ? 'border-hair-strong text-paper'
                          : 'border-hair text-paper-faint'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}

          {/* Players */}
          <div className="mt-2">
            {vm.players.map((p) => (
              <PlayerEntryRow
                key={p.playerId}
                player={p}
                par={vm.hole!.par}
                unsaved={holeDrafts[p.playerId] !== undefined}
                onStep={(delta) => step(p.playerId, delta, p.gross ?? vm.hole!.par)}
                onTogglePickedUp={() => togglePickedUp(p.playerId, p.pickedUp)}
              />
            ))}
          </div>

          {/* Save. Nothing reaches the database without this tap — which is also what keeps
              a defaulted par from being recorded just by paging past a hole. */}
          <div className="mt-5">
            <button
              type="button"
              disabled={!holeIsDirty || !allEntered || write.status === 'saving'}
              onClick={() => void saveHole()}
              className="tap w-full rounded-md bg-gold px-4 py-3 font-semibold text-ground disabled:bg-transparent disabled:text-paper-faint disabled:outline disabled:outline-1 disabled:outline-hair"
            >
              {write.status === 'saving'
                ? 'Saving…'
                : !holeIsDirty
                  ? justSaved === hole
                    ? 'Saved'
                    : 'No changes'
                  : allEntered
                    ? `Save hole ${hole}`
                    : `All ${playing.length} scores needed`}
            </button>

            <div className="mt-2 min-h-[1.25rem] text-[0.82rem] tnum" aria-live="polite">
              {write.status === 'error' ? (
                <span className="text-gold-bright">{write.message}</span>
              ) : holeIsDirty && !allEntered ? (
                // The hole can't be saved until the whole group is in — say who's left.
                <span className="text-gold-bright">
                  Enter every score to save — still need {stillNeed.join(', ')}.
                </span>
              ) : dirtyHoles.length > 1 ? (
                <span className="text-gold-bright">
                  Unsaved on {dirtyHoles.length} holes: {dirtyHoles.join(', ')}
                </span>
              ) : write.status === 'queued' && pendingHoles.length > 0 ? (
                // Recorded, not lost — the calm colour is the point.
                <span className="text-paper-dim">
                  {write.message} ({pendingHoles.length} hole
                  {pendingHoles.length === 1 ? '' : 's'} waiting)
                </span>
              ) : null}
            </div>
          </div>

          {/* Footer: where the round stands */}
          <div className="mt-6 border-t border-hair pt-4">
            <span className="eyebrow block">Round {vm.round.round_number} so far</span>
            <ul className="mt-2 space-y-1">
              {vm.standing.map((s) => (
                <li key={s.name} className="flex justify-between text-[0.9rem] text-paper">
                  <span>{s.name}</span>
                  <span className="tnum text-paper-dim">
                    {s.points} pts · thru {s.thru}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </Page>
  )
}
