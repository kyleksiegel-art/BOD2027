import { useLayoutEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { TABS } from '@/config/nav'

/** Persistent bottom tab bar — the primary navigation for one-handed cart use. */
export function BottomTabBar() {
  // Publish the bar's height (safe-area padding included) as --tabbar-h, so anything pinned
  // to the bottom of a page — Enter's Save bar — sits just above it instead of under it.
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--tabbar-h', `${el.offsetHeight}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <nav
      ref={ref}
      className="sticky bottom-0 z-20 border-t border-hair bg-ground/95 backdrop-blur-sm"
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
