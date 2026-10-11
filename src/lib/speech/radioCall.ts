import type { StoryEntry, StoryVM } from '@/lib/data/fieldStory'
import { ordinalOf } from '@/lib/format'

/**
 * The radio call: the Field Report read out loud, oldest hole first, with a short open and close.
 * Pure: turns the story the screen already shows into lines for the phone's built-in voice
 * (speak.ts). One line per utterance, so the voice pauses naturally between holes.
 */
export function radioScript(vm: StoryVM): string[] {
  const where = vm.courseName
  const lines: string[] = []
  if (vm.live && !vm.complete) {
    lines.push(`Here's the call from ${where}, round ${vm.roundNumber}, through the ${ordinalOf(vm.roundThru)}.`)
  } else {
    lines.push(`Here's how round ${vm.roundNumber} went on ${where}.`)
  }
  const entries = vm.entries.slice().reverse()
  entries.forEach((e, i) => {
    const line = entryLine(e, i === entries.length - 1 && !(vm.live && !vm.complete))
    if (line) lines.push(line)
  })
  lines.push(vm.live && !vm.complete ? 'More as it happens.' : "That's the round.")
  return lines.map(forSpeech)
}

function entryLine(e: StoryEntry, last: boolean): string | null {
  const text = e.segs.map((s) => s.text).join('').trim()
  if (e.kind === 'turn') return e.scoreline ? `At the turn, it's ${e.scoreline}.` : null
  if (e.kind === 'partial') return `On the ${e.label}, ${text.replace(/ in: /, ' are in. ')}`
  const label = e.kind === 'quiet' ? e.label.replace('–', ' through the ') : e.label
  const head = `The ${label}.`
  const tail = e.scoreline ? ` ${last ? 'Final tally' : 'Where it stands'}: ${e.scoreline}.` : ''
  return text ? `${head} ${text}${tail}` : tail ? `${head}${tail}` : null
}

/** What a voice would trip on: the closest-to-the-pin shorthand and the en dash. */
function forSpeech(s: string): string {
  return s
    .replace(/\bthe CTP\b/g, 'closest to the pin')
    .replace(/\bCTPs?\b/g, 'closest to the pin')
    .replace(/–/g, ' to ')
    .replace(/\s+/g, ' ')
    .trim()
}
