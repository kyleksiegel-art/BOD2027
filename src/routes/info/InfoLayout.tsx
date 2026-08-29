import { NavLink, Outlet } from 'react-router-dom'
import { INFO_SUBNAV } from '@/config/nav'

/** Info section shell: a horizontal sub-nav strip above the routed sub-page. */
export default function InfoLayout() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-5 py-6">
      <span className="eyebrow block">The Trip</span>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-paper">
        Info
      </h1>
      {/* Text tabs spread edge-to-edge: all six fit on one line at any phone width,
          no wrapping and no horizontal scroll. Active is gold with a hairline underline. */}
      <nav
        className="mt-5 flex items-stretch justify-between border-b border-hair"
        aria-label="Info sections"
      >
        {INFO_SUBNAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-h-[44px] items-center whitespace-nowrap border-b-2 pb-1 text-[0.8rem] font-semibold transition-colors ${
                isActive
                  ? 'border-gold text-gold'
                  : 'border-transparent text-paper-faint hover:text-paper-dim'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="pt-6">
        <Outlet />
      </div>
    </div>
  )
}
