import { describe, it, expect } from 'vitest'
import {
  buildItinerary,
  buildLodging,
  buildCoursesIndex,
  buildCourseDetail,
  buildPlayerCourseHandicaps,
  type Db,
} from './compute'
import type {
  PlayerRow,
  CourseRow,
  TeeRow,
  HoleRow,
  HoleYardageRow,
  RoundRow,
  RoundPlayerRow,
  ItineraryItemRow,
  LodgingRow,
  LodgingAssignmentRow,
} from './types'

// Minimal helpers. Only the fields each build function reads are populated; the casts keep
// the fixtures short without pretending every column exists.
const RED = 'c0000000-0000-0000-0000-0000000000red'
const BONE = 'c0000000-0000-0000-0000-000000000bone'
const TEE_BLACK = 't0000000-0000-0000-0000-00000000blk'
const TEE_GOLD = 't0000000-0000-0000-0000-0000000gold'
const R1 = 'r0000000-0000-0000-0000-000000000001'
const R4 = 'r0000000-0000-0000-0000-000000000004'
const KYLE = 'p0000000-0000-0000-0000-00000000kyle'
const JON = 'p0000000-0000-0000-0000-000000000jon'

function emptyDb(over: Partial<Db> = {}): Db {
  return {
    players: [],
    courses: [],
    tees: [],
    holes: [],
    hole_yardages: [],
    rounds: [],
    round_players: [],
    scores: [],
    ctp_results: [],
    settings: [],
    itinerary_items: [],
    lodging: [],
    lodging_assignments: [],
    ...over,
  }
}

describe('buildItinerary', () => {
  const items: ItineraryItemRow[] = [
    { id: 'i2', day: '2027-02-05', sort_order: 0, start_time: '2027-02-05T15:33:00-05:00', category: 'golf', title: 'Black tee time', detail: null, location: null },
    { id: 'i1', day: '2027-02-04', sort_order: 1, start_time: '2027-02-04T19:00:00-05:00', category: 'meal', title: 'Dinner', detail: 'Clubhouse', location: 'The Lodge' },
    { id: 'i0', day: '2027-02-04', sort_order: 0, start_time: null, category: 'travel', title: 'Arrive', detail: null, location: null },
  ]

  it('groups by day, sorts days ascending and items by sort_order', () => {
    const vm = buildItinerary(emptyDb({ itinerary_items: items }), '2027-02-05')
    expect(vm.isEmpty).toBe(false)
    expect(vm.days.map((d) => d.day)).toEqual(['2027-02-04', '2027-02-05'])
    // Feb 4: all-day "Arrive" (sort 0) before "Dinner" (sort 1)
    expect(vm.days[0].entries.map((e) => e.title)).toEqual(['Arrive', 'Dinner'])
    expect(vm.days[0].entries[0].time).toBeNull()
    expect(vm.days[0].entries[1].time).toBe('7:00 PM ET')
  })

  it('flags the current ET day and no other', () => {
    const vm = buildItinerary(emptyDb({ itinerary_items: items }), '2027-02-05')
    expect(vm.days.find((d) => d.day === '2027-02-05')!.isToday).toBe(true)
    expect(vm.days.find((d) => d.day === '2027-02-04')!.isToday).toBe(false)
  })

  it('is empty with no items', () => {
    expect(buildItinerary(emptyDb(), '2027-02-04').isEmpty).toBe(true)
  })
})

describe('buildLodging', () => {
  const players: PlayerRow[] = [
    { id: KYLE, name: 'Kyle', sort_order: 1 } as unknown as PlayerRow,
    { id: JON, name: 'Jon', sort_order: 0 } as unknown as PlayerRow,
  ]
  const lodging: LodgingRow[] = [
    { id: 'L1', property: 'The Lodge', check_in: '2027-02-04', check_out: '2027-02-08', confirmation: 'ABC', notes: null },
  ]
  const assigns: LodgingAssignmentRow[] = [
    { id: 'a1', lodging_id: 'L1', player_id: KYLE, room_label: '204' },
    { id: 'a2', lodging_id: 'L1', player_id: JON, room_label: '205' },
  ]

  it('joins assignments to players and orders by player sort_order', () => {
    const vm = buildLodging(emptyDb({ players, lodging, lodging_assignments: assigns }))
    expect(vm.properties).toHaveLength(1)
    const p = vm.properties[0]
    expect(p.nights).toBe(4)
    expect(p.assignments.map((a) => a.playerName)).toEqual(['Jon', 'Kyle'])
    expect(p.assignments[1].roomLabel).toBe('204')
  })

  it('is empty with no lodging', () => {
    expect(buildLodging(emptyDb()).isEmpty).toBe(true)
  })
})

