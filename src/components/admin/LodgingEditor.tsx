import { useState } from 'react'
import { saveLodging, saveLodgingAssignment, type LodgingInput } from '@/lib/data/admin'
import type { AdminLodgingVM } from '@/lib/data/compute'
import type { LodgingAssignmentRow, LodgingRow, PlayerRow } from '@/lib/data/types'
import { Button, Field, Report, Section, inputClass, useAdminAction } from './kit'

// ── One room assignment (player + room label) ──────────────────────────────────
interface AssignDraft {
  id: string | null
  playerId: string
  roomLabel: string
}

function AssignmentRow({
  lodgingId,
  initial,
  players,
  disabled,
  onSaved,
}: {
  lodgingId: string
  initial: AssignDraft
  players: PlayerRow[]
  disabled: boolean
  onSaved?: () => void
}) {
  const [d, setD] = useState<AssignDraft>(initial)
  const { busy, report, run } = useAdminAction()
  const canSave = d.playerId !== ''

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-hair p-3">
      <div className="min-w-[10rem] flex-1">
        <Field label="Player">
          <select
            className={inputClass}
            value={d.playerId}
            onChange={(e) => setD((p) => ({ ...p, playerId: e.target.value }))}
            disabled={disabled}
          >
            <option value="">Select…</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="w-32">
        <Field label="Room">
          <input
            className={inputClass}
            value={d.roomLabel}
            placeholder="optional"
            onChange={(e) => setD((p) => ({ ...p, roomLabel: e.target.value }))}
            disabled={disabled}
          />
        </Field>
      </div>
      <Button
        tone="primary"
        disabled={disabled || busy || !canSave}
        onClick={() =>
          void run(
            'Assignment saved.',
            () =>
              saveLodgingAssignment({
                id: d.id,
                lodgingId,
                playerId: d.playerId,
                roomLabel: d.roomLabel.trim() === '' ? null : d.roomLabel.trim(),
              }),
            onSaved,
          )
        }
      >
        {busy ? 'Saving…' : d.id ? 'Save' : 'Add'}
      </Button>
      <Report report={report} />
    </div>
  )
}

function Assignments({
  lodgingId,
  rows,
  players,
  disabled,
}: {
  lodgingId: string
  rows: LodgingAssignmentRow[]
  players: PlayerRow[]
  disabled: boolean
}) {
  const [newKeys, setNewKeys] = useState<number[]>([])
  const [seq, setSeq] = useState(0)
  const nameOf = new Map(players.map((p) => [p.id, p.name]))

  return (
    <div className="mt-4 border-t border-hair pt-4">
      <span className="eyebrow block">Rooms</span>
      {rows.length === 0 && newKeys.length === 0 ? (
        <p className="mt-2 text-[0.8rem] text-paper-faint">No one assigned yet.</p>
      ) : null}
      <div className="mt-2 space-y-2">
        {rows.map((a) => (
          <AssignmentRow
            key={a.id}
            lodgingId={lodgingId}
            players={players}
            disabled={disabled}
            initial={{ id: a.id, playerId: a.player_id, roomLabel: a.room_label ?? '' }}
          />
        ))}
        {newKeys.map((k) => (
          <AssignmentRow
            key={`new-${k}`}
            lodgingId={lodgingId}
            players={players}
            disabled={disabled}
            initial={{ id: null, playerId: '', roomLabel: '' }}
            onSaved={() => setNewKeys((ks) => ks.filter((x) => x !== k))}
          />
        ))}
      </div>
      <div className="mt-2 text-[0.75rem] text-paper-faint">
        {rows.map((a) => nameOf.get(a.player_id) ?? 'Unknown').join(', ')}
      </div>
      <div className="mt-3">
        <Button
          disabled={disabled}
          onClick={() => {
            setNewKeys((ks) => [...ks, seq])
            setSeq((s) => s + 1)
          }}
        >
          + Add room
        </Button>
      </div>
    </div>
  )
}

// ── One lodging property ────────────────────────────────────────────────────────
interface LodgingDraft {
  id: string | null
  property: string
  checkIn: string
  checkOut: string
  confirmation: string
  notes: string
}

function draftFromRow(row: LodgingRow): LodgingDraft {
  return {
    id: row.id,
    property: row.property,
    checkIn: row.check_in,
    checkOut: row.check_out,
    confirmation: row.confirmation ?? '',
    notes: row.notes ?? '',
  }
}

