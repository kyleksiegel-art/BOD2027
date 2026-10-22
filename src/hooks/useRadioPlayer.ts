import { useEffect, useRef, useState } from 'react'
import { useRadioCall, useRadioMemory } from '@/lib/data/selectors'
import { logCall, removeLoggedCall, restoreLoggedCall, type LoggedCall } from '@/lib/data/callLog'
import { speakLines, speechAvailable, stopSpeaking } from '@/lib/speech/speak'

/**
 * Plays the radio call: a fresh take for right now (avoiding lines this phone has heard lately,
 * then logging it), or a replay of an earlier call word for word. Shared by the Field Report's
 * secret triple tap and the Admin card. Everything is synchronous inside the tap — iOS only
 * starts speech from a gesture — so the memory is read ahead of time by a live query.
 */
export function useRadioPlayer() {
  const call = useRadioCall()
  const memory = useRadioMemory()
  const [playing, setPlaying] = useState<string | null>(null) // 'now', or the `at` of a replay
  const [removed, setRemoved] = useState<LoggedCall | null>(null) // the last delete, for Undo
  const token = useRef(0)
  useEffect(() => stopSpeaking, [])

  const speak = (id: string, lines: string[]) => {
    const mine = ++token.current
    setPlaying(id)
    // A cancelled call's own "done" must not clear the one that replaced it.
    speakLines(lines, () => {
      if (token.current === mine) setPlaying(null)
    })
  }

  const stop = () => {
    token.current++
    stopSpeaking()
    setPlaying(null)
  }

  return {
    call,
    calls: memory?.calls ?? [],
    playing,
    available: speechAvailable(),
    playNow() {
      if (!call || !speechAvailable()) return
      const { lines, used } = call.compose(Math.random, new Set(memory?.recent ?? []))
      speak('now', lines)
      void logCall({ at: new Date().toISOString(), label: call.label, lines }, used)
    },
    replay(c: LoggedCall) {
      if (!speechAvailable()) return
      speak(c.at, c.lines)
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
