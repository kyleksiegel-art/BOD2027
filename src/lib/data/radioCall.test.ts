import { describe, expect, it } from 'vitest'
import { buildRadioCall, signature } from './radioCall'
import { logCall, readCallLog, readRecentSignatures, removeLoggedCall, restoreLoggedCall, CALL_LOG_MAX } from './callLog'
import { db as dexie } from '@/lib/db'
import type { Db } from './compute'
import { reportDb, weekDb, ROUND_ONE, ROUND_TWO } from '@/test/reportFixture'
import { buildFieldStory } from './fieldStory'
import { buildRoundReport } from './report'
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
    expect(lines).toContain("Let's meet the field. Returning co-champions, Jon Aronson and Chris Den-oh-vee. Kyle Siegel. Adam Hersh, inaugural champion.")
    expect(lines).toContain("Here's the road ahead: the Red today, the Blue on Friday, the Black on Saturday and Bone Valley on Sunday.")
    expect(lines).toContain('$1000 on the line. $600 for the champion, $200 for second, and $50 to whoever wins each round. Plus closest to the pin and shits, settled at the nineteenth hole, like gentlemen.')
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
    // The last two holes are called, not read out: the quiet 15th is skipped, the 16th had a winner.
    expect(lines).toContain('Last time through. Chris wins the 16th outright with a net birdie. The lead grows to 11. Kyle wins closest to the pin there.')
    expect(lines.join(' ')).not.toMatch(/On the 15th:/)
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
    expect(lines).toContain('Final scores: Chris 44, Kyle 36, Jon 31, Adam 27.')
    expect(lines.join(' ')).not.toMatch(/Pars all round|On the \d+(st|nd|rd|th):/)
    expect(lines).toContain('If it ended right now, Chris takes home $600 and Kyle $200.')
    expect(lines).toContain('Next up: the Blue.')
  })

  it('calls the wrap like a highlights show: result, money, play of the day, the field, a blooper', () => {
    const db = { ...reportDb(ROUND_ONE, { ctp: { 6: 2, 8: 2, 14: 2, 16: 1 } }), settings: [PURSE] }
    const { lines } = call(db)
    expect(lines.slice(1, 11)).toEqual([
      "Chris wins round 1, and it wasn't close. 44 points, 8 clear of Kyle.",
      'Final scores: Chris 44, Kyle 36, Jon 31, Adam 27.',
      "That's $50 to Chris.",
      'Chris took the lead on the 2nd and never gave it back. It got as big as 12 after the 11th.',
      "Play of the day. The par-5 7th. Chris makes a true eagle, while the other three walk off with nothing. No strokes. No asterisk. Chris's lead went from 3 to 7 on one hole. That was the round.",
      'Honorable mention: Jon, with a true eagle on the last. Too late to matter, but it will come up at dinner. Repeatedly.',
      "Kyle finishes second on 36. Kyle actually won the back nine with 21, but gave Chris a 10-point head start at the turn. You can't do that.",
      '11 going out, 20 coming home. Somebody tell Jon the round starts on the 1st.'.replace(/^/, 'Jon is third on 31. '),
      'Adam brings up the rear on 27. But Adam won three closest to the pins. Last on the card, first to the cash.',
      "From the blooper reel. Chris went 17 holes without a zero, then took one on the last with the round already won. We're calling it a victory lap.",
    ])
    // Every take names all four players and the winner's money.
    for (const r of [0.3, 0.6, 0.99]) {
      const take = buildRadioCall(db, '2027-02-04')!.script(() => r).join(' ')
      for (const name of ['Chris', 'Kyle', 'Jon', 'Adam']) expect(take).toContain(name)
      expect(take).toMatch(/\$50/)
    }
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

  it('ends the trip after the last round: champion, standings, money, CTP king, the shits', () => {
    const db = reportDb(ROUND_ONE, { ctp: { 6: 2, 8: 2, 14: 2, 16: 1 } })
    db.rounds = db.rounds.map((r) => (r.round_number === 1 ? r : { ...r, status: 'abandoned' as const }))
    db.settings = [PURSE]
    const { phase, lines } = call(db)
    expect(phase).toBe('final')
    expect(lines[0]).toBe("That's it. 18 holes. The Board of Directors, twenty twenty-seven, is in the books.")
    expect(lines).toContain('Chris Den-oh-vee is your champion!')
    expect(lines).toContain('Final standings. Chris, 44. Kyle, 36. Jon, 31. Adam, 27.')
    expect(lines).toContain('$600 to the champion. $200 to Kyle.')
    expect(lines).toContain('And Adam Hersh! Last on the card, but with three closest to the pins, the closest to the pin king of Streamsong.')
    expect(lines.join(' ')).toMatch(/And then there's the shits\./)
    expect(lines.join(' ')).not.toMatch(/Next up/)
  })

  it('labels what the call covers, for the Admin card', () => {
    const labels = [0, 9, 12, 18].map((t) => buildRadioCall(live(t), '2027-02-04')!.label)
    expect(labels).toEqual(['Trip opener, first tee', 'Round 1 · the turn', 'Round 1 · live, through 12', 'Round 1 · round wrap'])
    const db = reportDb(ROUND_ONE)
    db.rounds = db.rounds.map((r) => (r.round_number === 1 ? r : { ...r, status: 'abandoned' as const }))
    expect(buildRadioCall(db, '2027-02-04')!.label).toBe('Trip finale')
  })

  it('names only, never a pronoun; nothing a voice trips on', () => {
    const all = [0, 2, 6, 9, 12, 16, 18].flatMap((t) => [0, 0.5, 0.99].flatMap((r) => buildRadioCall(live(t), '2027-02-04')!.script(() => r))).join(' ')
    expect(all).not.toMatch(/\b(he|his|him|she|her)\b/i)
    expect(all).not.toMatch(/CTP|–|—|\.\s*\./)
    // Full names only on the trip's first tee (the field and its history), never mid-round.
    const midRound = [2, 6, 9, 12, 16, 18].flatMap((t) => buildRadioCall(live(t), '2027-02-04')!.script(() => 0.5)).join(' ')
    expect(midRound).not.toMatch(/Aronson|Siegel|Hersh|Denove|Den-oh-vee/)
  })
})

describe('a hole in one', () => {
  // Kyle holes the tee shot on the par-3 14th. One swing is never "a true eagle".
  const aced = (thru: number, status: 'in_progress' | 'final' = 'in_progress'): Db => {
    const db = reportDb(ROUND_ONE, { status, ctp: { 14: 1 } })
    const scores = db.scores.map((s) => (s.hole_number === 14 && s.player_id.startsWith('00000001') ? { ...s, gross_strokes: 1 } : s))
    return { ...db, scores: scores.filter((s) => s.hole_number <= thru), settings: [PURSE] }
  }

  it('the announcer loses it on the hole, and never calls it an eagle', () => {
    for (const r of [0, 0.4, 0.99]) {
      const lines = buildRadioCall(aced(14), '2027-02-04')!.script(() => r)
      const callLine = lines.find((l) => /hole in one/i.test(l))!
      expect(callLine).toMatch(/Kyle/)
      expect(callLine).toMatch(/!/)
      expect(lines.join(' ')).not.toMatch(/Kyle[^.]*true eagle|true eagle[^.]*14th/)
    }
    expect(buildRadioCall(aced(14), '2027-02-04')!.script(() => 0)).toContain(
      'Stop everything. Stop everything! Kyle has made a hole in one on the 14th! A hole in one! One swing, one ball, bottom of the cup! Safe to say that wins closest to the pin. The drinks tonight are on Kyle. Those are the rules. Oh, and Chris leads by 8.',
    )
  })

  it('stays in the call for the rest of the round and is the play of the day', () => {
    expect(buildRadioCall(aced(17), '2027-02-04')!.script(() => 0).join(' ')).toMatch(/Kyle made a hole in one on the 14th today/)
    const wrap = buildRadioCall(aced(18, 'final'), '2027-02-04')!.script(() => 0)
    expect(wrap).toContain('Play of the day, play of the trip, play of a lifetime. The par-3 14th. Kyle makes a hole in one. A hole in one! One swing. Bottom of the cup.')
    expect(wrap.join(' ')).toMatch(/Honorable mention: Chris, with a true eagle on the 7th/)
  })

  it('the Field Report and the round report say hole in one too', () => {
    const story = buildFieldStory(aced(18, 'final'))!.entries.map((e) => e.segs.map((x) => x.text).join('')).join(' ')
    expect(story).toMatch(/Kyle makes a hole in one/)
    const report = buildRoundReport(1, aced(18, 'final'))!.paragraphs.map((p) => p.map((x) => x.text).join('')).join(' ')
    expect(report).toMatch(/hole in one/)
    expect(report).not.toMatch(/eagle on the (par-3 )?14th/)
  })
})

describe('the calls as a broadcast', () => {
  it('a true eagle is shouted on the hole, once, with what it did to the lead', () => {
    const lines = call(live(7)).lines
    expect(lines).toContain('Stop everything. Chris just made a true eagle on the par-5 7th! No strokes. No asterisk. The other three took zeros. The lead goes from 3 to 7.')
    expect(lines.filter((l) => /true eagle/.test(l))).toHaveLength(1)
  })

  it('calls closest to the pin on the hole, even a quiet one', () => {
    expect(call(live(6)).lines).toContain('Last time through. Adam wins closest to the pin on the 6th.')
  })

  it('a blow-up hole is a story, in the call and on the blooper reel', () => {
    const boom = (db: Db) => ({ ...db, scores: db.scores.map((s) => (s.hole_number === 13 && s.player_id.startsWith('00000002') ? { ...s, gross_strokes: 9 } : s)) })
    expect(call(boom(live(13))).lines).toContain('Adam made a 9 on the par-5 13th. We counted twice.')
    const wrap = call(boom({ ...reportDb(ROUND_ONE), settings: [PURSE] })).lines
    expect(wrap).toContain('From the blooper reel. Adam made a 9 on the par-5 13th. A 9. We have the scorecard.')
  })

  it('the turn is a halftime show: play of the front nine, report cards, who needs a back nine', () => {
    const { lines } = call(live(9))
    expect(lines).toContain('Play of the front nine: Chris, a true eagle on the par-5 7th. Roll that one again.')
    expect(lines).toContain('Halftime report cards. Chris gets an A. Kyle, a D. Jon, an F. Adam, an F. Parents will be notified.')
    expect(lines).toContain('Adam is 16 back and needs the back nine of a lifetime. Or a very good dinner.')
  })

  it('after a later round, the wrap says what the day did to the week', () => {
    const db = { ...weekDb([ROUND_ONE, ROUND_TWO]), settings: [PURSE] }
    const { lines } = call(db, '2027-02-05')
    expect(lines).toContain('And the week has a new leader. Kyle started the day 8 behind Chris and ends it 4 in front.')
    expect(lines).toContain('Mover of the day: Jon, from 13 back to 9 back.')
    expect(lines).toContain('Two rounds to play.')
    expect(lines).toContain('If it ended right now, Kyle takes home $600 and Chris $200.')
    expect(lines.some((l) => l.startsWith('Chris finishes level with Adam on 30.'))).toBe(true)
  })

  it('the finale has a play of the trip and a line on everyone else\'s week', () => {
    const db = { ...weekDb([ROUND_ONE, ROUND_TWO]), settings: [PURSE] }
    db.rounds = db.rounds.map((r) => (r.round_number <= 2 ? r : { ...r, status: 'abandoned' as const }))
    const { lines } = call(db, '2027-02-05')
    expect(lines).toContain('Kyle Siegel is your champion!')
    // Two true eagles that week. Chris's left the other three with zeros and won the round; Jon's came on the last, too late.
    expect(lines).toContain('Play of the trip: Chris, a true eagle on the par-5 7th at the Red. Still talking about it.')
    // How the champion won the week, then a different angle on each of the others.
    expect(lines).toContain('Kyle did not lead the week until the last day. Eight back going into the Blue, and champion coming out of it.')
    expect(lines).toContain('Chris led the week after the Red and finished second. That one will sting.')
    expect(lines).toContain('Jon saved the best for last: 38 on the Blue.')
    expect(lines).toContain('Adam needed a day to get going: 27 on the Red, and never that bad again.')
  })
})

describe('a close finish', () => {
  it('the finale always calls the last hole when the trip was decided by three or fewer', () => {
    // Round 2 with Chris three better: the week ends Kyle 78, Chris 77. Both make net par on the last.
    const tight = ROUND_TWO.map((p) => (p.name.startsWith('Chris') ? { ...p, pts: p.pts.map((v, h) => (h < 3 ? v + 1 : v)) } : p))
    const db = { ...weekDb([ROUND_ONE, tight]), settings: [PURSE] }
    db.rounds = db.rounds.map((r) => (r.round_number <= 2 ? r : { ...r, status: 'abandoned' as const }))
    const { lines } = call(db, '2027-02-05')
    const i = lines.indexOf('One point. 36 holes, and it comes down to one point.')
    expect(i).toBeGreaterThan(0)
    expect(lines[i + 1]).toBe('It went to the last hole. Kyle came to the 18th tee one point ahead for the week and made a net par. Chris made a net par, and it was not enough.')
    // A four-point finish (the plain two-round week) gets no such line.
    const wide = { ...weekDb([ROUND_ONE, ROUND_TWO]), settings: [PURSE] }
    wide.rounds = wide.rounds.map((r) => (r.round_number <= 2 ? r : { ...r, status: 'abandoned' as const }))
    expect(call(wide, '2027-02-05').lines.join(' ')).not.toMatch(/last tee|18th tee/)
  })
})

describe('variety', () => {
  it('a template keeps its signature whoever and whatever it is about', () => {
    expect(signature("Chris has taken zeros on three straight holes. Thoughts and prayers.")).toBe(
      signature("Adam has taken zeros on two straight holes. Thoughts and prayers."),
    )
    expect(signature('Chris leads by 3.')).not.toBe(signature('Chris is 3 clear.'))
  })

  it('steers clear of the lines it used last time', () => {
    const vm = buildRadioCall(live(12), '2027-02-04')!
    const a = vm.compose(() => 0)
    const b = vm.compose(() => 0, new Set(a.used))
    expect(a.used.length).toBeGreaterThan(5)
    // Every pooled line of the second take is a different template from the first.
    const repeated = b.used.filter((sig) => a.used.includes(sig))
    expect(repeated).toEqual([])
    // Same facts, though.
    expect(b.lines.join(' ')).toMatch(/Chris/)
  })

  it('labels the champions when the field is introduced, and nowhere else', () => {
    const lines = buildRadioCall(live(0), '2027-02-04')!.script(() => 0)
    expect(lines).toContain("Let's meet the field. Returning co-champions, Jon Aronson and Chris Den-oh-vee. Kyle Siegel. Adam Hersh, inaugural champion.")
    const db = reportDb(ROUND_ONE)
    db.rounds = db.rounds.map((r) => (r.round_number === 1 ? r : { ...r, status: 'abandoned' as const }))
    const finale = buildRadioCall(db, '2027-02-04')!.script(() => 0).join(' ')
    expect(finale).not.toMatch(/returning|inaugural|defend|crown/)
  })
})

describe('callLog', () => {
  it('keeps the last calls, newest first, and remembers the templates used', async () => {
    await dexie.sync_meta.clear()
    for (let i = 0; i < CALL_LOG_MAX + 3; i++) await logCall({ at: `2027-02-04T18:${String(i).padStart(2, '0')}:00Z`, label: `Call ${i}`, lines: [`Line ${i}`] }, [`sig-${i}`])
    const log = await readCallLog()
    expect(log).toHaveLength(CALL_LOG_MAX)
    expect(log[0].label).toBe(`Call ${CALL_LOG_MAX + 2}`)
    expect((await readRecentSignatures())[0]).toBe(`sig-${CALL_LOG_MAX + 2}`)
  })

  it('removes one call and leaves its templates on the recent list', async () => {
    await dexie.sync_meta.clear()
    await logCall({ at: '2027-02-04T18:00:00Z', label: 'Keep', lines: ['a'] }, ['sig-keep'])
    await logCall({ at: '2027-02-04T18:05:00Z', label: 'Misfire', lines: ['b'] }, ['sig-misfire'])
    await removeLoggedCall('2027-02-04T18:05:00Z')
    expect((await readCallLog()).map((c) => c.label)).toEqual(['Keep'])
    expect(await readRecentSignatures()).toContain('sig-misfire')
  })

  it('restores a removed call to its place', async () => {
    await dexie.sync_meta.clear()
    for (const m of ['00', '05', '10']) await logCall({ at: `2027-02-04T18:${m}:00Z`, label: m, lines: [m] }, [])
    const [, middle] = await readCallLog()
    await removeLoggedCall(middle.at)
    await restoreLoggedCall(middle)
    expect((await readCallLog()).map((c) => c.label)).toEqual(['10', '05', '00'])
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