function toInput(d: LodgingDraft): LodgingInput {
  return {
    id: d.id,
    property: d.property.trim(),
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    confirmation: d.confirmation.trim() === '' ? null : d.confirmation.trim(),
    notes: d.notes.trim() === '' ? null : d.notes.trim(),
  }
}

function LodgingCard({
  initial,
  assignments,
  players,
  disabled,
  onSaved,
}: {
  initial: LodgingDraft
  assignments: LodgingAssignmentRow[]
  players: PlayerRow[]
  disabled: boolean
  onSaved?: () => void
}) {
  const [d, setD] = useState<LodgingDraft>(initial)
  const { busy, report, run } = useAdminAction()
  const patch = (change: Partial<LodgingDraft>) => setD((prev) => ({ ...prev, ...change }))
  const canSave =
    d.property.trim() !== '' && d.checkIn !== '' && d.checkOut !== '' && d.checkOut >= d.checkIn

  return (
    <Section title={d.property.trim() === '' ? 'New property' : d.property}>
      <div className="mt-3">
        <Field label="Property">
          <input
            className={inputClass}
            value={d.property}
            placeholder="e.g. The Lodge at Streamsong"
            onChange={(e) => patch({ property: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Check in">
          <input
            type="date"
            className={inputClass}
            value={d.checkIn}
            onChange={(e) => patch({ checkIn: e.target.value })}
            disabled={disabled}
          />
        </Field>
        <Field label="Check out">
          <input
            type="date"
            className={inputClass}
            value={d.checkOut}
            onChange={(e) => patch({ checkOut: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Confirmation">
          <input
            className={inputClass}
            value={d.confirmation}
            placeholder="optional"
            onChange={(e) => patch({ confirmation: e.target.value })}
            disabled={disabled}
          />
        </Field>
        <Field label="Notes">
          <input
            className={inputClass}
            value={d.notes}
            placeholder="optional"
            onChange={(e) => patch({ notes: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Button
          tone="primary"
          disabled={disabled || busy || !canSave}
          onClick={() => void run('Property saved.', () => saveLodging(toInput(d)), onSaved)}
        >
          {busy ? 'Saving…' : d.id ? 'Save' : 'Add property'}
        </Button>
        <Report report={report} />
      </div>

      {d.id ? (
        <Assignments
          lodgingId={d.id}
          rows={assignments}
          players={players}
          disabled={disabled}
        />
      ) : (
        <p className="mt-4 border-t border-hair pt-4 text-[0.8rem] text-paper-faint">
          Save the property first to assign rooms.
        </p>
      )}
    </Section>
  )
}

/**
 * Lodging + room assignments. Online-only. No delete this phase (Kyle, 2026-08-24). A new
 * property must be saved before its rooms can be assigned — the assignment RPC needs the
 * lodging id — so the room controls only appear once the property exists.
 */
export function LodgingEditor({
  lodging,
  players,
  defaultCheckIn,
  defaultCheckOut,
  disabled,
}: {
  lodging: AdminLodgingVM[]
  players: PlayerRow[]
  defaultCheckIn: string
  defaultCheckOut: string
  disabled: boolean
}) {
  const [newKeys, setNewKeys] = useState<number[]>([])
  const [seq, setSeq] = useState(0)

  return (
    <>
      <p className="mt-4 text-[0.88rem] leading-relaxed text-paper-dim">
        Where everyone is staying, and who’s in which room. Dates render everywhere in Eastern
        time.
      </p>

      {lodging.map((l) => (
        <LodgingCard
          key={l.row.id}
          initial={draftFromRow(l.row)}
          assignments={l.assignments}
          players={players}
          disabled={disabled}
        />
      ))}

      {newKeys.map((k) => (
        <LodgingCard
          key={`new-${k}`}
          initial={{
            id: null,
            property: '',
            checkIn: defaultCheckIn,
            checkOut: defaultCheckOut,
            confirmation: '',
            notes: '',
          }}
          assignments={[]}
          players={players}
          disabled={disabled}
          onSaved={() => setNewKeys((ks) => ks.filter((x) => x !== k))}
        />
      ))}

      <div className="mt-4">
        <Button
          disabled={disabled}
          onClick={() => {
            setNewKeys((ks) => [...ks, seq])
            setSeq((s) => s + 1)
          }}
        >
          + Add property
        </Button>
      </div>
    </>
  )
}
