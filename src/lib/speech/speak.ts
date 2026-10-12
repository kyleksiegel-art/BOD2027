/**
 * The phone's built-in voice (Web Speech API). Offline: iOS speaks with voices stored on the
 * device. iOS only lets speech START inside a tap, so `speakLines` queues every line at once from
 * the click handler rather than chaining them off `onend`.
 */

// Apple's novelty voices — never the announcer.
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

/** Best English voice installed: Premium > Enhanced > on-device > anything, US English first. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const score = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name) ? 8 : /enhanced/i.test(v.name) ? 4 : 0) +
    (v.localService ? 2 : 0) +
    (v.lang === 'en-US' || v.lang === 'en_US' ? 1 : 0)
  const english = voices.filter((v) => /^en[-_]/i.test(v.lang) && !NOVELTY.test(v.name))
  if (english.length === 0) return null
  return english.slice().sort((a, b) => score(b) - score(a))[0]
}

/** Read `lines` in order. `onDone` fires once, when the last line ends or speech is stopped. */
export function speakLines(lines: string[], onDone: () => void): void {
  const synth = window.speechSynthesis
  synth.cancel()
  const voice = pickVoice(synth.getVoices())
  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    onDone()
  }
  lines.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text)
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    } else u.lang = 'en-US'
    u.rate = 1.02
    if (i === lines.length - 1) u.onend = done
    u.onerror = done
    synth.speak(u)
  })
}

export function stopSpeaking(): void {
  if (speechAvailable()) window.speechSynthesis.cancel()
}
