import { useEffect, useRef, useState } from 'react'
import { useRadioCall, useRadioMemory } from '@/lib/data/selectors'
import {
  logCall,
  readCallAudio,
  removeLoggedCall,
  restoreLoggedCall,
  saveCallAudio,
  type LoggedCall,
} from '@/lib/data/callLog'
import { primeSpeech, speakLines, speechAvailable, stopSpeaking } from '@/lib/speech/speak'
import { BROADCAST_TIMEOUT_MS, fetchBroadcast, playBroadcast, primeAudio, stopBroadcast } from '@/lib/speech/broadcast'

/** What's playing: nothing, the broadcast voice being fetched, the broadcast voice, or the phone's. */
export type RadioVoice = 'loading' | 'broadcast' | 'phone'

/**
 * Plays the radio call: a fresh take for right now (avoiding lines this phone has heard lately,
 * then logging it), or a replay of an earlier call word for word. Shared by the Field Report's
 * secret triple tap and the Admin card.
 *
 * The broadcast voice first (Kyle 2026-11-08): the call's text goes to the `radio-voice` Edge
 * Function (ElevenLabs) and the MP3 plays, then is saved with the call so a replay needs no
 * signal. No signal, no answer within BROADCAST_TIMEOUT_MS, or any failure → the phone's own
 * voice reads it, as before. iOS only starts audio and speech inside a tap, so both are primed
 * synchronously in the tap, before the fetch; the memory is read ahead of time by a live query.
 */
export function useRadioPlayer() {
  const call = useRadioCall()
  const memory = useRadioMemory()
  const [playing, setPlaying] = useState<string | null>(null) // 'now', or the `at` of a replay
  const [voice, setVoice] = useState<RadioVoice | null>(null)
  const [removed, setRemoved] = useState<LoggedCall | null>(null) // the last delete, for Undo
  const token = useRef(0)
  const abort = useRef<AbortController | null>(null)

  const halt = () => {
    abort.current?.abort()
    abort.current = null
    stopBroadcast()
    stopSpeaking()
  }
  useEffect(() => halt, [])

  /** `at` is the logged call this audio belongs to. Must be called synchronously in the tap. */
  const play = (id: string, at: string, lines: string[]) => {
    halt()
    const mine = ++token.current
    const current = () => token.current === mine
    setPlaying(id)
    setVoice('loading')
    primeAudio()
    primeSpeech()

    const finish = () => {
      if (!current()) return
      setPlaying(null)
      setVoice(null)
    }
    // A cancelled call's own "done" must not clear the one that replaced it.
    const fallback = () => {
      if (!current()) return
      abort.current?.abort()
      if (!speechAvailable()) return finish()
      setVoice('phone')
      speakLines(lines, finish)
    }
    const broadcast = (audio: Blob) => {
      if (!current()) return
      setVoice('broadcast')
      playBroadcast(audio, finish, fallback)
    }

    void (async () => {
      const saved = await readCallAudio(at)
      if (!current()) return
      if (saved) return broadcast(saved)
      const ac = new AbortController()
      abort.current = ac
      const timer = setTimeout(() => ac.abort(), BROADCAST_TIMEOUT_MS)
      try {
        const audio = await fetchBroadcast(lines, ac.signal)
        void saveCallAudio(at, audio)
        broadcast(audio)
      } catch {
        fallback()
      } finally {
        clearTimeout(timer)
      }
    })()
  }

  const stop = () => {
    token.current++
    halt()
    setPlaying(null)
    setVoice(null)
  }

  return {
    call,
    calls: memory?.calls ?? [],
    playing,
    voice,
    // Audio needs no speech engine; the broadcast voice plays wherever <audio> does.
    available: typeof Audio !== 'undefined' || speechAvailable(),
    playNow() {
      if (!call) return
      const { lines, used } = call.compose(Math.random, new Set(memory?.recent ?? []))
      const at = new Date().toISOString()
      play('now', at, lines)
      void logCall({ at, label: call.label, lines }, used)
    },
    replay(c: LoggedCall) {
      play(c.at, c.at, c.lines)
    },
    stop,
    removed,
    remove(c: LoggedCall) {
      if (playing === c.at) stop()
      setRemoved(c)
      void removeLoggedCall(c.at)
    },
    undoRemove() {
      if (!removed) return
      setRemoved(null)
      void restoreLoggedCall(removed)
    },
  }
}
