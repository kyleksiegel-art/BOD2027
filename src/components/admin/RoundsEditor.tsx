import { useState } from 'react'
import {
  clearRoundScores,
  finalizeRound,
  saveRound,
  saveRoundPlayersQueued,
  startRound,
  type RoundPlayerInput,
} from '@/lib/data/admin'
import type { AdminRoundVM, AdminSettingsVM } from '@/lib/data/compute'
import type { PlayerRow } from '@/lib/data/types'
import { StatusBadge } from '@/components/StatusBadge'
import { composeEtTimestamp, etTimeInputValue, formatDay, formatTeeTime } from '@/lib/format'
import { Button, Field, Report, Section, inputClass, num, useAdminAction } from './kit'

/**
 * Round setup and the round lifecycle — deliberately small.
 *
 * The only per-player choice here is the TEE. A player's handicap index lives on the Players
 * tab and is read live, so there is nothing per-round to snapshot, no allowance/cap knob, no
 * override, and no re-snapshot: pick each player's tee, save, start the round, go. The server
 * still owns the arithmetic — the client sends the tee (plus the current index) and the RPC
 * computes course handicap, playing handicap and strokes received, so two phones can never
 * disagree about who gets a stroke on the 7th.
 *
 * A round_players row is still what lets a device score a player at all (offline included), so
 * "pick the tee and save" remains the gate before a round can start.
 */
export function RoundsEditor({
  rounds,
  players,
  settings,
  disabled,
}: {
  rounds: AdminRoundVM[]
  players: PlayerRow[]
  settings: AdminSettingsVM
  disabled: boolean
}) {
  return (
    <>
      {rounds.map((r) => (
        <RoundPanel
          key={r.round.id}
          vm={r}
          players={players}
          settings={settings}
          disabled={disabled}
        />
      ))}
    </>
  )
}

