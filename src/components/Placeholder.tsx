import { Page } from './Page'

/**
 * Empty-but-honest scaffold page. Names the section and the phase that fills it
 * in, so a stub reads as "not built yet" rather than "broken." Removed as each
 * real screen lands.
 */
export function Placeholder({
  title,
  eyebrow = 'Board of Directors',
  phase,
}: {
  title: string
  eyebrow?: string
  phase: string
}) {
  return (
    <Page>
      <span className="eyebrow block">{eyebrow}</span>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-paper">
        {title}
      </h1>
      <hr className="mt-5 border-hair" />
      <p className="mt-5 max-w-prose text-paper-dim">
        This screen is scaffolded and reachable. It gets built in{' '}
        <span className="text-gold">{phase}</span>.
      </p>
    </Page>
  )
}
