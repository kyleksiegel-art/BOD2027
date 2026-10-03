import { describe, it, expect } from 'vitest'
import { buildFieldStory } from './fieldStory'
import { reportDb, ROUND_ONE } from '@/test/reportFixture'

// The Field Report story view (2026-10-02). Checked by hand against ROUND_ONE's points table:
// lead after each hole (Chris minus Kyle unless noted) 0* 1 3 1 2 3 7 9 10 | 10 12 10 10 10 10 11 11 8.

const lines = (vm: NonNullable<ReturnType<typeof buildFieldStory>>) =>
  vm.entries.map((e) => `${e.label} · ${e.segs.map((x) => x.text).join('')}${e.scoreline ? ` [${e.scoreline}]` : ''}`)

describe('buildFieldStory', () => {
  it('tells the real Round 1, newest first', () => {
    const vm = buildFieldStory(reportDb(ROUND_ONE, { ctp: { 6: 2, 8: 2, 14: 2, 16: 1 }, status: 'in_progress' }))!
    expect(lines(vm)).toEqual([
      "18th · Chris takes a zero on the last, the first of the day. Jon makes a real eagle and Kyle and Adam birdie. Chris's lead is cut to 8. [Chris 44, Kyle 36, Jon 31, Adam 27]",
      '17th · Pars all round. Chris still leads by 11.',
      '16th · Chris makes a net birdie to lead by 11. Kyle wins the CTP.',
      '15th · Kyle and Chris make net birdies. Chris still leads by 10.',
      '14th · Pars all round. Chris still leads by 10. Adam wins a third CTP of the day.',
      '13th · Pars all round. Chris still leads by 10.',
      '12th · Kyle birdies for a net eagle and cuts the lead to 10.',
      '11th · Chris birdies for a net eagle to lead by 12, the biggest lead of the day.',
      '10th · Jon and Adam birdie. Chris still leads by 10.',
      'The turn ·  [Chris 25, Kyle 15, Jon 11, Adam 9]',
      '9th · Chris birdies for a net eagle and Kyle birdies. Chris leads by 10.',
      '8th · Jon and Chris birdie. Chris leads by 9. Adam wins a second CTP of the day.',
      // Gross 3 on the par-5 7th with no stroke: a REAL eagle. Everyone else 0.
      "7th · The hole that broke it open: Chris makes a real eagle while the other three take zeros. Chris's lead goes from 3 to 7.",
      '6th · Jon and Chris birdie. Chris leads by 3. Adam wins the CTP.',
      '3rd–5th · Chris birdies the 3rd and Kyle and Adam birdie the 4th. Chris leads by 2.',
      // The 2nd is a par with a stroke for Chris: a NET birdie.
      '2nd · Chris takes a 1-point lead with a net birdie. Jon takes a zero.',
      '1st · Kyle and Chris share the early lead.',
    ])
    expect(vm.entries.filter((e) => e.emphasis).map((e) => e.label)).toEqual(['7th', '2nd'])
  })

  it('a hole only part of the group has finished calls nothing', () => {
    const db = reportDb(ROUND_ONE, { status: 'in_progress' })
    // Kyle (1) and Chris (3) have the 12th; Jon and Adam do not.
    db.scores = db.scores.filter((sc) => sc.hole_number <= 11 || (sc.hole_number === 12 && /^0000000[13]/.test(sc.player_id)))
    const [first, second] = lines(buildFieldStory(db)!)
    expect(first).toBe('12th · Kyle and Chris in: Kyle birdies for a net eagle. Jon and Adam still to post.')
    // Live, the peak is only the biggest "so far".
    expect(second).toBe('11th · Chris birdies for a net eagle to lead by 12, the biggest lead so far.')
  })

  it('first names only, no em dashes', () => {
    const all = lines(buildFieldStory(reportDb(ROUND_ONE, { status: 'in_progress' }))!).join(' ')
    expect(all).not.toMatch(/Aronson|Siegel|Hersh|Denove|—/)
  })

  it('is null before any hole is saved', () => {
    const db = reportDb(ROUND_ONE, { status: 'in_progress' })
    db.scores = []
    expect(buildFieldStory(db)).toBeNull()
  })
})
