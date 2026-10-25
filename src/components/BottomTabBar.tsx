import { NavLink } from 'react-router-dom'
import { TABS } from '@/config/nav'
import { usePublishedHeight } from '@/hooks/usePublishedHeight'

/**
 * Persistent bottom tab bar — the primary navigation for one-handed cart use. Fixed to the
 * screen, not sticky: see Layout. Its height is published as --tabbar-h, which the shell
 * reserves at the bottom and Enter's Save bar sits on top of.
 */
export function BottomTabBar() {
  const ref = usePublishedHeight<HTMLElement>('--tabbar-h')

  return (
    <nav
      ref={ref}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-hair bg-ground/95 backdrop-blur-sm"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-[720px]">
        {TABS.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              // Home is "/", which every route starts with; without `end` it would light up everywhere.
              end={to === '/'}
              className={({ isActive }) =>
                `tap flex flex-col items-center justify-center gap-1 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] transition-colors ${
                  isActive ? 'text-gold' : 'text-paper-dim'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-6 w-6" style={{ opacity: isActive ? 1 : 0.95 }} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
