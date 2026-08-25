import { useState } from 'react'
import type { RoundDetailVM } from '@/lib/data/compute'
import type { CtpPayload } from '@/lib/data/types'
import { saveCtp } from '@/lib/data/mutations'

// Closest-to-pin entry, one row per par 3, shown inside the round detail. Same offline-first
// contract as score entry: a tap edits a local draft, Save enqueues the winner through the
// outbox, and "No winner" records an explicit null-winner row — no one got on with par, so the
// hole is simply dead (no rollover), distinct from "not entered yet". CTP entry takes no PIN.
// We record only who won, not the distance — distance is never surfaced.

type Draft = { playerId: string | null | undefined }

function storedDraft(row: CtpPayload | undefined): Draft {
  return { playerId: row ? row.player_id : undefined }
}

export function CtpEntry({
  vm,
  ctpByHole,
}: {
  vm: RoundDetailVM
  ctpByHole: Map<number, CtpPayload>
}) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [savingHole, setSavingHole] = useState<number | null>(null)

  if (!vm.holes) return null
  const par3s = vm.holes.filter((h) => h.par === 3 && h.holeNumber <= vm.holesCounted)
  if (par3s.length === 0) return null

  const playing = vm.players.filter((p) => p.status === 'playing')

  const current = (hole: number): Draft => drafts[hole] ?? storedDraft(ctpByHole.get(hole))
  const setDraft = (hole: number, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [hole]: { ...current(hole), ...patch } }))

  const isDirty = (hole: number): boolean => {
    const d = drafts[hole]
    if (!d) return false
    return d.playerId !== storedDraft(ctpByHole.get(hole)).playerId
  }

  const save = async (hole: number) => {
    const d = current(hole)
    if (d.playerId === undefined) return // nothing chosen
    setSavingHole(hole)
    const payload: CtpPayload = {
      round_id: vm.round.id,
      hole_number: hole,
      player_id: d.playerId, // string winner, or null for "no winner"
      distance_feet: null, // distance is no longer tracked
    }
    const ok = await saveCtp(payload)
    setSavingHole(null)
    if (ok) setDrafts((prev) => { const { [hole]: _drop, ...rest } = prev; return rest })
  }

  const editable = vm.round.status === 'in_progress' || vm.round.status === 'final'

  return (
    <section className="mt-8">
      <span className="eyebrow block">Closest to pin</span>
      <p className="mt-2 text-[0.8rem] text-paper-dim">
        One winner per par 3 — closest to the pin on the green, and you must make par or better
        to claim it. Tap “No winner” if no one qualifies.
      </p>

      <div className="mt-4 space-y-3">
        {par3s.map((h) => {
          const d = current(h.holeNumber)
          const dirty = isDirty(h.holeNumber)
          const saving = savingHole === h.holeNumber
          return (
            <div key={h.holeNumber} className="rounded-lg border border-hair bg-ground-2 p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-lg text-paper">Hole {h.holeNumber}</span>
                <span className="text-[0.75rem] text-paper-faint tnum">par 3</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {playing.map((p) => {
                  const sel = d.playerId === p.playerId
                  return (
                    <button
                      key={p.playerId}
                      type="button"
                      disabled={!editable}
                      aria-pressed={sel}
                      onClick={() => setDraft(h.holeNumber, { playerId: p.playerId })}
                      className={`tap rounded-md border px-3 text-[0.85rem] disabled:opacity-40 ${
                        sel ? 'border-gold bg-gold text-ground font-semibold' : 'border-hair-strong text-paper'
                      }`}
                    >
                      {p.name}
                    </button>
                  )
                })}
                <button
                  type="button"
                  disabled={!editable}
                  aria-pressed={d.playerId === null}
                  onClick={() => setDraft(h.holeNumber, { playerId: null })}
                  className={`tap rounded-md border px-3 text-[0.85rem] disabled:opacity-40 ${
                    d.playerId === null
                      ? 'border-gold bg-gold text-ground font-semibold'
                      : 'border-hair-strong text-paper-dim'
                  }`}
                >
                  No winner
                </button>
              </div>

              <div className="mt-3 flex items-center justify-end">
                <button
                  type="button"
                  disabled={!editable || !dirty || saving || d.playerId === undefined}
                  onClick={() => void save(h.holeNumber)}
                  className="tap rounded-md bg-gold px-4 py-2 text-[0.85rem] font-semibold text-ground disabled:opacity-40"
                >
                  {saving ? 'Saving…' : dirty ? `Save hole ${h.holeNumber}` : 'Saved'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
