import { useEffect, useState } from 'react'
import { useRadioCall } from '@/lib/data/selectors'
import { speakLines, speechAvailable, stopSpeaking } from '@/lib/speech/speak'

/**
 * Admin's radio call button (Kyle 2026-10-11): the same call the Field Report's secret triple tap
 * plays, behind the PIN so it stays a surprise. Uses the phone's own voice, so it works offline.
 */
export function RadioCallCard() {
  const call = useRadioCall()
  const [playing, setPlaying] = useState(false)
  useEffect(() => stopSpeaking, [])
  if (!call || !speechAvailable()) return null

  const toggle = () => {
    if (playing) {
      stopSpeaking()
      setPlaying(false)
      return
    }
    setPlaying(true)
    speakLines(call.script(), () => setPlaying(false))
  }

  return (
    <section className="mt-5 flex items-center justify-between gap-3 rounded-md border border-hair p-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.95rem] font-semibold text-paper">Radio call</span>
        <span className="truncate text-[0.78rem] text-paper-faint">{call.label}</span>
      </span>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={playing}
        className="tap inline-flex shrink-0 items-center gap-2 rounded-md border border-hair-strong bg-ground-2 px-4 text-[0.9rem] font-semibold text-paper"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
          {playing ? <rect x="2" y="2" width="10" height="10" rx="1" fill="currentColor" /> : <path d="M3 1.5v11l9.5-5.5z" fill="currentColor" />}
        </svg>
        {playing ? 'Stop' : 'Play'}
      </button>
    </section>
  )
}
