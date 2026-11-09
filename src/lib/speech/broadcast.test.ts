import { describe, expect, it } from 'vitest'
import { silentWav } from './broadcast'
import { stripCues } from './speak'
import { buildRadioCall } from '@/lib/data/radioCall'
import { logCall, readCallAudio, saveCallAudio, AUDIO_KEY_PREFIX, CALL_LOG_MAX } from '@/lib/data/callLog'
import { db as dexie } from '@/lib/db'
import type { Db } from '@/lib/data/compute'
import { reportDb, ROUND_ONE } from '@/test/reportFixture'

// The cues the ElevenLabs v3 voice acts out. Anything else in brackets would be read aloud.
const CUES = new Set(['excited', 'laughs', 'sighs', 'whispers', 'sarcastic'])

describe('stripCues', () => {
  it('drops performance cues for the phone voice and the screen, and nothing else', () => {
    expect(stripCues('Stop everything. [excited] Adam made a real eagle on the 7th.')).toBe('Stop everything. Adam made a real eagle on the 7th.')
    expect(stripCues('This one is over, [laughs] unless it isn\'t.')).toBe("This one is over, unless it isn't.")
    expect(stripCues('Somebody hold my beer. [laughs]')).toBe('Somebody hold my beer.')
    expect(stripCues('Jon leads by 3 with 5 to play.')).toBe('Jon leads by 3 with 5 to play.')
  })

  it('every cue in every call is one the voice knows', () => {
    const PURSE = { key: 'purse_amounts', value: { round_winner_cents: 5000, champ_first_cents: 60000, champ_second_cents: 20000 } }
    const live = (thru: number): Db => {
      const db = reportDb(ROUND_ONE, { status: 'in_progress', ctp: { 6: 2, 8: 2, 14: 2, 16: 1 } })
      return { ...db, scores: db.scores.filter((s) => s.hole_number <= thru), settings: [PURSE] }
    }
    const rands = Array.from({ length: 25 }, (_, i) => i / 25)
    const lines = [0, 2, 6, 9, 12, 16, 18].flatMap((t) => rands.flatMap((r) => buildRadioCall(live(t), '2027-02-04')!.script(() => r)))
    const cues = lines.flatMap((l) => [...l.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]))
    expect(cues.length).toBeGreaterThan(0)
    for (const c of cues) expect(CUES.has(c)).toBe(true)
    for (const l of lines) expect(stripCues(l)).not.toMatch(/[[\]]/)
  })
})

describe('silentWav', () => {
  it('is a well-formed PCM WAV of silence', () => {
    const w = silentWav(400)
    const v = new DataView(w.buffer)
    const ascii = (at: number, n: number) => String.fromCharCode(...w.slice(at, at + n))
    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(36, 4)).toBe('data')
    expect(v.getUint32(4, true)).toBe(w.length - 8)
    expect(v.getUint32(40, true)).toBe(400)
    expect([...w.slice(44)].every((b) => b === 128)).toBe(true)
  })
})

describe('saved call audio', () => {
  it('replays the saved take, and goes when its call leaves the log', async () => {
    await dexie.sync_meta.clear()
    const at = (i: number) => `2027-02-04T18:${String(i).padStart(2, '0')}:00Z`
    await logCall({ at: at(0), label: 'First', lines: ['a'] }, [])
    await saveCallAudio(at(0), new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }))
    expect((await readCallAudio(at(0)))?.size).toBe(3)

    // Push the first call off the end of the log: its audio is pruned with it.
    for (let i = 1; i <= CALL_LOG_MAX; i++) await logCall({ at: at(i), label: `Call ${i}`, lines: ['b'] }, [])
    expect(await readCallAudio(at(0))).toBeNull()
    expect(await dexie.sync_meta.where('key').startsWith(AUDIO_KEY_PREFIX).count()).toBe(0)
  })
})
