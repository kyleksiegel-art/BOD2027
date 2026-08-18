import { useState } from 'react'
import {
  abandonRound,
  finalizeRound,
  resnapshotRound,
  saveRoundPlayers,
  setManualOverride,
  startRound,
  type RoundPlayerInput,
} from '@/lib/data/admin'
import type { AdminRoundVM, AdminSettingsVM } from '@/lib/data/compute'
import type { PlayerRow } from '@/lib/data/types'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDay, formatTeeTime } from '@/lib/format'
import { Button, Field, Report, Section, inputClass, num, useAdminAction } from './kit'

interface Assignment {
  teeId: string
  status: string
  /** Held as typed. "-" and "10." are legitimate mid-typing states a number would eat. */
  index: string
}

/**
 * Why an index is refused, or null if it is fine. The column is numeric(4,1) and the
 * server has no range check of its own, so a fat-fingered 108 for 10.8 would otherwise be
 * accepted and quietly hand someone 18 strokes.
 */
function indexError(raw: string): string | null {
  const n = num(raw)
  if (n === null) return 'it needs to be a number'
  if (n < -10 || n > 54) return 'it should be between -10 and 54'
  if (Math.round(n * 10) !== n * 10) return 'only one decimal place is stored'
  return null
}

/** True when the typed index is a valid number that differs from the player's trip index. */
function differsFromTrip(raw: string | undefined, trip: number | undefined): boolean {
  const n = num(raw ?? '')
  return n !== null && trip !== undefined && n !== trip
}

