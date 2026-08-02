import { useOnlineStatus } from '@/hooks/useOnlineStatus'

/**
 * Live connection badge — STUB. Shows link state from navigator.onLine.
 * Phase 6 wires it to a real reachability probe and sync state.
 */
export function ConnectionBadge() {
  const online = useOnlineStatus()

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-paper-faint"
      role="status"
      aria-live="polite"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-olive' : 'bg-gold'}`}
        aria-hidden
      />
      {online ? 'Online' : 'Offline'}
    </span>
  )
}
