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

function PurseCard({ settings, disabled }: { settings: AdminSettingsVM; disabled: boolean }) {
  const { busy, report, run } = useAdminAction()
  const [mode, setMode] = useState(settings.purseMode)
  const [buyIn, setBuyIn] = useState(
    String((settings.purseAmounts.buy_in_per_player_cents ?? 0) / 100),
  )
  const [ch, setCh] = useState(String(Math.round(settings.purseWeights.championship * 100)))
  const [rw, setRw] = useState(String(Math.round(settings.purseWeights.roundWinners * 100)))
  const [ctp, setCtp] = useState(String(Math.round(settings.purseWeights.ctp * 100)))
  const fixed = settings.purseAmounts.fixed_cents ?? {}
  const [fCh, setFCh] = useState(String((fixed.championship ?? 0) / 100))
  const [fRw, setFRw] = useState(String((fixed.roundWinners ?? 0) / 100))
  const [fCtp, setFCtp] = useState(String((fixed.ctp ?? 0) / 100))

  const weights = { championship: num(ch), roundWinners: num(rw), ctp: num(ctp) }
  const weightsValid = Object.values(weights).every((v) => v !== null && v >= 0)
  const weightSum = weightsValid ? weights.championship! + weights.roundWinners! + weights.ctp! : 0

  return (
    <Section title="Purse" meta={mode === 'buyin' ? 'Buy-in' : 'Fixed pots'}>
      <div className="mt-3">
        <Field label="Mode">
          <select
            className={inputClass}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={disabled}
          >
            <option value="buyin">Buy-in per player</option>
            <option value="fixed">Fixed pot amounts</option>
          </select>
        </Field>
      </div>

      {mode === 'buyin' ? (
        <>
          <div className="mt-3">
            <Field label="Buy-in per player ($)">
              <input
                className={inputClass}
                inputMode="decimal"
                value={buyIn}
                onChange={(e) => setBuyIn(e.target.value)}
                disabled={disabled}
              />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="Champ %">
              <input className={inputClass} inputMode="numeric" value={ch}
                onChange={(e) => setCh(e.target.value)} disabled={disabled} />
            </Field>
            <Field label="Rounds %">
              <input className={inputClass} inputMode="numeric" value={rw}
                onChange={(e) => setRw(e.target.value)} disabled={disabled} />
            </Field>
            <Field label="CTP %">
              <input className={inputClass} inputMode="numeric" value={ctp}
                onChange={(e) => setCtp(e.target.value)} disabled={disabled} />
            </Field>
          </div>
          {weightsValid && weightSum !== 100 ? (
            <p className="mt-2 text-[0.8rem] text-gold-bright">
              The three add up to {weightSum}%, not 100. They are used as weights, so the
              pot is still fully allocated — but the numbers won't read as percentages.
            </p>
          ) : null}
        </>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="Champ $">
            <input className={inputClass} inputMode="decimal" value={fCh}
              onChange={(e) => setFCh(e.target.value)} disabled={disabled} />
          </Field>
          <Field label="Rounds $">
            <input className={inputClass} inputMode="decimal" value={fRw}
              onChange={(e) => setFRw(e.target.value)} disabled={disabled} />
          </Field>
          <Field label="CTP $">
            <input className={inputClass} inputMode="decimal" value={fCtp}
              onChange={(e) => setFCtp(e.target.value)} disabled={disabled} />
          </Field>
        </div>
      )}

      <div className="mt-4">
        <Button
          tone="primary"
          disabled={disabled || busy || (mode === 'buyin' && !weightsValid)}
          onClick={() =>
            void run('Purse settings saved.', async () => {
              await saveSetting('purse_mode', mode)
              if (mode === 'buyin') {
                await saveSetting('purse_weights', {
                  championship: weights.championship! / 100,
                  roundWinners: weights.roundWinners! / 100,
                  ctp: weights.ctp! / 100,
                })
              }
              // Cents, always — dollars are a display unit. Amounts for BOTH modes are kept
              // in one row so switching modes doesn't discard the other mode's figures.
              await saveSetting('purse_amounts', {
                buy_in_per_player_cents: Math.round((num(buyIn) ?? 0) * 100),
                fixed_cents: {
                  championship: Math.round((num(fCh) ?? 0) * 100),
                  roundWinners: Math.round((num(fRw) ?? 0) * 100),
                  ctp: Math.round((num(fCtp) ?? 0) * 100),
                },
              })
            })
          }
        >
          {busy ? 'Saving…' : 'Save purse'}
        </Button>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-paper-faint">
          Rounds already finalized keep the money frozen at the time they were finalized.
          This changes what future finalizations and the Money page derive.
        </p>
      </div>
      <Report report={report} />
    </Section>
  )
}
