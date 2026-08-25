// Shared pieces for the /admin editors: one place for the field styling, the section
// chrome, and the run-an-action-and-report-what-happened hook.
//
// Admin is the one place in the app where a save can fail for reasons the person needs to
// read and act on — "18 holes have no par", "Adam is missing 6 holes". So every action
// reports back a list of lines rather than a spinner and a shrug.
import { useCallback, useState, type ReactNode } from 'react'
import { AdminError, type CheckedResult } from '@/lib/data/admin'

export const inputClass =
  'tap w-full rounded-md border border-hair-strong bg-ground px-3 py-2 text-paper tnum ' +
  'placeholder:text-paper-faint focus:border-gold focus:outline-none disabled:opacity-40'

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="block">
      <span className="block text-[0.72rem] uppercase tracking-[0.14em] text-paper-faint">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-[0.75rem] text-paper-faint">{hint}</span> : null}
    </label>
  )
}

export function Section({
  title,
  meta,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
  /** When true the header toggles the body open/closed; meta stays visible either way. */
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const showBody = !collapsible || open

  return (
    <section className="mt-4 rounded-lg border border-hair bg-ground-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="tap flex flex-1 items-baseline gap-2 text-left"
          >
            <span aria-hidden className="text-gold-bright">
              {open ? '▾' : '▸'}
            </span>
            <h3 className="font-display text-xl text-paper">{title}</h3>
          </button>
        ) : (
          <h3 className="font-display text-xl text-paper">{title}</h3>
        )}
        {meta ? <div className="text-[0.78rem] text-paper-dim tnum">{meta}</div> : null}
      </div>
      {showBody ? children : null}
    </section>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  tone = 'quiet',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'primary' | 'quiet' | 'danger'
}) {
  const styles =
    tone === 'primary'
      ? 'bg-gold-fill text-paper font-semibold'
      : tone === 'danger'
        ? 'border border-hair-strong text-gold-bright'
        : 'border border-hair-strong text-paper'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`tap rounded-md px-4 py-2 text-[0.9rem] disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  )
}

export interface ActionReport {
  tone: 'ok' | 'bad'
  lines: string[]
}

export function Report({ report }: { report: ActionReport | null }) {
  if (!report) return null
  return (
    <ul
      role="status"
      aria-live="polite"
      className={`mt-3 space-y-1 text-[0.85rem] leading-relaxed ${
        report.tone === 'ok' ? 'text-paper-dim' : 'text-gold-bright'
      }`}
    >
      {report.lines.map((line, i) => (
        <li key={`${i}-${line}`}>· {line}</li>
      ))}
    </ul>
  )
}

function isCheckedResult(v: unknown): v is CheckedResult {
  return typeof v === 'object' && v !== null && 'ok' in v && 'errors' in v
}

/**
 * Run one admin action and turn whatever comes back into something readable.
 *
 * Three outcomes are genuinely different and are kept different: it worked; the server
 * refused and said why (a `CheckedResult`, e.g. an incomplete card); or the call never
 * landed (locked session, no signal). Collapsing them into "Error" is how you end up
 * re-typing a scorecard because nobody realised the PIN had expired.
 */
export function useAdminAction() {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ActionReport | null>(null)

  const run = useCallback(
    async (successLine: string, fn: () => Promise<unknown>, onSuccess?: () => void) => {
    setBusy(true)
    setReport(null)
    try {
      const result = await fn()
      if (isCheckedResult(result) && !result.ok) {
        setReport({ tone: 'bad', lines: result.errors.length ? result.errors : ['Refused.'] })
      } else {
        setReport({ tone: 'ok', lines: [successLine] })
        onSuccess?.()
      }
    } catch (e) {
      setReport({
        tone: 'bad',
        lines: [e instanceof AdminError ? e.message : ((e as Error)?.message ?? 'Could not save.')],
      })
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, report, run }
}

/** Parse a number field, treating a blank as null rather than 0. */
export function num(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
