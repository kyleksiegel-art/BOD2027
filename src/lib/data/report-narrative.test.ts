import { describe, it, expect } from 'vitest'
import { buildRoundReport, decisiveStretch } from './report'
import { reportDb, ROUND_ONE, type FixturePlayer } from '@/test/reportFixture'

// The narrative round report (2026-10-02, Kyle picked "option A"). Every claim below is checked
// by hand against the points table in the fixture.

const body = (players: FixturePlayer[], ctp?: Record<number, number>) => {
  const vm = buildRoundReport(1, reportDb(players, { ctp }))!
  return { vm, text: vm.paragraphs.map((p) => p.map((s) => s.text).join('')) }
}
const par = (o: Record<number, number> = {}) => Array.from({ length: 18 }, (_, i) => o[i + 1] ?? 2)

describe('decisiveStretch', () => {
  it('takes the shortest window with three quarters of the biggest swing', () => {
    // Swings: +3 on 4, 5, 6 (9 over three holes) and +1 on 7. The max (10, holes 4–7) needs 8;
    // 4–6 delivers 9 in three holes, so it wins.
    const a = par({ 4: 4, 5: 4, 6: 4, 7: 3 })
    const b = par({ 4: 1, 5: 1, 6: 1 })
    expect(decisiveStretch(a, b, 18)).toEqual({ from: 4, to: 6, aPts: 12, bPts: 3, gapBefore: 0, gapAfter: 9 })
  })

  it('is null when nothing swings 4 points', () => {
    expect(decisiveStretch(par({ 3: 3, 9: 3, 15: 3 }), par(), 18)).toBeNull()
  })

  it('only looks after the given hole', () => {
    const a = par({ 2: 4, 3: 4, 16: 4, 17: 4 })
    const s = decisiveStretch(a, par(), 18, 10)!
    expect(s.from).toBeGreaterThan(10)
    expect([s.from, s.to, s.aPts - s.bPts]).toEqual([16, 18, 4])
  })
})