function RoundPanel({
  vm,
  players,
  settings,
  disabled,
}: {
  vm: AdminRoundVM
  players: PlayerRow[]
  settings: AdminSettingsVM
  disabled: boolean
}) {
  const setup = useAdminAction()
  const life = useAdminAction()
  const teeTime = useAdminAction()
  const [teeTimeValue, setTeeTimeValue] = useState(() => etTimeInputValue(vm.round.tee_time))

  // The player's live trip index — read straight off the Players tab, snapshotted into the
  // round only so the server can compute strokes. Nothing per-round to edit here.
  const tripIndexOf = new Map(players.map((p) => [p.id, p.handicap_index]))

  // The form holds one tee choice per player and saves the whole foursome in one request.
  const [teeById, setTeeById] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      vm.participants.map((p) => [p.playerId, p.row?.tee_id ?? vm.tees[0]?.id ?? '']),
    ),
  )
  const [holesCounted, setHolesCounted] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const unassigned = vm.participants.filter((p) => p.row === null)
  const canSave = vm.tees.length > 0 && vm.participants.every((p) => teeById[p.playerId])

  function entries(): RoundPlayerInput[] {
    return vm.participants.map((p) => ({
      roundId: vm.round.id,
      playerId: p.playerId,
      teeId: teeById[p.playerId],
      indexUsed: tripIndexOf.get(p.playerId) ?? 0,
      allowanceUsed: settings.allowance,
      capUsed: settings.handicapCap,
      status: 'playing',
      manualOverride: null,
    }))
  }

  return (
    <Section
      collapsible
      // Finished rounds tuck away; whatever's upcoming or in play stays open.
      defaultOpen={vm.round.status !== 'final'}
      title={`Round ${vm.round.round_number} — ${vm.course.name}`}
      meta={
        <span className="inline-flex items-center gap-2">
          {formatDay(vm.round.date)}
          {vm.round.tee_time ? ` · ${formatTeeTime(vm.round.tee_time)}` : ''}
          <StatusBadge status={vm.round.status} />
        </span>
      }
    >
      {unassigned.length > 0 ? (
        <p className="mt-3 rounded-md border border-gold/40 bg-gold/10 p-3 text-[0.85rem] leading-relaxed text-paper">
          <strong>No tee set</strong> for {unassigned.map((p) => p.name).join(', ')}. They cannot
          be scored in this round until this is saved.
        </p>
      ) : null}

      {/* ── Tees ───────────────────────────────────────────────────────────── */}
      <div className="mt-4 space-y-3">
        {vm.participants.map((p) => (
          <div
            key={p.playerId}
            className="flex items-center gap-3 rounded-md border border-hair p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-paper">{p.name}</div>
              <div className="text-[0.75rem] text-paper-faint tnum">
                index {tripIndexOf.get(p.playerId) ?? '—'}
                {p.row ? ` · ${p.row.strokes_received} strokes` : ''}
              </div>
            </div>
            <div className="w-40">
              <select
                aria-label={`Tee for ${p.name}`}
                className={inputClass}
                value={teeById[p.playerId] ?? ''}
                disabled={vm.tees.length === 0}
                onChange={(e) =>
                  setTeeById((t) => ({ ...t, [p.playerId]: e.target.value }))
                }
              >
                {vm.tees.length === 0 ? <option value="">No tees on this course</option> : null}
                {vm.tees.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Button
          tone="primary"
          disabled={setup.busy || !canSave}
          onClick={() => void setup.run('Tees saved.', () => saveRoundPlayersQueued(entries()))}
        >
          {setup.busy ? 'Saving…' : 'Save tees'}
        </Button>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-paper-faint">
          Strokes come from each player's index (Players tab) and the tee. Change an index there
          and it applies everywhere.{' '}
          <strong className="text-paper-dim">Tee changes queue like scores and work offline</strong>
          {' '}— strokes recompute on this phone straight away and sync when you have a connection.
        </p>
        <Report report={setup.report} />
      </div>

      {/* ── Tee time ───────────────────────────────────────────────────────── */}
      <div className="mt-5 border-t border-hair pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label="Tee time (ET)">
              <input
                type="time"
                aria-label={`Tee time for round ${vm.round.round_number}`}
                className={inputClass}
                value={teeTimeValue}
                onChange={(e) => setTeeTimeValue(e.target.value)}
                disabled={disabled}
              />
            </Field>
          </div>
          <Button
            disabled={disabled || teeTime.busy}
            onClick={() =>
              void teeTime.run('Tee time saved.', () =>
                saveRound({
                  id: vm.round.id,
                  roundNumber: vm.round.round_number,
                  date: vm.round.date,
                  courseId: vm.round.course_id,
                  teeTime: composeEtTimestamp(vm.round.date, teeTimeValue),
                }),
              )
            }
          >
            {teeTime.busy ? 'Saving…' : 'Save tee time'}
          </Button>
        </div>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-paper-faint">
          Rendered everywhere in Eastern time. Clear it to leave the round without a set time.
        </p>
        <Report report={teeTime.report} />
      </div>

      {/* ── Lifecycle ──────────────────────────────────────────────────────── */}
      <div className="mt-5 border-t border-hair pt-4">
        <span className="eyebrow block">Round status</span>

        <ul className="mt-2 space-y-1 text-[0.85rem] text-paper-dim tnum">
          {vm.participants
            .filter((p) => p.row?.status === 'playing')
            .map((p) => (
              <li key={p.playerId} className="flex justify-between">
                <span>{p.name}</span>
                <span>
                  thru {p.thru}
                  {p.missingHoles > 0 ? ` · ${p.missingHoles} to go` : ''}
                </span>
              </li>
            ))}
        </ul>

        {vm.round.status === 'upcoming' ? (
          <div className="mt-4">
            <Button
              disabled={disabled || life.busy}
              onClick={() => void life.run('Round started.', () => startRound(vm.round.id))}
            >
              {life.busy ? 'Starting…' : 'Start round'}
            </Button>
            {vm.startIssues.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[0.82rem] text-gold-bright">
                {vm.startIssues.map((i) => (
                  <li key={i}>· {i}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {vm.round.status === 'in_progress' ? (
          <div className="mt-4">
            <Field
              label="Holes counted"
              hint="Leave blank for a full 18. Set it only if the round was cut short — then only those holes need a score."
            >
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="18"
                value={holesCounted}
                onChange={(e) => setHolesCounted(e.target.value)}
                disabled={disabled}
              />
            </Field>
            <div className="mt-3">
              <Button
                tone="primary"
                disabled={disabled || life.busy}
                onClick={() =>
                  void life.run('Round final — money frozen.', () =>
                    finalizeRound(vm.round.id, num(holesCounted)),
                  )
                }
              >
                {life.busy ? 'Checking…' : 'Finalize round'}
              </Button>
            </div>
            <p className="mt-2 text-[0.78rem] leading-relaxed text-paper-faint">
              Finalizing freezes this round's money. Every playing player needs a score or a
              picked-up flag on every counted hole first.
            </p>
          </div>
        ) : null}

        {vm.round.status === 'final' ? (
          <p className="mt-4 text-[0.85rem] text-paper-dim">
            Final{vm.round.holes_counted !== null ? ` over ${vm.round.holes_counted} holes` : ''}.
            Money is frozen.
          </p>
        ) : null}

        {vm.round.status !== 'upcoming' ? (
          <div className="mt-4 border-t border-hair pt-4">
            <div className="flex flex-wrap gap-3">
              {confirmClear ? (
                <>
                  <Button
                    tone="danger"
                    disabled={disabled || life.busy}
                    onClick={() => {
                      setConfirmClear(false)
                      void life.run('Scores cleared — the round is live again.', () =>
                        clearRoundScores(vm.round.id),
                      )
                    }}
                  >
                    Yes, clear every score
                  </Button>
                  <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
                </>
              ) : (
                <Button tone="danger" disabled={disabled} onClick={() => setConfirmClear(true)}>
                  Clear scores
                </Button>
              )}
            </div>
            <p className="mt-2 text-[0.78rem] leading-relaxed text-paper-faint">
              Deletes every score and CTP result for this round and puts it back in progress so
              it can be re-entered. Tees and handicaps are kept. This cannot be undone.
            </p>
          </div>
        ) : null}

        <Report report={life.report} />
      </div>
    </Section>
  )
}
