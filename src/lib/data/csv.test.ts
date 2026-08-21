import { describe, expect, it } from 'vitest'
import { scoresToCsv } from './csv'

describe('scoresToCsv', () => {
  const payload = {
    players: [
      { id: 'p1', name: 'Jon Aronson' },
      { id: 'p2', name: 'Kyle Siegel' },
    ],
    courses: [{ id: 'c1', name: 'Red' }],
    rounds: [{ id: 'r1', round_number: 1, course_id: 'c1', date: '2027-02-04' }],
    scores: [
      { round_id: 'r1', player_id: 'p2', hole_number: 2, gross_strokes: 5, picked_up: false },
      { round_id: 'r1', player_id: 'p1', hole_number: 1, gross_strokes: 4, picked_up: false },
      { round_id: 'r1', player_id: 'p1', hole_number: 3, gross_strokes: null, picked_up: true },
    ],
  }

  it('resolves names and sorts round → player → hole', () => {
    const lines = scoresToCsv(payload).split('\r\n')
    expect(lines[0]).toBe('round,course,date,player,hole,gross_strokes,picked_up')
    // Jon before Kyle; Jon's holes in order; a picked-up hole has an empty gross.
    expect(lines[1]).toBe('1,Red,2027-02-04,Jon Aronson,1,4,false')
    expect(lines[2]).toBe('1,Red,2027-02-04,Jon Aronson,3,,true')
    expect(lines[3]).toBe('1,Red,2027-02-04,Kyle Siegel,2,5,false')
  })

  it('quotes a field that contains a comma', () => {
    const csv = scoresToCsv({
      ...payload,
      players: [{ id: 'p1', name: 'Aronson, Jon' }],
      scores: [{ round_id: 'r1', player_id: 'p1', hole_number: 1, gross_strokes: 4, picked_up: false }],
    })
    expect(csv.split('\r\n')[1]).toContain('"Aronson, Jon"')
  })

  it('is empty-safe', () => {
    expect(scoresToCsv({})).toBe('round,course,date,player,hole,gross_strokes,picked_up')
  })
})
