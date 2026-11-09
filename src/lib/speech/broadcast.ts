import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase'

/**
 * The broadcast voice (Kyle 2026-11-08): the call's own text, voiced by ElevenLabs through the
 * `radio-voice` Edge Function, played through ONE shared <audio> element.
 *
 * iOS only lets audio start inside a tap, and the voice arrives seconds after it. So the tap
 * calls `primeAudio()`, which plays a few milliseconds of generated silence on the shared
 * element; once unlocked that way, the same element may play the real clip when it lands.
 * Needs signal. Anything that goes wrong makes the caller fall back to the phone's own voice.
 */

/** How long to wait for the voice before giving up and reading it in the phone's voice. */
export const BROADCAST_TIMEOUT_MS = 15_000

let el: HTMLAudioElement | null = null
let currentUrl: string | null = null
let silentUrl: string | null = null

function element(): HTMLAudioElement {
  if (!el) {
    el = new Audio()
    el.preload = 'auto'
  }
  return el
}

/** A valid, tiny WAV of silence (8 kHz, 8-bit mono, 50 ms). Built here so no asset is needed. */
export function silentWav(samples = 400): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(44 + samples)
  const v = new DataView(buf.buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, 8000, true) // sample rate
  v.setUint32(28, 8000, true) // byte rate
  v.setUint16(32, 1, true) // block align
  v.setUint16(34, 8, true) // bits per sample
  ascii(36, 'data')
  v.setUint32(40, samples, true)
  buf.fill(128, 44) // 8-bit PCM silence is the midpoint
  return buf
}

/** Call synchronously inside the tap, before any await. Never throws. */
export function primeAudio(): void {
  try {
    const a = element()
    silentUrl ??= URL.createObjectURL(new Blob([silentWav()], { type: 'audio/wav' }))
    a.src = silentUrl
    void a.play().catch(() => {})
  } catch {
    // No audio element (tests, very old browser): the fallback voice still works.
  }
}

/** Ask the Edge Function to voice `lines`. Rejects on no signal, a non-200, or `signal` abort. */
export async function fetchBroadcast(lines: string[], signal: AbortSignal): Promise<Blob> {
  const res = await fetch(`${supabaseUrl}/functions/v1/radio-voice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ lines }),
    signal,
  })
  if (!res.ok) throw new Error(`radio-voice ${res.status}`)
  const blob = await res.blob()
  if (blob.size === 0) throw new Error('radio-voice returned no audio')
  return blob
}

/**
 * Play a voiced call on the primed element. `onEnd` fires when it finishes; `onFail` fires if
 * it can't play at all (iOS refused, undecodable clip), so the caller can use the phone's voice.
 */
export function playBroadcast(blob: Blob, onEnd: () => void, onFail: () => void): void {
  let a: HTMLAudioElement
  try {
    a = element()
    if (currentUrl) URL.revokeObjectURL(currentUrl)
    currentUrl = URL.createObjectURL(blob)
    a.onended = () => onEnd()
    a.onerror = () => onFail()
    a.src = currentUrl
  } catch {
    onFail()
    return
  }
  a.play().catch(() => onFail())
}

export function stopBroadcast(): void {
  if (!el) return
  el.onended = null
  el.onerror = null
  el.pause()
}
