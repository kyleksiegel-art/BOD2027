import { useEffect, useRef, useState } from 'react'
import type { StrokesCardVM } from '@/lib/data/strokesCard'
import { strokesCardFilename } from '@/lib/data/strokesCard'
import { canShareFiles, renderRecapImage } from '@/lib/share/recapImage'

/**
 * The strokes card — "how many do I get tomorrow, and where" — as a picture for Photos or the
 * lock screen. Lives in a player's opened row on the Players tab while a round is upcoming.
 *
 * The picture is rendered from real DOM (the same DOM → PNG path as the recap and reports), so
 * the two variants are laid out OFF-SCREEN, not hidden: `display:none` has no layout and
 * rasterises to nothing, a fixed element parked far left keeps its full width. Both are
 * pre-rendered after fonts settle so the file exists inside the tap's gesture (iOS only honours
 * `navigator.share` there, and rasterising on the tap can outlast it).
 */
export function NextRoundBlock({ vm }: { vm: StrokesCardVM }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const lockRef = useRef<HTMLDivElement>(null)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const holesLine =
    vm.strokeHoles.length === 0
      ? null
      : vm.strokeHoles.length <= 9
        ? `holes ${[...new Set(vm.strokeHoles)].join(' · ')}`
        : `${new Set(vm.strokeHoles).size} holes`

  return (
    <div
      className="round round-rail rounded border border-hair-strong bg-ground py-3.5 pl-4 pr-3.5"
      data-course={vm.courseSlug ?? undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow block">Next round</span>
        <span className="tnum shrink-0 text-[0.66rem] uppercase tracking-[0.1em] text-paper-faint">
          {vm.dayLabel}
          {vm.teeTime ? ` · ${vm.teeTime.replace(' ET', '')}` : ''}
        </span>
      </div>
      <div className="mt-2">
        <div className="min-w-0">
          <div className="fx-title font-display text-[1.3rem] leading-[1.15] text-paper">{vm.courseName}</div>
          <div className="tnum mt-1 text-[0.8rem] text-paper-dim">
            {vm.teeName} tees ·{' '}
            {vm.isLowMan ? (
              <>
                <strong className="font-semibold text-paper">plays scratch</strong>, the low man today
              </>
            ) : (
              <>
                <strong className="font-semibold text-gold-bright">
                  {vm.strokesToday} stroke{vm.strokesToday === 1 ? '' : 's'}
                </strong>
                {vm.lowMan ? `, off ${vm.lowMan.firstName}` : ''}
                {holesLine ? ` · ${holesLine}` : ''}
              </>
            )}
          </div>
        </div>
        {/* Two pictures of the same thing: one for Photos / the group chat, one shaped for the
            phone's lock screen. Hidden where the share sheet doesn't exist (desktop). */}
        {canShare && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ShareCardButton vm={vm} targetRef={cardRef} variant="card" label="Card" />
            <ShareCardButton vm={vm} targetRef={lockRef} variant="lockscreen" label="Lock screen" />
          </div>
        )}
      </div>

      {canShare && (
        <div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0" style={{ width: 540 }}>
          <div ref={cardRef} className="w-[540px] bg-ground p-8">
            <StrokesCardImage vm={vm} />
          </div>
          {/* Lock-screen: the phone's own aspect, the top and bottom left as plain ground for
              the iOS clock, widgets and the two corner buttons. */}
          <div ref={lockRef} className="flex h-[844px] w-[390px] flex-col bg-ground px-4">
            <div className="h-[200px] flex-none" />
            <StrokesCardImage vm={vm} compact />
            <div className="flex-1" />
            <div className="h-[70px] flex-none" />
          </div>
        </div>
      )}
    </div>
  )
}

function ShareCardButton({
  vm,
  targetRef,
  variant,
  label,
}: {
  vm: StrokesCardVM
  targetRef: React.RefObject<HTMLDivElement>
  variant: 'card' | 'lockscreen'
  label: string
}) {
  const [image, setImage] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const filename = strokesCardFilename(vm, variant)
  const title = `${vm.courseName} — ${vm.name.split(/\s+/)[0]}'s strokes`

  useEffect(() => {
    let cancelled = false
    setImage(null)
    const el = targetRef.current
    if (!el) return
    const ready = typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve()
    void ready
      .then(() => renderRecapImage(el))
      .then((blob) => {
        if (!cancelled) setImage(new File([blob], filename, { type: 'image/png' }))
      })
      .catch(() => {
        /* the tap renders on demand */
      })
    return () => {
      cancelled = true
    }
  }, [targetRef, vm, filename])

  const shareText = () =>
    navigator.share({
      title,
      text: vm.isLowMan
        ? `${vm.courseName}: ${vm.name} plays scratch today.`
        : `${vm.courseName}: ${vm.name} gets ${vm.strokesToday} strokes${vm.lowMan ? ` off ${vm.lowMan.firstName}` : ''}${
            vm.strokeHoles.length ? `, holes ${[...new Set(vm.strokeHoles)].join(', ')}` : ''
          }.`,
    })
  const shareFile = (file: File) => (canShareFiles(file) ? navigator.share({ files: [file], title }) : shareText())

  const onShare = async () => {
    if (image) return void shareFile(image).catch(() => {})
    const el = targetRef.current
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
      className="tap inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded border border-hair-strong px-3 text-[0.74rem] font-semibold uppercase tracking-[0.08em] text-paper disabled:opacity-60"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none">
        <path d="M12 3v12" />
        <path d="M8 7l4-4 4 4" />
        <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      </svg>
      {busy ? 'Preparing…' : label}
    </button>
  )
}

