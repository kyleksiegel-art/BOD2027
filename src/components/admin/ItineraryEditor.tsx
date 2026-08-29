import { useState } from 'react'
import { saveItinerary, type ItineraryEntryInput } from '@/lib/data/admin'
import type { ItineraryItemRow, ItinCategory } from '@/lib/data/types'
import { composeEtTimestamp, etTimeInputValue, formatDayLong } from '@/lib/format'
import { Button, Field, Report, Section, inputClass, useAdminAction } from './kit'

const CATEGORIES: ItinCategory[] = ['travel', 'golf', 'meal', 'lodging', 'other']

interface Draft {
  id: string | null
  day: string // 'YYYY-MM-DD'
  time: string // 'HH:MM' or ''
  category: ItinCategory
  title: string
  location: string
  detail: string
  sortOrder: number
}

function draftFromRow(row: ItineraryItemRow): Draft {
  return {
    id: row.id,
    day: row.day,
    time: etTimeInputValue(row.start_time),
    category: row.category,
    title: row.title,
    location: row.location ?? '',
    detail: row.detail ?? '',
    sortOrder: row.sort_order,
  }
}

function toInput(d: Draft): ItineraryEntryInput {
  return {
    id: d.id,
    day: d.day,
    sortOrder: d.sortOrder,
    startTime: composeEtTimestamp(d.day, d.time),
    category: d.category,
    title: d.title.trim(),
    detail: d.detail.trim() === '' ? null : d.detail.trim(),
    location: d.location.trim() === '' ? null : d.location.trim(),
  }
}

/**
 * One itinerary row's form. Existing rows are keyed by id and re-derive from props; a new
 * row is a local draft that removes itself (via onSaved) once the batch RPC accepts it — the
 * saved row then re-appears from the refreshed admin VM, so it never double-creates.
 */
function ItineraryCard({
  initial,
  disabled,
  onSaved,
}: {
  initial: Draft
  disabled: boolean
  onSaved?: () => void
}) {
  const [d, setD] = useState<Draft>(initial)
  const { busy, report, run } = useAdminAction()
  const patch = (change: Partial<Draft>) => setD((prev) => ({ ...prev, ...change }))
  const canSave = d.day.trim() !== '' && d.title.trim() !== ''

  return (
    <div className="rounded-md border border-hair p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day">
          <input
            type="date"
            className={inputClass}
            value={d.day}
            onChange={(e) => patch({ day: e.target.value })}
            disabled={disabled}
          />
        </Field>
        <Field label="Time">
          <input
            type="time"
            className={inputClass}
            value={d.time}
            onChange={(e) => patch({ time: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Category">
          <select
            className={inputClass}
            value={d.category}
            onChange={(e) => patch({ category: e.target.value as ItinCategory })}
            disabled={disabled}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <input
            className={inputClass}
            value={d.location}
            placeholder="optional"
            onChange={(e) => patch({ location: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Title">
          <input
            className={inputClass}
            value={d.title}
            placeholder="e.g. Dinner at the clubhouse"
            onChange={(e) => patch({ title: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Detail">
          <input
            className={inputClass}
            value={d.detail}
            placeholder="optional"
            onChange={(e) => patch({ detail: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          tone="primary"
          disabled={disabled || busy || !canSave}
          onClick={() => void run('Item saved.', () => saveItinerary([toInput(d)]), onSaved)}
        >
          {busy ? 'Saving…' : d.id ? 'Save' : 'Add'}
        </Button>
        <span className="text-[0.75rem] text-paper-faint">
          {d.day ? formatDayLong(d.day) : 'No day set'}
        </span>
      </div>
      <Report report={report} />
    </div>
  )
}

/**
 * The itinerary editor. Online-only, like every /admin write. No delete this phase (Kyle,
 * 2026-08-24 — a small fixed set of rooms and dinners; edit in place).
 */
export function ItineraryEditor({
  items,
  defaultDay,
  disabled,
}: {
  items: ItineraryItemRow[]
  defaultDay: string
  disabled: boolean
}) {
  // Local keys for added-but-unsaved rows only. Saved rows live in `items` (props).
  const [newKeys, setNewKeys] = useState<number[]>([])
  const [seq, setSeq] = useState(0)
  const maxSort = items.reduce((m, r) => Math.max(m, r.sort_order), 0)

  return (
    <Section title="Itinerary" meta={`${items.length} item${items.length === 1 ? '' : 's'}`}>
      <p className="mt-2 text-[0.82rem] leading-relaxed text-paper-faint">
        Times are Eastern. Leave the time blank for an all-day item. Ordering within a day is by
        time, then the order added.
      </p>

      <div className="mt-4 space-y-4">
        {items.map((row) => (
          <ItineraryCard key={row.id} initial={draftFromRow(row)} disabled={disabled} />
        ))}
        {newKeys.map((k, i) => (
          <ItineraryCard
            key={`new-${k}`}
            disabled={disabled}
            initial={{
              id: null,
              day: defaultDay,
              time: '',
              category: 'other',
              title: '',
              location: '',
              detail: '',
              sortOrder: maxSort + 1 + i,
            }}
            onSaved={() => setNewKeys((ks) => ks.filter((x) => x !== k))}
          />
        ))}
      </div>

      <div className="mt-4">
        <Button
          disabled={disabled}
          onClick={() => {
            setNewKeys((ks) => [...ks, seq])
            setSeq((s) => s + 1)
          }}
        >
          + Add item
        </Button>
      </div>
    </Section>
  )
}
