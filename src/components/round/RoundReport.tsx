import { useEffect, useRef, useState } from 'react'
import type { ReportVM } from '@/lib/data/report'
import { courseSlug } from '@/lib/format'
import { canShareFiles, renderRecapImage, SHARE_EXCLUDE_ATTR } from '@/lib/share/recapImage'

/**
 * The round report — an addition under the recap card once a round is final. A short written
 * account, not a second scoreboard: no masthead, no results table (the recap has both), just
 * the round's story in a few plain paragraphs. Shares as an image through the same rasteriser
 * the recap uses; the footer is excluded from the picture.
 *
 * Collapsible (Kyle 2026-09-06): the header — eyebrow, headline, day — is the tap target and
 * stays visible; the paragraphs and Share fold. Open by default only for the latest counting
 * round, so an older round's page gets to its scorecard without a long scroll.
 */
export function RoundReport({ vm }: { vm: ReportVM }) {
  const slug = courseSlug(vm.courseName) ?? undefined
  const ref = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(vm.latest)

  return (
    <section
      ref={ref}
      className="round mt-7 overflow-hidden rounded border border-hair-strong bg-ground-2 shadow-[0_6px_22px_rgba(27,30,28,0.08)]"
      data-course={slug}
      aria-labelledby={`report-r${vm.roundNumber}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`report-body-r${vm.roundNumber}`}
        className="tap block w-full px-[18px] pb-3.5 pt-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="round-swatch h-2 w-2 flex-none rounded-full" aria-hidden />
          <span className="text-[0.64rem] font-semibold uppercase tracking-[0.2em] text-gold">Round report</span>
          <span className="tnum ml-auto text-[0.66rem] uppercase tracking-[0.14em] text-paper-faint">{vm.dayLabel}</span>
        </div>
        <div className="mt-3.5 flex items-start gap-3">
          <h2 id={`report-r${vm.roundNumber}`} className="fx-title flex-1 font-display text-[1.5rem] font-semibold leading-[1.2] text-paper">
            {vm.headline}
          </h2>
          <span className="mt-1 text-[1.1rem] leading-none text-paper-faint" aria-hidden>
            {open ? '−' : '+'}
          </span>
        </div>
      </button>

      {open && (
        <div id={`report-body-r${vm.roundNumber}`}>
          <hr className="mx-[18px] border-hair" />
          <div className="px-[18px] pb-1 pt-3.5">
            <div
              className="flex flex-col gap-3 font-display text-[1.02rem] leading-normal text-paper-dim"
              style={{ fontVariationSettings: "'opsz' 36, 'wght' 450" }}
            >
              {vm.paragraphs.map((p, i) => (
                <p key={i}>
                  {p.map((seg, j) =>
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
            <div className="mt-[18px] flex items-end justify-between">
              <span className="tnum text-[0.66rem] uppercase tracking-[0.14em] text-paper-faint">{vm.dateline}</span>
              <Seal />
            </div>
          </div>

          {/* The share button mounts only while open, so its pre-render sees the whole card. */}
          <div className="mt-3 flex items-center gap-2.5 border-t border-hair bg-ground px-[18px] py-2.5" {...{ [SHARE_EXCLUDE_ATTR]: '' }}>
            <span className="tnum text-[0.72rem] text-paper-faint">Written on-device from the round's scores</span>
            <ShareReportButton vm={vm} cardRef={ref} />
          </div>
        </div>
      )}
    </section>
  )
}

/** The trip mark — visual treatment only; the copy stays plain. */
function Seal() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="var(--gold)" strokeWidth="1.25" aria-hidden>
      <circle cx="22" cy="22" r="20" />
      <circle cx="22" cy="22" r="15" />
      <path d="M14 27 L22 13 L30 27 Z" />
      <path d="M14 27 h16" />
    </svg>
  )
}

function ShareReportButton({ vm, cardRef }: { vm: ReportVM; cardRef: React.RefObject<HTMLElement> }) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const [image, setImage] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const filename = `${courseSlug(vm.courseName) ?? 'round'}-r${vm.roundNumber}-report.png`
  const title = `${vm.courseName} — round report`

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
    navigator.share({ title, text: vm.paragraphs.map((p) => p.map((s) => s.text).join('')).join('\n\n') })
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
