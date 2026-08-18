/**
 * Position-change indicator for the standings. `change` is previousPosition − position:
 * positive = climbed, negative = dropped, 0 = held, null = no prior counting round.
 */
export function Movement({ change }: { change: number | null }) {
  if (change === null) {
    return <span className="text-paper-faint" aria-label="new" title="No prior round">·</span>
  }
  if (change === 0) {
    return (
      <span className="text-paper-faint" aria-label="no change" title="Held position">
        –
      </span>
    )
  }
  const up = change > 0
  return (
    <span
      className={`tnum inline-flex items-center gap-0.5 ${up ? 'text-olive' : 'text-gold'}`}
      aria-label={up ? `up ${change}` : `down ${-change}`}
      title={up ? `Up ${change}` : `Down ${-change}`}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {Math.abs(change)}
    </span>
  )
}