describe('buildCoursesIndex', () => {
  const courses: CourseRow[] = [
    { id: BONE, name: 'Bone Valley', architect: 'Kidd', year_opened: 2024, description: '', data_is_placeholder: true },
    { id: RED, name: 'Red', architect: 'Coore & Crenshaw', year_opened: 2012, description: 'x', data_is_placeholder: false },
  ]
  const tees: TeeRow[] = [
    { id: TEE_BLACK, course_id: RED, name: 'Black', rating: 73.5, slope: 132, par: 72, total_yardage: 7100 },
    { id: TEE_GOLD, course_id: RED, name: 'Gold', rating: 71, slope: 128, par: 72, total_yardage: 6500 },
  ]
  const rounds: RoundRow[] = [
    { id: R1, round_number: 1, date: '2027-02-04', course_id: RED, tee_time: null, status: 'upcoming', holes_counted: null },
    { id: R4, round_number: 4, date: '2027-02-07', course_id: BONE, tee_time: null, status: 'upcoming', holes_counted: null },
  ]

  it('orders by the round that plays each and uses the longest tee for par/yardage', () => {
    const idx = buildCoursesIndex(emptyDb({ courses, tees, rounds }))
    expect(idx.map((c) => c.name)).toEqual(['Red', 'Bone Valley'])
    expect(idx[0].roundNumber).toBe(1)
    expect(idx[0].par).toBe(72)
    expect(idx[0].totalYardage).toBe(7100) // longest tee
    expect(idx[1].isPlaceholder).toBe(true)
    expect(idx[1].par).toBeNull() // no tees on Bone Valley
  })
})

describe('buildCourseDetail', () => {
  const courses: CourseRow[] = [
    { id: RED, name: 'Red', architect: 'Coore & Crenshaw', year_opened: 2012, description: 'desc', data_is_placeholder: false },
  ]
  const tees: TeeRow[] = [
    { id: TEE_BLACK, course_id: RED, name: 'Black', rating: 73.5, slope: 132, par: 72, total_yardage: 7100 },
    { id: TEE_GOLD, course_id: RED, name: 'Gold', rating: 71, slope: 128, par: 72, total_yardage: 6500 },
  ]
  const holes: HoleRow[] = Array.from({ length: 18 }, (_, i) => ({
    id: `${RED}-h${i + 1}`,
    course_id: RED,
    hole_number: i + 1,
    par: 4,
    stroke_index: i + 1,
  }))
  const yardages: HoleYardageRow[] = holes.flatMap((h) => [
    { hole_id: h.id, tee_id: TEE_BLACK, yardage: 400 },
    { hole_id: h.id, tee_id: TEE_GOLD, yardage: 360 },
  ])

  it('returns 18 holes with a yardage per tee, and front/back par sums', () => {
    const vm = buildCourseDetail(RED, emptyDb({ courses, tees, holes, hole_yardages: yardages }))!
    expect(vm.holes).toHaveLength(18)
    expect(vm.tees.map((t) => t.name)).toEqual(['Black', 'Gold']) // longest first
    expect(vm.holes[0].yardageByTee[TEE_BLACK]).toBe(400)
    expect(vm.tees[0].frontPar).toBe(36)
    expect(vm.tees[0].frontYardage).toBe(9 * 400)
    expect(vm.tees[0].backYardage).toBe(9 * 400)
  })

  it('returns null for an unknown course', () => {
    expect(buildCourseDetail('nope', emptyDb({ courses }))).toBeNull()
  })
})

describe('buildPlayerCourseHandicaps', () => {
  // rating 72 / slope 113 / par 72 ⇒ course handicap == index (per-player, pre-low).
  const players: PlayerRow[] = [
    { id: KYLE, name: 'Kyle', handicap_index: 12, sort_order: 0 } as unknown as PlayerRow,
    { id: JON, name: 'Jon', handicap_index: 8, sort_order: 1 } as unknown as PlayerRow,
  ]
  const courses: CourseRow[] = [
    { id: RED, name: 'Red', data_is_placeholder: false } as unknown as CourseRow,
  ]
  const tees: TeeRow[] = [
    { id: TEE_GOLD, course_id: RED, name: 'Gold', rating: 72, slope: 113, par: 72, total_yardage: 6500 },
  ]
  const rounds: RoundRow[] = [
    { id: R1, round_number: 1, date: '2027-02-04', course_id: RED, tee_time: null, status: 'in_progress', holes_counted: null },
  ]
  function rp(playerId: string, status: RoundPlayerRow['status'] = 'playing'): RoundPlayerRow {
    return {
      round_id: R1, player_id: playerId, tee_id: TEE_GOLD, index_used: 0,
      allowance_used: 1, cap_used: 18, course_handicap: 0, playing_handicap: 0,
      cap_applied: false, strokes_received: 0, manual_override: null, status,
    }
  }

  it('computes each player’s playing handicap live from their index, not the round low', () => {
    const map = buildPlayerCourseHandicaps(
      emptyDb({ players, courses, tees, rounds, round_players: [rp(KYLE), rp(JON)] }),
    )
    expect(map.get(KYLE)![0].playingHandicap).toBe(12) // own handicap, NOT 12−8
    expect(map.get(JON)![0].playingHandicap).toBe(8)
    expect(map.get(KYLE)![0].courseName).toBe('Red')
  })

  it('marks a did-not-play round and leaves the handicap null', () => {
    const map = buildPlayerCourseHandicaps(
      emptyDb({ players, courses, tees, rounds, round_players: [rp(KYLE, 'did_not_play')] }),
    )
    expect(map.get(KYLE)![0].didNotPlay).toBe(true)
    expect(map.get(KYLE)![0].playingHandicap).toBeNull()
    // Jon has no round_players row at all → null, not DNP
    expect(map.get(JON)![0].playingHandicap).toBeNull()
    expect(map.get(JON)![0].didNotPlay).toBe(false)
  })
})
