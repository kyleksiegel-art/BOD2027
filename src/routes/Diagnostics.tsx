import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { PinGate } from '@/components/PinGate'
import { Button } from '@/components/admin/kit'
import { db } from '@/lib/db'
import { clientId } from '@/lib/clientId'
import { useSession } from '@/lib/auth/session'
import { lastSyncAt, retryDeadLetter } from '@/lib/sync/outbox'
import { useSyncSnapshot } from '@/lib/sync/engine'
import { readLastCrash, clearLastCrash } from '@/lib/crash'
import { getReachability, subscribeReachability } from '@/lib/sync/reachability'
import { formatDay } from '@/lib/format'
import type { DeadLetterEntry, OutboxEntry } from '@/lib/data/types'

/**
 * Diagnostics (brief §Diagnostics). The one screen for when something has already gone
 * wrong: what this device is, what it still owes the server, and what the server refused.
 *
 * It is gated by the PIN (it exposes the sync internals) but NOT by a connection — the whole
 * point is to read the local queue when there is no signal. The PIN gate itself unlocks
 * offline (Phase 6b), so this is reachable in a dead zone.
 *
 * Nothing here is a mirror of a server table; it is all local sync bookkeeping. "Copy state
 * as JSON" assembles a redacted snapshot (never the session token) to paste into a message.
 */
export default function Diagnostics() {
  const session = useSession()
  const snapshot = useSyncSnapshot()
  const reach = useSyncExternalStore(subscribeReachability, getReachability, getReachability)
  const lastSync = useLiveQuery(() => lastSyncAt(), [], null)
  const outbox = useLiveQuery(() => db.outbox.orderBy('seq').toArray(), [], [])
  const dead = useLiveQuery(() => db.dead_letter.orderBy('failed_at').toArray(), [], [])
  const lastCrash = useLiveQuery(() => readLastCrash(), [], null)
  const [copied, setCopied] = useState(false)

  if (session === undefined) {
    return (
      <Page>
        <PageHeader eyebrow="Diagnostics" title="Diagnostics" />
        <p className="mt-6 text-paper-dim">Loading…</p>
      </Page>
    )
  }

  if (!session.unlocked) {
    return (
      <Page>
        <PageHeader eyebrow="PIN Required" title="Diagnostics" />
        <div className="mt-6">
          <PinGate purpose="Diagnostics shows this device's sync queue and identifiers. It's gated the same as admin, but works with no signal." />
        </div>
      </Page>
    )
  }

  function snapshotJson(): string {
    return JSON.stringify(
      {
        client_id: clientId(),
        session: {
          unlocked: session?.unlocked,
          offline: session?.offline,
          expires_at: session?.expiresAt,
          unlocked_at: session?.unlockedAt,
          // The token itself is deliberately omitted — this text gets pasted into chats.
        },
        reachability: reach,
        last_sync_at: lastSync,
        pending: snapshot.pending,
        dead_letter: snapshot.deadLetter,
        outbox,
        dead_letter_items: dead,
        last_crash: lastCrash,
        captured_at: new Date().toISOString(),
      },
      null,
      2,
    )
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Diagnostics"
        title="Diagnostics"
        meta={session.offline ? 'Unlocked offline' : 'Unlocked'}
      />

      <Section title="This device">
        <Row label="Client ID" value={clientId()} mono />
        <Row
          label="Session"
          value={
            session.offline
              ? 'Local (offline) — no server token'
              : 'Server token held'
          }
        />
        <Row label="Session expires" value={session.expiresAt ? formatDay(session.expiresAt) : '—'} />
        <Row label="Reachability" value={reach} />
        <Row label="Last successful sync" value={lastSync ? new Date(lastSync).toLocaleString() : 'never'} />
      </Section>

      <Section title={`Outbox — ${snapshot.pending} waiting`}>
        {outbox.length === 0 ? (
          <p className="text-[0.85rem] text-paper-dim">Nothing queued. Everything here is on the server.</p>
        ) : (
          <ul className="space-y-2">
            {outbox.map((e) => (
              <QueueItem key={e.seq} entry={e} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Dead letter — ${snapshot.deadLetter} stuck`}>
        {dead.length === 0 ? (
          <p className="text-[0.85rem] text-paper-dim">
            Nothing stuck. Items land here only if the server refused them or a retry budget ran out.
          </p>
        ) : (
          <ul className="space-y-2">
            {dead.map((item) => (
              <DeadItem key={item.id} item={item} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={lastCrash ? 'Last crash' : 'Last crash — none'}>
        {lastCrash ? (
          <>
            <Row label="When" value={new Date(lastCrash.at).toLocaleString()} />
            <Row label="Where" value={lastCrash.route || '—'} mono />
            <Row label="Scope" value={lastCrash.scope === 'shell' ? 'Whole app' : 'One screen'} />
            <Row label="Error" value={lastCrash.message} mono />
            {lastCrash.stack ? (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-hair bg-ground p-2 font-mono text-[0.68rem] leading-snug text-paper-dim">
                {lastCrash.stack}
              </pre>
            ) : null}
            <div className="mt-3">
              <Button onClick={() => void clearLastCrash()}>Clear</Button>
            </div>
          </>
        ) : (
          <p className="text-[0.85rem] text-paper-dim">
            No screen has crashed on this phone. If one does, it is recorded here and included in the JSON below.
          </p>
        )}
      </Section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(snapshotJson())
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? 'Copied' : 'Copy state as JSON'}
        </Button>
      </div>
    </Page>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 rounded-lg border border-hair bg-ground-2 p-4">
      <h3 className="font-display text-lg text-paper">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hair py-1.5 last:border-0">
      <span className="text-[0.78rem] uppercase tracking-[0.12em] text-paper-faint">{label}</span>
      <span className={`text-right text-[0.85rem] text-paper ${mono ? 'font-mono text-[0.72rem] break-all' : 'tnum'}`}>
        {value}
      </span>
    </div>
  )
}

function describeKey(entry: OutboxEntry | DeadLetterEntry): string {
  return `${entry.kind} · ${entry.key.split('|').slice(1).join(' / ')}`
}

function QueueItem({ entry }: { entry: OutboxEntry }) {
  return (
    <li className="rounded-md border border-hair p-2 text-[0.8rem]">
      <div className="flex justify-between">
        <span className="text-paper">{describeKey(entry)}</span>
        <span className="text-paper-faint tnum">#{entry.seq}</span>
      </div>
      <div className="mt-1 text-paper-faint tnum">
        {entry.attempts > 0 ? `${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'} · ` : ''}
        {new Date(entry.ts).toLocaleTimeString()}
        {entry.last_error ? ` · ${entry.last_error}` : ''}
      </div>
    </li>
  )
}

function DeadItem({ item }: { item: DeadLetterEntry }) {
  const [busy, setBusy] = useState(false)
  return (
    <li className="rounded-md border border-gold/40 bg-gold/5 p-2 text-[0.8rem]">
      <div className="flex justify-between">
        <span className="text-paper">{describeKey(item)}</span>
        <span className="text-gold-bright">{item.reason}</span>
      </div>
      <div className="mt-1 text-paper-faint">
        {item.last_error} · failed {new Date(item.failed_at).toLocaleString()} · {item.attempts} attempts
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void retryDeadLetter(item.id).finally(() => setBusy(false))
          }}
        >
          {busy ? 'Retrying…' : 'Retry'}
        </Button>
        <Button onClick={() => void navigator.clipboard?.writeText(JSON.stringify(item, null, 2))}>
          Export JSON
        </Button>
      </div>
    </li>
  )
}
