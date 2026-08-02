/** Minimal stub for an Info sub-page. Rendered inside InfoLayout's Outlet. */
export function InfoStub({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-paper">{title}</h2>
      <p className="mt-3 max-w-prose text-paper-dim">
        Scaffolded and reachable. Built in{' '}
        <span className="text-gold">{phase}</span>.
      </p>
    </div>
  )
}
