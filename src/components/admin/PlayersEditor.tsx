import { useState } from 'react'
import { savePlayer } from '@/lib/data/admin'
import type { PlayerRow } from '@/lib/data/types'
import { Button, Field, Report, Section, inputClass, num, useAdminAction } from './kit'
import { formatDay } from '@/lib/format'

/**
 * Players and their indexes.
 *
 * The index is read live everywhere it matters: scoring pulls each player's current index
 * (plus the round's tee) rather than a per-round snapshot, so changing it here moves the
 * numbers on every non-finalized round at once. No re-snapshot step, nothing to keep in sync.
 */
function PlayerCard({ player, disabled }: { player: PlayerRow; disabled: boolean }) {
  const { busy, report, run } = useAdminAction()
  const [name, setName] = useState(player.name)
  const [title, setTitle] = useState(player.title ?? '')
  const [index, setIndex] = useState(String(player.handicap_index))
  const [assigned, setAssigned] = useState(player.index_is_assigned)

  const parsedIndex = num(index)
  const valid = name.trim() !== '' && parsedIndex !== null

  return (
    <Section
      title={player.name}
      meta={`Index as of ${formatDay(player.index_updated_at)}`}
    >
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Name">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Title" hint="Optional — appears under the name on the Players page.">
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
            />
          </Field>
        </div>
        <Field label="Handicap index">
          <input
            className={inputClass}
            inputMode="decimal"
            value={index}
            onChange={(e) => setIndex(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Agreed index">
          <button
            type="button"
            onClick={() => setAssigned((a) => !a)}
            disabled={disabled}
            aria-pressed={assigned}
            className={`tap w-full rounded-md border px-3 py-2 text-[0.9rem] disabled:opacity-40 ${
              assigned ? 'border-gold bg-gold/15 text-paper' : 'border-hair-strong text-paper-dim'
            }`}
          >
            {assigned ? 'Agreed (no GHIN)' : 'Established'}
          </button>
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          tone="primary"
          disabled={disabled || busy || !valid}
          onClick={() =>
            void run('Saved.', () =>
              savePlayer({
                id: player.id,
                name: name.trim(),
                title: title.trim() === '' ? null : title.trim(),
                handicapIndex: parsedIndex!,
                indexIsAssigned: assigned,
                photoUrl: player.photo_url,
                sortOrder: player.sort_order,
              }),
            )
          }
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <Report report={report} />
    </Section>
  )
}

export function PlayersEditor({ players, disabled }: { players: PlayerRow[]; disabled: boolean }) {
  return (
    <>
      <p className="mt-4 text-[0.88rem] leading-relaxed text-paper-dim">
        A player's index applies live to every round in play — scoring reads it here plus the
        tee. Finalized rounds keep their frozen money.
      </p>
      {players.map((p) => (
        <PlayerCard key={p.id} player={p} disabled={disabled} />
      ))}
    </>
  )
}
