import type { ComponentType, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

// Minimal 24×24 stroke icons — no icon dependency, no hover requirement.
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

function Money(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M12 2v20M17 5.5C17 3.6 14.8 2.5 12 2.5S7 3.6 7 5.5 9 8.5 12 9s5 1.4 5 3.5-2.2 3.5-5 3.5-5-1.1-5-3" />
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

/** The five persistent bottom tabs. Order is fixed. */
export const TABS: NavItem[] = [
  { to: '/standings', label: 'Standings', Icon: Standings },
  { to: '/rounds', label: 'Rounds', Icon: Rounds },
  { to: '/enter', label: 'Enter', Icon: Enter },
  { to: '/money', label: 'Money', Icon: Money },
  { to: '/info', label: 'Info', Icon: Info },
]

/** Info section sub-pages. Empty scaffolds until their build phase. */
export const INFO_SUBNAV: { to: string; label: string }[] = [
  { to: '/info/itinerary', label: 'Itinerary' },
  { to: '/info/courses', label: 'Courses' },
  { to: '/info/players', label: 'Players' },
  { to: '/info/rules', label: 'Rules' },
]
