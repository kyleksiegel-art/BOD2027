import { describe, expect, it } from 'vitest'
import { buildRadioCall } from './radioCall'
import type { Db } from './compute'
import { reportDb, ROUND_ONE } from '@/test/reportFixture'
import { pickVoice } from '@/lib/speech/speak'

const PURSE = { key: 'purse_amounts', value: { round_winner_cents: 5000, champ_first_cents: 60000, champ_second_cents: 20000 } }
const first = () => 0 // always the first line of every pool

/** The real Round 1, live with the whole group through `thru`. */
function live(thru: number): Db {
  const db = reportDb(ROUND_ONE, { status: 'in_progress', ctp: { 6: 2, 8: 2, 14: 2, 16: 1 } })
  return { ...db, scores: db.scores.filter((s) => s.hole_number <= thru), settings: [PURSE] }
}
const call = (db: Db, today = '2027-02-04') => {
  const vm = buildRadioCall(db, today)!
  return { phase: vm.phase, lines: vm.script(first) }
}

describe('buildRadioCall', () => {
  it('picks its segments by where the round is', () => {
    expect([0, 2, 6, 9, 12, 16, 18].map((t) => call(live(t)).phase)).toEqual(['preview', 'early', 'front', 'turn', 'back', 'closing', 'final'])
  })

  it('previews the first tee: who gets shots, a clean slate, the 1st', () => {
    const { lines } = call(live(0))
    expect(lines).toContain('Chris gets eight shots and Kyle four, and Jon and Adam play off scratch.')
    expect(lines.some((l) => /^First up, the 1st: a par 4\./.test(l))).toBe(true)
    expect(lines).toContain('Kyle and Chris get a shot there.')
  })

  it('opens the whole trip on the first tee of round 1', () => {
    const db = live(0)
    db.settings = [{ key: 'purse_amounts', value: { buy_in_per_player_cents: 25000, champ_first_cents: 60000, champ_second_cents: 20000, round_winner_cents: 5000 } }]
    const { lines } = call(db)
    expect(lines[0]).toMatch(/welcome to the Board of Directors/)
    expect(lines).toContain("Let's meet the field. Jon Air-un-sun. Kyle See-gul. Adam Hersh. Chris Den-oh-vee.")
    expect(lines).toContain("Here's the road ahead: the Red today, the Blue on Friday, the Black on Saturday and Bone Valley on Sunday.")
    expect(lines.some((l) => l.startsWith('$1000 on the line. $600 for the champion, $200 for second, and $50 to whoever wins each round.'))).toBe(true)
    // Round 2's preview is not the trip opener.
    const r2 = { ...reportDb(ROUND_ONE), settings: [PURSE] }
    const second = r2.rounds.find((r) => r.round_number === 2)!
    r2.round_players = [...r2.round_players, ...r2.round_players.map((rp) => ({ ...rp, round_id: second.id }))]
    expect(call(r2, second.date).lines.join(' ')).not.toMatch(/meet the field/)
  })

  it('at the turn reviews the front nine and sets up the 10th', () => {
    const { lines } = call(live(9))
    expect(lines[0]).toMatch(/^That's the turn on the Red\./)
    expect(lines).toContain('On the front nine, Chris has been the best player on property, with 25 points.')
    expect(lines).toContain('Adam brought up the rear with 9.')
    expect(lines).toContain("At the turn, it's Chris 25, Kyle 15, Jon 11, Adam 9.")
    expect(lines).toContain('$50 on this round, and Chris has a hand on it.'.replace(/^/, "There's "))
    expect(lines.some((l) => /^Up next, the 10th/.test(l))).toBe(true)
  })

  it('down the stretch: the last two holes, the last nine, the finish', () => {
    const { lines } = call(live(16))
    expect(lines).toContain("Last time through. On the 15th: Kyle and Chris make net birdies. Chris still leads by 10.")
    expect(lines.some((l) => l.startsWith('Over the last nine holes'))).toBe(true)
    expect(lines).toContain('Then the 18th, a par 5, to finish.')
    // Only CTPs already won count.
    expect(call(live(2)).lines.join(' ')).not.toMatch(/closest to the pins today/)
  })

  it('a half-finished hole puts the group on it', () => {
    const db = live(12)
    const r1 = reportDb(ROUND_ONE, { status: 'in_progress' })
    db.scores = [...db.scores, ...r1.scores.filter((s) => s.hole_number === 13 && /^0000000[13]/.test(s.player_id))]
    const { lines } = call(db)
    expect(lines).toContain('On the 13th, Kyle and Chris are in. Jon and Adam still to post.')
    expect(lines.some((l) => l.startsWith('The group is on the 13th'))).toBe(true)
  })

  it('wraps a final round with the week, the money and what is next', () => {
    const db = { ...reportDb(ROUND_ONE, { ctp: { 6: 2 } }), settings: [PURSE] }
    const { phase, lines } = call(db)
    expect(phase).toBe('final')
    expect(lines.some((l) => l.endsWith('Final tally: Chris 44, Kyle 36, Jon 31, Adam 27.'))).toBe(true)
    expect(lines.join(' ')).not.toMatch(/Pars all round/)
    expect(lines).toContain('If it ended right now, Chris takes home $600 and Kyle $200.')
    expect(lines).toContain('Next up: the Blue.')
  })

  it("previews the next round on its morning once it's set up", () => {
    const db = { ...reportDb(ROUND_ONE), settings: [PURSE] }
    const r2 = db.rounds.find((r) => r.round_number === 2)!
    db.round_players = [...db.round_players, ...db.round_players.map((rp) => ({ ...rp, round_id: r2.id }))]
    expect(call(db, '2027-02-04').phase).toBe('final')
    const { phase, lines } = call(db, r2.date)
    expect(phase).toBe('preview')
    expect(lines.some((l) => /Chris leads Kyle by 8|Chris on top, 8 ahead of Kyle/.test(l))).toBe(true)
  })

  it('names only, never a pronoun; nothing a voice trips on', () => {
    const all = [0, 2, 6, 9, 12, 16, 18].flatMap((t) => [0, 0.5, 0.99].flatMap((r) => buildRadioCall(live(t), '2027-02-04')!.script(() => r))).join(' ')
    expect(all).not.toMatch(/\b(he|his|him|she|her)\b/i)
    expect(all).not.toMatch(/CTP|–|—|\.\s*\./)
    // Full names only where the field is introduced, respelled for the voice.
    expect(all.replace(/Let's meet the field\.[^]*?Chris Den-oh-vee\./g, '')).not.toMatch(/Aronson|Air-un-sun|Siegel|See-gul|Hersh|Denove|Den-oh-vee/)
  })
})

describe('pickVoice', () => {
  const v = (name: string, lang = 'en-US', localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice
  it('prefers Premium, then Enhanced, and never a novelty voice', () => {
    expect(pickVoice([v('Samantha'), v('Zoe (Premium)'), v('Evan (Enhanced)')])!.name).toBe('Zoe (Premium)')
    expect(pickVoice([v('Samantha'), v('Evan (Enhanced)')])!.name).toBe('Evan (Enhanced)')
    expect(pickVoice([v('Zarvox'), v('Daniel', 'en-GB')])!.name).toBe('Daniel')
    expect(pickVoice([v('Thomas', 'fr-FR')])).toBeNull()
  })
})
