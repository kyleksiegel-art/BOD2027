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
      <nav
        className="mt-5 -mx-1 flex gap-1 overflow-x-auto border-b border-hair pb-3"
        aria-label="Info sections"
      >
        {INFO_SUBNAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `tap flex items-center whitespace-nowrap rounded-full px-4 text-[0.82rem] font-semibold transition-colors ${
                isActive
                  ? 'bg-ground-2 text-gold'
                  : 'text-paper-faint hover:text-paper-dim'
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
