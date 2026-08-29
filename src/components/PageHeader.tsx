import type { ReactNode } from 'react'

/** The annual-report page masthead: spaced gold eyebrow over a Fraunces display title. */
export function PageHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string
  title: string
  meta?: ReactNode
}) {
  return (
    <header>
      <span className="eyebrow block">{eyebrow}</span>
      <h1 className="fx-head mt-3 font-display text-4xl font-semibold tracking-tight text-paper">{title}</h1>
      {meta ? <div className="mt-2 text-[0.9rem] text-paper-dim">{meta}</div> : null}
      <hr className="mt-5 border-hair" />
    </header>
  )
}