/**
 * Round setup and the round lifecycle.
 *
 * This is the pre-flight screen the brief asks for: before a round can start, every player
 * needs a tee, and a tee is what turns an index into strokes received. Without a
 * round_players row a device cannot compute a stroke allocation at all — offline least of
 * all — so the Enter screen refuses to score that player, and this is where that gets
 * fixed.
 *
 * The client sends INPUTS (index, allowance, cap, tee). The server owns the arithmetic, so
 * two phones can never disagree about who gets a stroke on the 7th.
 *
 * The index is editable HERE, per round, not just on the Players tab. Indexes get locked in
 * the week before the trip and tees get decided standing on the first tee, so the moment
 * that matters is this screen — type the number, pick the tee, and strokes recompute before
 * anyone hits a ball. What you type is what this round uses; it does NOT change the
 * player's trip-wide index (that is the Players tab), because a round's handicaps are a
 * snapshot and are deliberately not retroactive.
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

  // The player's trip-wide index — the default, and the thing a per-round index is
  // compared against so a divergence is visible rather than silent.
  const tripIndexOf = new Map(players.map((p) => [p.id, p.handicap_index]))

  // The form's own copy of the assignment, so the whole foursome saves in one request
  // rather than four. The index lives here as a string: a half-typed "-" or "10." is a
  // legitimate intermediate state that a number would swallow.
  const [assign, setAssign] = useState<Record<string, Assignment>>(() =>
    Object.fromEntries(
      vm.participants.map((p) => [
        p.playerId,
        {
          teeId: p.row?.tee_id ?? vm.tees[0]?.id ?? '',
          status: p.row?.status ?? 'playing',
          // Already saved for this round? That number wins — re-opening the screen must
          // not silently propose reverting to a trip index that has since moved.
          index: String(p.row?.index_used ?? tripIndexOf.get(p.playerId) ?? 0),
        },
      ]),
    ),
  )
  const [holesCounted, setHolesCounted] = useState('')
  const [confirmAbandon, setConfirmAbandon] = useState(false)

  const unassigned = vm.participants.filter((p) => p.row === null)
  const badIndexes = vm.participants.filter((p) => indexError(assign[p.playerId]?.index ?? '') !== null)
  const canSave =
    vm.tees.length > 0 &&
    vm.participants.every((p) => assign[p.playerId]?.teeId) &&
    badIndexes.length === 0

  function entries(): RoundPlayerInput[] {
    return vm.participants.map((p) => ({
      roundId: vm.round.id,
      playerId: p.playerId,
      teeId: assign[p.playerId].teeId,
      indexUsed: num(assign[p.playerId].index) ?? 0,
      allowanceUsed: settings.allowance,
      capUsed: settings.handicapCap,
      status: assign[p.playerId].status === 'did_not_play' ? 'did_not_play' : 'playing',
    }))
  }

  return (
    <Section
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

      {/* ── Tees and handicaps ─────────────────────────────────────────────── */}
      <div className="mt-4 space-y-3">
        {vm.participants.map((p) => (
          <div key={p.playerId} className="rounded-md border border-hair p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-paper">{p.name}</span>
              <span className="text-[0.75rem] text-paper-faint tnum">
                {p.row ? `${p.row.strokes_received} strokes` : 'not set'}
                {p.row?.cap_applied ? ' (capped)' : ''}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field
                label="Index"
                hint={
                  differsFromTrip(assign[p.playerId]?.index, tripIndexOf.get(p.playerId))
                    ? `Trip index is ${tripIndexOf.get(p.playerId)}`
                    : undefined
                }
              >
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={assign[p.playerId]?.index ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    setAssign((a) => ({
                      ...a,
                      [p.playerId]: { ...a[p.playerId], index: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Tee">
                <select
                  className={inputClass}
                  value={assign[p.playerId]?.teeId ?? ''}
                  disabled={disabled || vm.tees.length === 0}
                  onChange={(e) =>
                    setAssign((a) => ({
                      ...a,
                      [p.playerId]: { ...a[p.playerId], teeId: e.target.value },
                    }))
                  }
                >
                  {vm.tees.length === 0 ? <option value="">No tees on this course</option> : null}
                  {vm.tees.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  className={inputClass}
                  value={assign[p.playerId]?.status ?? 'playing'}
                  disabled={disabled}
                  onChange={(e) =>
                    setAssign((a) => ({
                      ...a,
                      [p.playerId]: { ...a[p.playerId], status: e.target.value },
                    }))
                  }
                >
                  <option value="playing">Playing</option>
                  <option value="did_not_play">Did not play</option>
                </select>
              </Field>
            </div>

            {p.row ? (
              <ManualOverride
                roundId={vm.round.id}
                playerId={p.playerId}
                computed={p.row.strokes_received}
                current={p.row.manual_override}
                disabled={disabled}
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Button
          tone="primary"
          disabled={disabled || setup.busy || !canSave}
          onClick={() =>
            void setup.run('Tees and handicaps saved.', () => saveRoundPlayers(entries()))
          }
        >
          {setup.busy ? 'Saving…' : 'Save tees & handicaps'}
        </Button>
        {badIndexes.length > 0 ? (
          <p className="mt-2 text-[0.82rem] text-gold-bright">
            Check the index for {badIndexes.map((p) => p.name).join(', ')} —{' '}
            {indexError(assign[badIndexes[0].playerId]?.index ?? '')}
          </p>
        ) : null}
        <p className="mt-2 text-[0.78rem] leading-relaxed text-paper-faint">
          Saved at {Math.round(settings.allowance * 100)}% allowance, cap{' '}
          {settings.handicapCap}. The server recomputes course handicap, playing handicap and
          strokes received from the tee — this form never sends them. The index here applies to
          this round only; the Players tab holds the trip-wide one.
        </p>
        <Report report={setup.report} />
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
            Money is frozen; re-snapshotting handicaps is blocked.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          {vm.round.status !== 'final' && vm.round.status !== 'abandoned' ? (
            <Button
              disabled={disabled || life.busy}
              onClick={() =>
                void life.run('Handicaps re-snapshotted from current indexes.', () =>
                  resnapshotRound(vm.round.id),
                )
              }
            >
              Re-snapshot handicaps
            </Button>
          ) : null}

          {vm.round.status !== 'abandoned' ? (
            confirmAbandon ? (
              <>
                <Button
                  tone="danger"
                  disabled={disabled || life.busy}
                  onClick={() => {
                    setConfirmAbandon(false)
                    void life.run('Round abandoned — it no longer counts for money.', () =>
                      abandonRound(vm.round.id),
                    )
                  }}
                >
                  Yes, abandon it
                </Button>
                <Button onClick={() => setConfirmAbandon(false)}>Cancel</Button>
              </>
            ) : (
              <Button tone="danger" disabled={disabled} onClick={() => setConfirmAbandon(true)}>
                Abandon round
              </Button>
            )
          ) : null}
        </div>

        <Report report={life.report} />
      </div>
    </Section>
  )
}

/**
 * The escape hatch when the computed allocation is wrong on the day. Kept next to the
 * computed number so it is always obvious what is being overridden and by how much;
 * clearing it hands the computed value back rather than freezing today's number in.
 */
function ManualOverride({
  roundId,
  playerId,
  computed,
  current,
  disabled,
}: {
  roundId: string
  playerId: string
  computed: number
  current: number | null
  disabled: boolean
}) {
  const { busy, report, run } = useAdminAction()
  const [value, setValue] = useState(current === null ? '' : String(current))

  return (
    <div className="mt-3 border-t border-hair pt-3">
      <Field
        label="Manual stroke override"
        hint={`Blank uses the computed ${computed}.`}
      >
        <div className="flex gap-2">
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder={String(computed)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={disabled}
          />
          <Button
            disabled={disabled || busy}
            onClick={() =>
              void run('Override saved.', () => setManualOverride(roundId, playerId, num(value)))
            }
          >
            {busy ? '…' : 'Set'}
          </Button>
        </div>
      </Field>
      <Report report={report} />
    </div>
  )
}
