import { useEffect, useRef, useState } from 'react'
import type { AnnualReportVM } from '@/lib/data/annualReport'
import { canShareFiles, renderRecapImage, SHARE_EXCLUDE_ATTR } from '@/lib/share/recapImage'

/**
 * The Annual Report — the trip's capstone, shown at the top of Standings once the season is
 * complete. A written wrap of the whole trip: champion, final standings, each round's winner, a
 * handful of superlatives the scores imply, the settled money, and a short letter. Shares as an
 * image through the same rasteriser the recap and round report use; the footer is excluded from
 * the picture.
 *
 * Collapsible (same pattern as the round report): the header — seal, title, season — is the tap
 * target and stays visible; the body and Share fold. Open by default: it is the capstone, and the
 * whole reason someone opens Standings after the trip.
 */
export function AnnualReport({ vm }: { vm: AnnualReportVM }) {
  const ref = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(true)

  return (
    <section
      ref={ref}
      className="mb-8 overflow-hidden rounded border border-hair-strong bg-ground-2 shadow-[0_6px_22px_rgba(27,30,28,0.08)]"
      aria-labelledby="annual-report-title"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="annual-report-body"
        className="tap block w-full px-[18px] pb-4 pt-5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[0.64rem] font-semibold uppercase tracking-[0.2em] text-gold">Annual report</span>
          <span className="tnum ml-auto text-[0.66rem] uppercase tracking-[0.14em] text-paper-faint">{vm.dateLabel}</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Seal />
          <h2
            id="annual-report-title"
            className="fx-display flex-1 font-display text-[2rem] font-semibold leading-[1.02] text-paper"
          >
            {vm.headline}
          </h2>
          <span className="text-[1.1rem] leading-none text-paper-faint" aria-hidden>
            {open ? '−' : '+'}
          </span>
        </div>
      </button>

      {open && (
        <div id="annual-report-body">
          <hr className="mx-[18px] border-hair" />
          <div className="px-[18px] pb-1 pt-4">
            {/* Champion */}
            <div className="leader-row rounded px-3 py-3.5">
              <span className="eyebrow block">{vm.champion.shared ? 'Co-champions' : 'Champion'}</span>
              <div className="mt-1.5 flex items-baseline justify-between gap-3">
                <span className="fx-title font-display text-[1.7rem] font-semibold leading-none text-paper">{vm.champion.name}</span>
                <span className="tnum fx-title font-display text-[1.9rem] font-semibold leading-none text-gold-bright">{vm.champion.total}</span>
              </div>
              <div className="mt-2.5 flex items-center gap-2 border-t border-hair pt-2.5">
                <span className="tnum font-display text-[1.05rem] font-semibold text-gold">{vm.champion.winnings}</span>
                <span className="text-[0.78rem] text-paper-dim">— {vm.champion.winningsDetail}</span>
              </div>
            </div>

            {/* Final standings */}
            <div className="mt-6">
              <span className="eyebrow block">Final standings · all four rounds</span>
              <ol className="mt-2.5 overflow-hidden rounded border border-hair">
                {vm.standings.map((r) => (
                  <li
                    key={r.playerId}
                    className={`grid grid-cols-[1.6rem_1fr_auto_2.6rem] items-center gap-x-3 px-3.5 py-3 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-hair ${
                      r.position === 1 ? 'leader-row' : ''
                    }`}
                  >
                    <span className={`tnum font-display text-[1.05rem] font-semibold ${r.position === 1 ? 'text-gold' : 'text-paper-faint'}`}>
                      {r.tie ? 'T' : ''}{r.position}
                    </span>
                    <span className={`truncate text-[0.98rem] ${r.position === 1 ? 'font-semibold text-paper' : 'text-paper'}`}>{r.name}</span>
                    <span className="tnum text-[0.72rem] font-semibold uppercase tracking-[0.06em] text-paper-faint">
                      {r.position === 1 ? 'Leader' : `${r.gapToLeader} back`}
                    </span>
                    <span className="tnum fx-title text-right font-display text-[1.25rem] font-semibold text-paper">{r.total}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* The Numbers */}
            {vm.superlatives.length > 0 && (
              <div className="mt-6">
                <span className="eyebrow block">The numbers</span>
                <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                  {vm.superlatives.map((sup) => (
                    <div key={sup.key} className="flex flex-col gap-0.5 rounded border border-hair bg-ground p-3">
                      <span className="text-[0.64rem] font-semibold uppercase tracking-[0.1em] text-paper-faint">{sup.label}</span>
                      <span className="tnum fx-title font-display text-[1.5rem] font-semibold leading-none text-paper">{sup.value}</span>
                      <span className="text-[0.76rem] text-paper-dim">{sup.who} · {sup.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Round winners */}
            {vm.roundWinners.length > 0 && (
              <div className="mt-6">
                <span className="eyebrow block">Round winners</span>
                <div className="mt-2.5 flex flex-col gap-2">
                  {vm.roundWinners.map((w) => (
                    <div
                      key={w.roundNumber}
                      className="round grid grid-cols-[1fr_auto_2.4rem] items-center gap-x-3 rounded border border-hair bg-ground px-3.5 py-2.5"
                      data-course={w.slug ?? undefined}
                    >
                      <span className="round-rail flex items-center gap-2 pl-1 text-[0.9rem] text-paper">
                        <span className="font-medium">R{w.roundNumber} · {courseLabel(w.courseName)}</span>
                        <span className="text-paper-faint">{w.dayLabel}</span>
                      </span>
                      <span className="text-right text-[0.86rem] font-semibold text-paper">
                        {w.winnerNames.join(' & ')}
                        {w.onCountback && <span className="ml-1 text-[0.66rem] font-normal text-paper-faint">countback</span>}
                      </span>
                      <span className="tnum text-right text-[0.86rem] text-paper-dim">{w.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* The money */}
            <div className="mt-6">
              <span className="eyebrow block">The money · settled</span>
              <div className="mt-2.5 rounded border border-hair bg-ground px-4 pb-2 pt-3.5">
                <div className="flex items-baseline justify-between border-b border-hair pb-2.5">
                  <span className="text-[0.84rem] text-paper-dim">Total pot</span>
                  <span className="tnum fx-title font-display text-[1.25rem] font-semibold text-paper">{vm.money.totalPot}</span>
                </div>
                {vm.money.lines.map((line) => (
                  <div key={line.label} className="flex items-baseline justify-between py-2 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-hair/60">
                    <span className="text-[0.86rem] text-paper">{line.label}</span>
                    <span className="tnum text-[0.86rem] text-paper-dim">{line.amount}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-hair-strong py-2.5">
                  <span className="text-[0.76rem] font-semibold uppercase tracking-[0.04em] text-gold">
                    {vm.money.balanced ? '✓ Balanced — every dollar home' : 'Does not reconcile — check the purse'}
                  </span>
                  <span className="tnum font-display text-[0.95rem] font-semibold text-gold">{vm.money.balanceLabel}</span>
                </div>
              </div>
            </div>

            {/* The letter */}
            <div className="mt-7">
              <span className="eyebrow block">To the board</span>
              <div
                className="mt-3 flex flex-col gap-3 font-display text-[1.04rem] leading-[1.6] text-paper-dim"
                style={{ fontVariationSettings: "'opsz' 36, 'wght' 450" }}
              >
                {vm.letter.map((para, i) => (
                  <p key={i}>
                    {para.map((seg, j) =>
                      seg.strong ? (
                        <strong key={j} className="font-semibold text-paper">
                          {seg.text}
                        </strong>
                      ) : (
                        <span key={j}>{seg.text}</span>
                      ),
                    )}
                  </p>
                ))}
              </div>
              <div className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-paper-faint">
                — The Board of Directors
              </div>
            </div>
          </div>

          {/* The share button mounts only while open, so its pre-render sees the whole card. */}
          <div className="mt-5 flex items-center gap-2.5 border-t border-hair bg-ground px-[18px] py-2.5" {...{ [SHARE_EXCLUDE_ATTR]: '' }}>
            <span className="tnum text-[0.72rem] text-paper-faint">{vm.seasonLabel} · written on-device</span>
            <ShareAnnualButton vm={vm} cardRef={ref} />
          </div>
        </div>
      )}
    </section>
  )
}

/** "Streamsong Blue" → "Blue"; "Bone Valley" stays whole. */
function courseLabel(name: string): string {
  return name.replace(/^Streamsong\s+/i, '')
}

/** The trip mark — visual treatment only; the copy stays plain. */
function Seal() {
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" fill="none" stroke="var(--gold)" strokeWidth="1.25" aria-hidden className="flex-none">
      <circle cx="23" cy="23" r="21" />
      <circle cx="23" cy="23" r="16" strokeDasharray="1.5 2.5" strokeWidth="0.75" />
      <path d="M15 28 L23 14 L31 28 Z" />
      <path d="M15 28 h16" />
    </svg>
  )
}

function ShareAnnualButton({ vm, cardRef }: { vm: AnnualReportVM; cardRef: React.RefObject<HTMLElement> }) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const [image, setImage] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const filename = `bod-${vm.dateLabel.match(/\d{4}/)?.[0] ?? 'season'}-annual-report.png`
  const title = `${vm.seasonLabel} — annual report`

  // Pre-render after fonts settle so the file is ready inside the tap's gesture (iOS).
  useEffect(() => {
    if (!canShare) return
    let cancelled = false
    setImage(null)
    const el = cardRef.current
    if (!el) return
    const ready = typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve()
    void ready
      .then(() => renderRecapImage(el))
      .then((blob) => {
        if (!cancelled) setImage(new File([blob], filename, { type: 'image/png' }))
      })
      .catch(() => {
        /* the tap renders on demand, then falls back to text */
      })
    return () => {
      cancelled = true
    }
  }, [canShare, cardRef, vm, filename])

  if (!canShare) return null

  const shareText = () =>
    navigator.share({ title, text: vm.letter.map((p) => p.map((seg) => seg.text).join('')).join('\n\n') })
  const shareFile = (file: File) => (canShareFiles(file) ? navigator.share({ files: [file], title }) : shareText())

  const onShare = async () => {
    if (image) return void shareFile(image).catch(() => {})
    const el = cardRef.current
    if (!el) return void shareText().catch(() => {})
    setBusy(true)
    try {
      const blob = await renderRecapImage(el)
      const file = new File([blob], filename, { type: 'image/png' })
      setImage(file)
      await shareFile(file)
    } catch {
      /* dismissed or unsupported */
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onShare()}
      disabled={busy}
      className="tap ml-auto inline-flex items-center rounded border border-hair-strong px-3.5 text-[0.82rem] font-semibold text-paper disabled:opacity-60"
    >
      {busy ? 'Preparing…' : 'Share report ↗'}
    </button>
  )
}
