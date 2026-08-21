import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { PinGate } from '@/components/PinGate'
import { PlayersEditor } from '@/components/admin/PlayersEditor'
import { CoursesEditor } from '@/components/admin/CoursesEditor'
import { RoundsEditor } from '@/components/admin/RoundsEditor'
import { SettingsEditor } from '@/components/admin/SettingsEditor'
import { Button, Report, useAdminAction } from '@/components/admin/kit'
import { useAdmin } from '@/lib/data/selectors'
import { useSession, lock } from '@/lib/auth/session'
import { exportAll } from '@/lib/data/admin'
import { scoresToCsv } from '@/lib/data/csv'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { formatDay } from '@/lib/format'

/**
 * /admin — everything that is NOT in the offline outbox.
 *
 * Two gates, and they are different on purpose:
 *
 *  1. The PIN. Score entry lost its PIN on 2026-08-17; this did not. Everything behind
 *     here rewrites the rules the scores are read through — a stroke index, an allowance,
 *     a handicap snapshot — and a wrong one is invisible until someone recomputes a
 *     leaderboard by hand.
 *
 *  2. A signal. These writes are direct RPCs with no outbox, so with no connection the
 *     screen says so plainly and disables the controls rather than pretending to queue.
 *     Queueing them would be worse than refusing: a course published or a round finalized
 *     from a stale local copy silently re-derives the trip.
 */

type Tab = 'rounds' | 'players' | 'courses' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'rounds', label: 'Rounds' },
  { id: 'players', label: 'Players' },
  { id: 'courses', label: 'Courses' },
  { id: 'settings', label: 'Settings' },
]

export default function Admin() {
  const session = useSession()
  const admin = useAdmin()
  const online = useOnlineStatus()
  const [tab, setTab] = useState<Tab>('rounds')

  if (session === undefined || admin === undefined) {
    return (
      <Page>
        <PageHeader eyebrow="PIN Required" title="Admin" />
        <p className="mt-6 text-paper-dim">Loading…</p>
      </Page>
    )
  }

  if (!session.unlocked) {
    return (
      <Page>
        <PageHeader eyebrow="PIN Required" title="Admin" />
        <div className="mt-6">
          <PinGate purpose="Admin changes rewrite the rules every score is read through — course cards, handicaps, the points table, the purse. Entering scores does not need this." />
        </div>
      </Page>
    )
  }

  const disabled = !online

  return (
    <Page>
      <PageHeader
        eyebrow="Unlocked"
        title="Admin"
        meta={
          session.expiresAt ? `Session runs to ${formatDay(session.expiresAt)}` : undefined
        }
      />

      {/* Online-only, said plainly. Not a toast — it stays up as long as it is true. The one
          exception is the day-of tee/handicap change, which queues like a score. */}
      {!online ? (
        <p className="mt-5 rounded-md border border-gold/40 bg-gold/10 p-3 text-[0.88rem] leading-relaxed text-paper">
          <strong>No connection.</strong> Most admin changes go straight to the server and will
          not save until you have a signal. The exception is <strong>Rounds → tees &amp;
          handicaps</strong>, which queues like scores do — set a tee at the first tee with no
          signal and it syncs later.
        </p>
      ) : null}

      <nav className="mt-5 grid grid-cols-4 gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={t.id === tab ? 'page' : undefined}
            className={`tap rounded-md border px-2 py-2 text-[0.82rem] ${
              t.id === tab ? 'border-gold bg-gold/15 text-paper' : 'border-hair text-paper-dim'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'rounds' ? (
        <RoundsEditor
          rounds={admin.rounds}
          players={admin.players}
          settings={admin.settings}
          disabled={disabled}
        />
      ) : null}
      {tab === 'players' ? <PlayersEditor players={admin.players} disabled={disabled} /> : null}
      {tab === 'courses' ? <CoursesEditor courses={admin.courses} disabled={disabled} /> : null}
      {tab === 'settings' ? <SettingsEditor settings={admin.settings} disabled={disabled} /> : null}

      <ExportPanel disabled={disabled} />

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-hair pt-4">
        <button
          type="button"
          onClick={() => void lock()}
          className="tap text-[0.85rem] text-paper-faint underline underline-offset-4"
        >
          Lock admin on this device
        </button>
        <Link
          to="/diagnostics"
          className="tap text-[0.85rem] text-paper-faint underline underline-offset-4"
        >
          Diagnostics &amp; sync queue
        </Link>
      </div>
    </Page>
  )
}

/**
 * "Export all scores" from the brief's Diagnostics list. Everything needed to reproduce any
 * number the app ever showed, in one request. Phase 6 adds the CSV shape and the rest of
 * the Diagnostics screen; this is the data, available now, because the moment it is worth
 * having is the moment something has already gone wrong.
 */
function ExportPanel({ disabled }: { disabled: boolean }) {
  const { busy, report, run } = useAdminAction()
  const [json, setJson] = useState<string | null>(null)
  const [csv, setCsv] = useState<string | null>(null)

  return (
    <section className="mt-8 rounded-lg border border-hair bg-black/20 p-4">
      <h3 className="font-display text-xl text-paper">Export</h3>
      <p className="mt-2 text-[0.85rem] leading-relaxed text-paper-dim">
        Every score, handicap snapshot, CTP result, frozen money row and setting — enough to
        reproduce any number in the app after the fact. JSON is the faithful dump; CSV is one
        row per entered score, names resolved, for a spreadsheet.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          disabled={disabled || busy}
          onClick={() =>
            void run('Exported.', async () => {
              const data = await exportAll()
              setJson(JSON.stringify(data, null, 2))
              setCsv(scoresToCsv(data as Parameters<typeof scoresToCsv>[0]))
            })
          }
        >
          {busy ? 'Exporting…' : 'Export all scores'}
        </Button>
        {json ? (
          <Button onClick={() => void navigator.clipboard?.writeText(json)}>Copy JSON</Button>
        ) : null}
        {csv ? (
          <Button onClick={() => void navigator.clipboard?.writeText(csv)}>Copy CSV</Button>
        ) : null}
      </div>
      <Report report={report} />
      {csv ? (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-hair bg-ground p-3 text-[0.7rem] leading-snug text-paper-dim">
          {csv.slice(0, 4000)}
          {csv.length > 4000 ? '\n…' : ''}
        </pre>
      ) : null}
    </section>
  )
}
