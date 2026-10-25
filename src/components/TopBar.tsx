import { Link } from 'react-router-dom'
import { ConnectionBadge } from './ConnectionBadge'
import { usePublishedHeight } from '@/hooks/usePublishedHeight'

/**
 * Persistent top bar: trip wordmark (→ Home) and the connection badge. Fixed to the screen, not
 * sticky (see Layout); its height is published as --topbar-h for the shell to reserve.
 */
export function TopBar() {
  const ref = usePublishedHeight<HTMLElement>('--topbar-h')

  return (
    <header ref={ref} className="fixed inset-x-0 top-0 z-20 border-b border-hair bg-ground/90 backdrop-blur-sm">
      <div
        className="mx-auto flex max-w-[720px] items-center justify-between px-4"
        style={{ paddingTop: 'max(0.6rem, env(safe-area-inset-top))' }}
      >
        <Link
          to="/"
          className="tap flex items-center py-2 font-display text-[1.05rem] font-semibold tracking-tight text-paper"
          aria-label="Board of Directors — Streamsong 2027, home"
        >
          BOD<span className="text-gold">·</span>27
        </Link>
        <ConnectionBadge />
      </div>
    </header>
  )
}