describe('buildRoundReport narrative', () => {
  it('the real Round 1: Chris runs away with the Red', () => {
    const { vm, text } = body(ROUND_ONE, { 6: 2, 8: 2, 14: 2, 16: 1 })
    expect(vm.kind).toBe('runaway')
    // Chris 2,3,3,1,2 | 3,4,3,4 vs Kyle 2,2,1,3,1 | 2,0,1,3: 14 to 6 over 6–9, lead 2 → 10.
    expect(vm.stretch).toEqual({ from: 6, to: 9, aPts: 14, bPts: 6, gapBefore: 2, gapAfter: 10 })
    expect(vm.headline).toBe('Chris runs away with the Red.')
    expect(text).toEqual([
      // 7th: gross 3 on a par 5 with no stroke = a real eagle. 9th: gross birdie + a stroke = net eagle.
      'It was close for five holes. Chris led Kyle by 2 after the 5th. Then the round broke open: a birdie on the 6th, a real eagle on the par-5 7th and a net eagle on the 9th. From the 6th through the 9th, Chris made 14 points to Kyle\'s 6, and the lead went from 2 to 10.',
      // Back nines: Kyle 21, Jon 20, Chris 19, Adam 18. Chris 0 on 18 after 1–17 all scoring. Peak 12, final 8.
      'Kyle had the best back nine in the group, 21 points, and Chris finally blanked the 18th after 17 straight holes with points. It only brought the final margin down to 8.',
      // Jon 1+0+1 = 2 through three, back 20, gross eagle on the par-5 18th. Adam gross birdies 4, 10, 18.
      'Jon opened with 2 points through three holes, then came home in 20 and finished with a real eagle on 18. Adam made three real birdies and won three of the four closest-to-pins, which pay exactly nothing.',
      'Chris leads the week by 8. The Blue tomorrow, three rounds to go.',
    ])
  })

  it('a late comeback is told from the low point, with like shots grouped', () => {
    const { vm, text } = body([
      { name: 'Jon Aronson', strokes: 0, pts: par({ 2: 3, 5: 3, 9: 3, 12: 3, 16: 0, 17: 1, 18: 1 }) },
      { name: 'Kyle Siegel', strokes: 4, pts: par({ 4: 1, 8: 1, 16: 3, 17: 3, 18: 4 }) },
      { name: 'Adam Hersh', strokes: 0, pts: par({ 3: 1, 10: 1, 13: 3 }) },
      { name: 'Chris Denove', strokes: 8, pts: par({ 6: 0, 11: 1, 14: 3 }) },
    ])
    expect(vm.kind).toBe('late')
    expect(vm.headline).toBe('Kyle catches Jon on the last.')
    expect(text[0]).toBe(
      "Jon led Kyle by 6 after the 15th. Kyle answered with birdies on the 16th and 17th and a real eagle on the par-5 18th. From the 16th through the 18th, Kyle made 10 points to Jon's 2, and a 6-point deficit became a 2-point lead.",
    )
  })

  it('a tie the countback cannot split is shared, never a win', () => {
    const { vm, text } = body([
      { name: 'Jon Aronson', strokes: 0, pts: par({ 3: 3, 7: 1 }) },
      { name: 'Kyle Siegel', strokes: 4, pts: par({ 4: 3, 8: 1 }) },
      { name: 'Adam Hersh', strokes: 0, pts: par({ 5: 1 }) },
      { name: 'Chris Denove', strokes: 8, pts: par({ 11: 1, 12: 1 }) },
    ])
    expect(vm.kind).toBe('shared')
    expect(vm.headline).toBe('Jon and Kyle share the Red.')
    expect(text[0]).toBe('Jon and Kyle finished level on 36 points, and the countback could not split them. The lead changed hands twice along the way.')
    expect(text.join(' ')).not.toMatch(/\bwon\b|\bwins\b|by 0/)
  })

  it('a countback win says countback, not "by 0"', () => {
    const { vm, text } = body([
      { name: 'Jon Aronson', strokes: 0, pts: par({ 3: 3, 12: 1, 15: 3 }) },
      { name: 'Kyle Siegel', strokes: 4, pts: par({ 2: 3, 7: 1, 13: 3, 16: 3, 17: 1 }) },
      { name: 'Adam Hersh', strokes: 0, pts: par({ 5: 0, 9: 3, 14: 1 }) },
      { name: 'Chris Denove', strokes: 8, pts: par({ 4: 1, 8: 1, 11: 0, 18: 3 }) },
    ])
    expect(vm.headline).toBe('Kyle edges Jon on countback.')
    expect(text[0]).toBe('Kyle and Jon finished level on 37 points, and Kyle took it on countback.')
    expect(text.join(' ')).not.toContain('by 0')
  })

  it('a corrected score rewrites the story', () => {
    // Chris's real eagle on the 7th becomes a par: the stretch, its shots and the margin all move.
    const corrected = ROUND_ONE.map((p) =>
      p.name === 'Chris Denove' ? { ...p, pts: p.pts.map((v, i) => (i === 6 ? 2 : v)) } : p,
    )
    const { vm, text } = body(corrected)
    expect(text.join(' ')).not.toContain('real eagle on the par-5 7th')
    expect(text.join(' ')).toContain('final margin down to 6')
    expect(vm.stretch?.aPts).not.toBe(14)
  })

  it('no em dashes, no surnames, in any story', () => {
    const scenarios: FixturePlayer[][] = [ROUND_ONE, ROUND_ONE.map((p, i) => ({ ...p, pts: par({ [i + 1]: 3 }) }))]
    for (const sc of scenarios) {
      const all = body(sc).text.join(' ') + body(sc).vm.headline
      expect(all).not.toContain('—')
      expect(all).not.toMatch(/Aronson|Siegel|Hersh|Denove/)
    }
  })
})
