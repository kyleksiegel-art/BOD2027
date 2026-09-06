import { Component, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Link, Outlet, useRouteError } from 'react-router-dom'
import { recordCrash, describeError } from '@/lib/crash'

/**
 * Two boundaries, one panel.
 *
 * - `RouteErrorPanel` is react-router's `errorElement` on a pathless route under `Layout`
 *   (router.tsx). A page that throws while rendering is replaced by this panel and the
 *   shell — top bar, tab bar — stays up, so the scorer taps another tab and carries on.
 * - `AppErrorBoundary` wraps the whole router (main.tsx) for a crash in the shell itself.
 *   No tab bar survives that, so the panel offers a reload and a plain link home.
 *
 * Either way the crash is written to Dexie (`crash.ts`) for Diagnostics. The panel says
 * what was NOT lost — saved scores are in Dexie and the outbox, unsaved holes are in the
 * draft table — because "did I just lose the back nine" is the only question in the cart.
 */
export function CrashPanel({
  message,
  scope,
  details,
}: {
  message: string
  scope: 'route' | 'shell'
  details: string | null
}) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-5 py-8">
      <span className="eyebrow block">Something broke</span>
      <h1 className="fx-title mt-2 font-display text-[1.6rem] font-semibold leading-tight text-paper">
        {scope === 'shell' ? 'The app hit an error.' : 'This screen hit an error.'}
      </h1>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-paper-dim">
        Nothing on this phone was lost: saved scores are stored here and will still sync, and any
        hole you were entering is kept. Reload to pick up where you were.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="tap inline-flex items-center rounded-md bg-gold-fill px-4 py-3 font-semibold text-paper"
        >
          Reload
        </button>
        {scope === 'shell' ? (
          <a
            href="/"
            className="tap inline-flex items-center rounded-md border border-hair-strong px-4 py-3 font-semibold text-paper"
          >
            Home
          </a>
        ) : (
          <Link
            to="/"
            className="tap inline-flex items-center rounded-md border border-hair-strong px-4 py-3 font-semibold text-paper"
          >
            Home
          </Link>
        )}
      </div>
      <details className="mt-6 rounded-md border border-hair bg-ground-2 p-3 text-[0.8rem] text-paper-dim">
        <summary className="tap cursor-pointer font-semibold text-paper">What happened</summary>
        <p className="mt-2 break-words font-mono text-[0.78rem] text-paper">{message}</p>
        {details ? (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.7rem] leading-snug">
            {details}
          </pre>
        ) : null}
        <p className="mt-2">
          This is saved under Diagnostics{' '}
          {scope === 'route' ? (
            <Link to="/diagnostics" className="underline underline-offset-2">
              (open)
            </Link>
          ) : null}
          .
        </p>
      </details>
    </div>
  )
}

/**
 * react-router errorElement. `scope="route"` on the pathless route: the page crashed, the
 * shell is still standing. `scope="shell"` on the root route: Layout itself threw, and
 * without this react-router paints its own "Unexpected Application Error!" page instead of
 * ours — the router's built-in boundary sits INSIDE AppErrorBoundary, so it catches first.
 */
export function RouteErrorPanel({ scope = 'route' }: { scope?: 'route' | 'shell' }) {
  const err = useRouteError()
  const { message, stack } = describeError(err)
  useEffect(() => {
    void recordCrash(err, scope)
  }, [err, scope])
  return <CrashPanel message={message} scope={scope} details={stack} />
}

/** The pathless route's element: nothing but an Outlet (and the dev-only crash trigger). */
export function RouteFrame() {
  return (
    <>
      <DevCrash where="route" />
      <Outlet />
    </>
  )
}

interface State {
  error: unknown | null
  componentStack: string | null
}

/**
 * Class boundary around the whole router — for anything the router's own boundary cannot
 * see (QueryProvider, RouterProvider itself). Belt and braces; the root-route errorElement
 * is what a Layout crash actually reaches.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null })
    void recordCrash(error, 'shell', info.componentStack)
  }

  render() {
    if (this.state.error !== null) {
      const { message, stack } = describeError(this.state.error)
      return (
        <CrashPanel
          message={message}
          scope="shell"
          details={[stack, this.state.componentStack].filter(Boolean).join('\n\n')}
        />
      )
    }
    return this.props.children
  }
}

/**
 * Dev-only crash trigger so both panels can be exercised in a browser: `?crash=route` or
 * `?crash=shell`. The export is chosen by the build-time constant, so in production
 * `DevCrash` is a component that renders null and `DevCrashImpl` is tree-shaken away —
 * gating only the throw left the string in the bundle.
 */
function DevCrashImpl({ where }: { where: 'route' | 'shell' }) {
  const [armed] = useState(() => new URLSearchParams(window.location.search).get('crash') === where)
  if (armed) throw new Error(`Deliberate ${where} crash (dev trigger)`)
  return null
}

function DevCrashNoop(_props: { where: 'route' | 'shell' }) {
  return null
}

export const DevCrash = import.meta.env.DEV ? DevCrashImpl : DevCrashNoop