/** The picture itself. `compact` tightens it for the 390px lock-screen frame. */
export function StrokesCardImage({ vm, compact = false }: { vm: StrokesCardVM; compact?: boolean }) {
  const cell = compact ? 'h-[34px] text-[0.9rem]' : 'h-10 text-[0.95rem]'
  const front = vm.strokesByHole.slice(0, 9)
  const back = vm.strokesByHole.slice(9, 18)
  const hasCard = vm.strokesByHole.length === 18

  return (
    <div
      className="round overflow-hidden rounded-md border border-hair-strong bg-ground-2 shadow-[0_6px_22px_rgba(27,30,28,0.08)]"
      data-course={vm.courseSlug ?? undefined}
    >
      <div
        className={`border-b border-hair ${compact ? 'px-5 pb-3.5 pt-[18px]' : 'px-6 pb-[18px] pt-[22px]'}`}
        style={{
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--course, var(--paper)) 8%, var(--ground-2)) 0%, var(--ground-2) 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-[0.64rem] font-semibold uppercase tracking-[0.2em] text-gold">
            {compact ? '' : 'Streamsong 2027 · '}Round {vm.roundNumber} of 4
          </span>
          <span className="tnum ml-auto text-[0.66rem] uppercase tracking-[0.14em] text-paper-faint">{vm.dayLabel}</span>
        </div>
        <div className="mt-3 flex items-center gap-3.5">
          <Seal />
          <div className="min-w-0">
            <h2 className="fx-head font-display text-[2rem] font-semibold leading-none text-paper">{vm.courseName}</h2>
            <p className="tnum mt-1.5 text-[0.8rem] uppercase tracking-[0.12em] text-paper-dim">
              {vm.teeTime ? (
                <>
                  Tee <strong className="font-semibold text-gold-bright">{vm.teeTime.replace(' ET', '')}</strong> ·{' '}
                </>
              ) : null}
              {vm.teeName} tees · Par {vm.par}
            </p>
          </div>
        </div>
      </div>

      <div className={compact ? 'px-5 pb-4 pt-3.5' : 'px-6 pb-5 pt-[18px]'}>
        <span className="eyebrow block">{vm.name}</span>
        <div className="mt-1.5 flex items-baseline gap-3">
          <span
            className={`fx-display tnum font-display font-semibold leading-none text-paper ${compact ? 'text-[3.8rem]' : 'text-[4.4rem]'}`}
          >
            {vm.isLowMan ? '0' : vm.strokesToday}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="fx-title font-display text-[1.4rem] leading-[1.1] text-paper">
              {vm.isLowMan ? 'plays scratch' : vm.strokesToday === 1 ? 'stroke today' : 'strokes today'}
            </span>
            <span className="text-[0.85rem] text-paper-dim">
              {vm.isLowMan
                ? 'the low man in the field today'
                : vm.lowMan
                  ? `off ${vm.lowMan.firstName}, who plays scratch`
                  : 'off the low man'}
            </span>
          </span>
        </div>

        {hasCard && (
          <div className="mt-[18px]">
            <div className="flex items-baseline justify-between">
              <span className="text-[0.64rem] font-semibold uppercase tracking-[0.1em] text-paper-faint">Where they land</span>
              <span className="text-[0.64rem] uppercase tracking-[0.1em] text-paper-faint">Out · In</span>
            </div>
            <div className="mt-2 grid grid-cols-9 gap-1.5">
              {front.map((s, i) => (
                <HoleCell key={i + 1} hole={i + 1} strokes={s} className={cell} />
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-9 gap-1.5">
              {back.map((s, i) => (
                <HoleCell key={i + 10} hole={i + 10} strokes={s} className={cell} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-[18px] grid grid-cols-4 gap-2 border-t border-hair pt-3">
          <Fact label="Index" value={vm.handicap.index.toFixed(1)} />
          <Fact label="Course" value={vm.handicap.courseHandicap.toFixed(1)} />
          <Fact label="Playing" value={String(vm.handicap.playingHandicap)} />
          <Fact label="Low man" value={`− ${vm.handicap.lowStrokes}`} />
        </div>

        {vm.week && (
          <p className="tnum mt-3.5 text-[0.8rem] text-paper-dim">
            The week:{' '}
            <strong className="font-semibold text-paper">
              {vm.week.positionLabel === '1' ? '1st' : ordinal(vm.week.positionLabel)}, {vm.week.total} pts
            </strong>
            {vm.week.backLabel !== 'LEADER' ? ` · ${vm.week.backLabel.toLowerCase()}` : ''}
            {vm.week.note ? ` · ${vm.week.note}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

function ordinal(label: string): string {
  const tied = label.startsWith('T')
  const n = Number(tied ? label.slice(1) : label)
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
  return `${tied ? 'T' : ''}${n}${suffix}`
}

function HoleCell({ hole, strokes, className }: { hole: number; strokes: number; className: string }) {
  const on = strokes > 0
  return (
    <span
      className={`tnum relative flex items-center justify-center rounded ${className} ${
        on ? 'border border-gold bg-gold-fill font-semibold text-paper' : 'border border-hair-strong text-paper-dim'
      }`}
    >
      {hole}
      {strokes > 1 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-paper px-1 text-[0.55rem] font-semibold text-ground">
          {strokes}
        </span>
      )}
    </span>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-paper-faint">{label}</span>
      <span className="tnum text-[0.95rem] text-paper">{value}</span>
    </div>
  )
}

function Seal() {
  return (
    <svg width="44" height="44" viewBox="0 0 46 46" fill="none" stroke="var(--gold)" strokeWidth="1.25" aria-hidden className="flex-none">
      <circle cx="23" cy="23" r="21" />
      <circle cx="23" cy="23" r="16" strokeDasharray="1.5 2.5" strokeWidth="0.75" />
      <path d="M15 28 L23 14 L31 28 Z" />
      <path d="M15 28 h16" />
    </svg>
  )
}
