import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useItinerary } from '@/lib/data/selectors'
import type { ItinCategory } from '@/lib/data/types'

const CATEGORY_LABEL: Record<ItinCategory, string> = {
  travel: 'Travel',
  golf: 'Golf',
  meal: 'Meal',
  lodging: 'Lodging',
  other: 'Other',
}

// A quiet color per category — enough to scan a day at a glance, never loud.
const CATEGORY_DOT: Record<ItinCategory, string> = {
  travel: 'bg-sky-400',
  golf: 'bg-gold-fill',
  meal: 'bg-amber-400',
  lodging: 'bg-violet-400',
  other: 'bg-paper-faint',
}

export default function Itinerary() {
  const itin = useItinerary()

  return (
    <Page>
      <PageHeader eyebrow="The Trip" title="Itinerary" meta="All times Eastern (ET)." />

      {!itin ? (
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      ) : itin.isEmpty ? (
        <p className="mt-8 text-paper-faint">No itinerary yet.</p>
      ) : (
        <div className="mt-6 space-y-8">
          {itin.days.map((day) => (
            <section key={day.day}>
              <div className="flex items-baseline gap-3">
                <h2 className="font-display text-[1.3rem] font-semibold text-paper">
                  {day.label}
                </h2>
                {day.isToday && (
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-gold">
                    Today
                  </span>
                )}
              </div>

              <ul className="mt-3">
                {day.entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex gap-3 border-b border-hair py-3 first:border-t first:border-t-hair-strong"
                  >
                    <span className="w-[4.5rem] flex-none pt-0.5 text-right">
                      <span className="tnum text-[0.82rem] text-paper-dim">
                        {e.time ?? '—'}
                      </span>
                    </span>
                    <span
                      className={`mt-1.5 h-2 w-2 flex-none rounded-full ${CATEGORY_DOT[e.category]}`}
                      aria-hidden
                    />
                    <span className="flex flex-1 flex-col">
                      <span className="text-[1.02rem] text-paper">{e.title}</span>
                      {e.location && (
                        <span className="text-[0.8rem] text-paper-dim">{e.location}</span>
                      )}
                      {e.detail && (
                        <span className="mt-0.5 text-[0.82rem] leading-relaxed text-paper-faint">
                          {e.detail}
                        </span>
                      )}
                      <span className="mt-1 text-[0.6rem] uppercase tracking-[0.12em] text-paper-faint">
                        {CATEGORY_LABEL[e.category]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
