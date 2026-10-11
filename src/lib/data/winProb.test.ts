import { describe, expect, it } from 'vitest'
import { buildOddsHistory, buildWinOdds } from './winProb'
import { formatOdds } from '@/lib/format'
import { reportDb, ROUND_ONE } from '@/test/reportFixture'
import type { Db } from './compute'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Round 1 live with only holes ≤ `thru` saved; the other three rounds still to play. */
function liveThrough(thru: number): Db {
  const db = reportDb(ROUND_ONE, { status: 'in_progress' })
  return { ...db, scores: db.scores.filter((s) => s.hole_number <= thru) }
}

describe('buildWinOdds', () => {
  it('splits 100% four ways, the same way every time', () => {
    const a = buildWinOdds(liveThrough(9))!
    const b = buildWinOdds(liveThrough(9))!
    expect(sum(a.rows.map((r) => r.pct))).toBeCloseTo(100, 6)
    expect(a.rows.map((r) => r.pct)).toEqual(b.rows.map((r) => r.pct))
  })

  it('starts level before a hole is saved', () => {
    const vm = buildWinOdds(liveThrough(0))!
    for (const r of vm.rows) expect(Math.abs(r.pct - 25)).toBeLessThan(3)
    expect(vm.sinceLabel).toBeNull()
  })

  it('makes the clear leader the favorite and says which hole moved it', () => {
    const vm = buildWinOdds(liveThrough(13))!
    expect(vm.rows[0].name).toBe('Chris')
    expect(vm.rows[0].pct).toBeGreaterThan(vm.rows[1].pct)
    expect(vm.sinceLabel).toBe('on the 13th')
    expect(vm.rows.every((r) => r.delta !== null)).toBe(true)
    expect(vm.holesLeft).toBe(5 + 54)
  })

  it('calls a player out who cannot catch the leader on the holes left', () => {
    const db = liveThrough(17)
    const rounds = db.rounds.map((r) => (r.round_number === 1 ? r : { ...r, status: 'abandoned' as const }))
    const vm = buildWinOdds({ ...db, rounds })!
    expect(vm.rows[0]).toMatchObject({ name: 'Chris', label: '100%' })
    expect(vm.rows.slice(1).every((r) => r.out && r.label === 'Out')).toBe(true)
  })

  it('has nothing to say before the week starts or once it is over', () => {
    const before = reportDb(ROUND_ONE, { status: 'upcoming' })
    expect(buildWinOdds(before)).toBeNull()
    const db = reportDb(ROUND_ONE)
    const over = { ...db, rounds: db.rounds.map((r) => ({ ...r, status: 'final' as const })) }
    expect(buildWinOdds(over)).toBeNull()
  })
})

describe('buildOddsHistory', () => {
  it('has a point per saved hole, starting level, and its biggest swings', () => {
    const vm = buildOddsHistory(liveThrough(13))!
    expect(vm.round!.points).toHaveLength(14)
    const start = vm.round!.points[0].pct
    for (const v of Object.values(start)) expect(Math.abs(v - 25)).toBeLessThan(4)
    expect(vm.round!.swings.length).toBeGreaterThan(0)
    expect(vm.round!.swings.length).toBeLessThanOrEqual(3)
    const moves = vm.round!.swings.map((s) => Math.abs(s.move))
    expect(moves).toEqual([...moves].sort((a, b) => b - a))
    expect(vm.round!.swings[0].text).toMatch(/^(Jon|Kyle|Adam|Chris) /)
    expect(vm.week.roundBreaks).toEqual([{ roundNumber: 1, courseName: 'Streamsong Red', index: 0 }])
  })

  it('lands where the board is now', () => {
    const vm = buildOddsHistory(liveThrough(18))!
    const last = vm.round!.points[vm.round!.points.length - 1].pct
    const chris = vm.players.find((p) => p.name === 'Chris')!
    expect(Math.abs(last[chris.playerId] - chris.pct)).toBeLessThan(3)
  })
})

describe('formatOdds', () => {
  it('never rounds a live chance to 0 or 100', () => {
    expect(formatOdds(0.4, false)).toBe('<1%')
    expect(formatOdds(99.6, false)).toBe('>99%')
    expect(formatOdds(0, true)).toBe('Out')
    expect(formatOdds(0, false)).toBe('<1%')
    expect(formatOdds(57.5, false)).toBe('58%')
  })
})
