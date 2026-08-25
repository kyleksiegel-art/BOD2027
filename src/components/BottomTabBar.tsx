import { NavLink } from 'react-router-dom'
import { TABS } from '@/config/nav'

/** Persistent bottom tab bar — the primary navigation for one-handed cart use. */
export function BottomTabBar() {
  return (
    <nav
      className="sticky bottom-0 z-20 border-t border-hair bg-ground/95 backdrop-blur-sm"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-[720px]">
        {TABS.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
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
