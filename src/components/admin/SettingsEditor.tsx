import { useState } from 'react'
import { saveSetting } from '@/lib/data/admin'
import type { AdminSettingsVM } from '@/lib/data/compute'
import { Button, Field, Report, Section, inputClass, num, useAdminAction } from './kit'

/**
 * Scoring and money settings.
 *
 * Everything on this screen is RETROACTIVE (the brief): the points table, allowance and cap
 * are read by the scoring engine at compute time, so changing one here re-derives every
 * leaderboard on the trip the moment it saves. That is intended — it is how a mid-trip
 * "let's use 95%" works — but it is also why the server validates the shape of every value
 * rather than trusting this form, and why the note below says it out loud.
 *
 * The exception is handicaps themselves, which are snapshotted per round. Changing the
 * allowance here does NOT move a round that has already been set up until that round is
 * re-snapshotted.
 */
export function SettingsEditor({
  settings,
  disabled,
}: {
  settings: AdminSettingsVM
  disabled: boolean
}) {
  return (
    <>
      <p className="mt-4 text-[0.88rem] leading-relaxed text-paper-dim">
        The points table, allowance and cap are applied when scores are read, so a change
        here moves every leaderboard immediately — including finished rounds. Handicaps
        already snapshotted into a round do not move until that round is re-snapshotted.
      </p>
      <PointsTableCard settings={settings} disabled={disabled} />
      <HandicapCard settings={settings} disabled={disabled} />
      <PurseCard settings={settings} disabled={disabled} />
    </>
  )
}

const BANDS: { key: keyof AdminSettingsVM['pointsTable']; label: string }[] = [
  { key: 'threeOrMoreUnder', label: '3 or more under' },
  { key: 'twoUnder', label: '2 under' },
  { key: 'oneUnder', label: '1 under' },
  { key: 'level', label: 'Level' },
  { key: 'oneOver', label: '1 over' },
  { key: 'twoOrMoreOver', label: '2 or more over' },
]

function PointsTableCard({ settings, disabled }: { settings: AdminSettingsVM; disabled: boolean }) {
  const { busy, report, run } = useAdminAction()
  const [table, setTable] = useState<Record<string, string>>(() =>
    Object.fromEntries(BANDS.map((b) => [b.key, String(settings.pointsTable[b.key])])),
  )

  const parsed = Object.fromEntries(BANDS.map((b) => [b.key, num(table[b.key])]))
  const valid = BANDS.every((b) => parsed[b.key] !== null)

  return (
    <Section title="Points table" meta="Net score relative to par">
      <div className="mt-3 grid grid-cols-2 gap-3">
        {BANDS.map((b) => (
          <Field key={b.key} label={b.label}>
            <input
              className={inputClass}
              inputMode="numeric"
              value={table[b.key]}
              onChange={(e) => setTable((t) => ({ ...t, [b.key]: e.target.value }))}
              disabled={disabled}
            />
          </Field>
        ))}
      </div>
      <div className="mt-4">
        <Button
          tone="primary"
          disabled={disabled || busy || !valid}
          onClick={() => void run('Points table saved.', () => saveSetting('points_table', parsed))}
        >
          {busy ? 'Saving…' : 'Save points table'}
        </Button>
      </div>
      <Report report={report} />
    </Section>
  )
}

function HandicapCard({ settings, disabled }: { settings: AdminSettingsVM; disabled: boolean }) {
  const { busy, report, run } = useAdminAction()
  const [allowance, setAllowance] = useState(String(Math.round(settings.allowance * 100)))
  const [cap, setCap] = useState(String(settings.handicapCap))

  const pct = num(allowance)
  const capValue = num(cap)
  const valid = pct !== null && pct > 0 && pct <= 100 && capValue !== null

  return (
    <Section title="Handicap" meta="Applied when a round is snapshotted">
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Allowance %" hint="100 is full handicap; 95 is the WHS alternative.">
          <input
            className={inputClass}
            inputMode="numeric"
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Cap" hint="Applied last, after the allowance and after rounding.">
          <input
            className={inputClass}
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Button
          tone="primary"
          disabled={disabled || busy || !valid}
          onClick={() =>
            void run('Handicap settings saved.', async () => {
              await saveSetting('allowance', pct! / 100)
              await saveSetting('handicap_cap', capValue!)
            })
          }
        >
          {busy ? 'Saving…' : 'Save handicap settings'}
        </Button>
      </div>
      <Report report={report} />
    </Section>
  )
}

// Defaults match the trip's money sheet, used when a value hasn't been set yet.
const DEFAULT_BUY_IN_CENTS = 25000
const DEFAULT_FIRST_CENTS = 60000
const DEFAULT_SECOND_CENTS = 20000
const DEFAULT_ROUND_CENTS = 5000

function PurseCard({ settings, disabled }: { settings: AdminSettingsVM; disabled: boolean }) {
  const { busy, report, run } = useAdminAction()
  const a = settings.purseAmounts
  const dollars = (cents: number | undefined, fallback: number) => String((cents ?? fallback) / 100)
  const [buyIn, setBuyIn] = useState(dollars(a.buy_in_per_player_cents, DEFAULT_BUY_IN_CENTS))
  const [first, setFirst] = useState(dollars(a.champ_first_cents, DEFAULT_FIRST_CENTS))
  const [second, setSecond] = useState(dollars(a.champ_second_cents, DEFAULT_SECOND_CENTS))
  const [round, setRound] = useState(dollars(a.round_winner_cents, DEFAULT_ROUND_CENTS))

  const parsed = { buyIn: num(buyIn), first: num(first), second: num(second), round: num(round) }
  const valid = Object.values(parsed).every((v) => v !== null && v >= 0)

  return (
    <Section title="Money" meta="Buy-in and payouts">
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Buy-in / player ($)">
          <input className={inputClass} inputMode="decimal" value={buyIn}
            onChange={(e) => setBuyIn(e.target.value)} disabled={disabled} />
        </Field>
        <Field label="Round winner ($)" hint="Paid each counting round.">
          <input className={inputClass} inputMode="decimal" value={round}
            onChange={(e) => setRound(e.target.value)} disabled={disabled} />
        </Field>
        <Field label="1st overall ($)">
          <input className={inputClass} inputMode="decimal" value={first}
            onChange={(e) => setFirst(e.target.value)} disabled={disabled} />
        </Field>
        <Field label="2nd overall ($)">
          <input className={inputClass} inputMode="decimal" value={second}
            onChange={(e) => setSecond(e.target.value)} disabled={disabled} />
        </Field>
      </div>

      <div className="mt-4">
        <Button
          tone="primary"
          disabled={disabled || busy || !valid}
          onClick={() =>
            void run('Money settings saved.', () =>
              // Cents, always — dollars are a display unit.
              saveSetting('purse_amounts', {
                buy_in_per_player_cents: Math.round((parsed.buyIn ?? 0) * 100),
                champ_first_cents: Math.round((parsed.first ?? 0) * 100),
                champ_second_cents: Math.round((parsed.second ?? 0) * 100),
                round_winner_cents: Math.round((parsed.round ?? 0) * 100),
              }),
            )
          }
        >
          {busy ? 'Saving…' : 'Save money settings'}
        </Button>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-paper-faint">
          The Money page reconciles buy-ins against the payouts: 1st + 2nd + (round winner ×
          counting rounds) should equal the buy-in per man × players. Closest-to-pin is still
          entered for bragging rights but pays nothing.
        </p>
      </div>
      <Report report={report} />
    </Section>
  )
}
