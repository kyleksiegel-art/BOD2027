import type { ComponentType, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

// Minimal 24×24 stroke icons — no icon dependency, no hover requirement.
function Home(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
    </svg>
  )
}

function Standings(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  )
}

function Rounds(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M6 21V4M6 4h11l-2 3.5L17 11H6" />
    </svg>
  )
}

function Enter(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function Info(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v5M12 7.5h.01" />
    </svg>
  )
}

export interface NavItem {
  to: string
  label: string
  Icon: ComponentType<IconProps>
}

/**
 * The five persistent bottom tabs (Kyle 2026-10-10). Home took Money's slot — the live board
 * is the screen you look at most in a round, and the logo was its only way in. Enter stays
 * dead centre, under the thumb. Money is reached from the Standings board and Home's
 * end-of-trip panel.
 */
export const TABS: NavItem[] = [
  { to: '/', label: 'Home', Icon: Home },
  { to: '/standings', label: 'Standings', Icon: Standings },
  { to: '/enter', label: 'Enter', Icon: Enter },
  { to: '/rounds', label: 'Rounds', Icon: Rounds },
  { to: '/info', label: 'Info', Icon: Info },
]

/**
 * Info section sub-pages, most-used first (Kyle 2026-10-10): Players carries the week line,
 * strokes card and form; Games is needed on the first tee; Itinerary sits second to last (Kyle). The
 * Info bottom tab lands on the first entry (router index redirect).
 *
 * Admin is the odd one out: it is a top-level route (`/admin`), not an `/info/*` sub-page,
 * so tapping it leaves the Info section and lands on the PIN gate. It lives here only as a
 * discoverable entry point — there is deliberately no Admin bottom tab, since it is for
 * trip setup, not day-of use. It is PIN-gated regardless, so surfacing the link costs
 * nothing.
 */
export const INFO_SUBNAV: { to: string; label: string }[] = [
  { to: '/info/players', label: 'Players' },
  { to: '/info/side-games', label: 'Games' },
  { to: '/info/rules', label: 'Rules' },
  { to: '/info/courses', label: 'Courses' },
  { to: '/info/itinerary', label: 'Itinerary' },
  { to: '/admin', label: 'Admin' },
]
