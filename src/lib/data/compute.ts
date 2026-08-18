// Pure assembly: raw Dexie rows in, view models out. No React, no Dexie, no network here —
// so it is trivially testable and identical online or off. Every derived number (net,
// points, standings, projection, the handicap worksheet) comes from src/lib/scoring; this
// module only shapes inputs and orders outputs. It never recomputes scoring math inline.
import {
  DEFAULT_POINTS_TABLE,
  computeHandicap,
  allocateStrokes,
  computePlayerRound,
  computeProjection,
  computeStandings,
  standingsThroughRound,
  resolveStrokesReceived,
} from '@/lib/scoring'
import type {
  HoleInfo,
  HoleScore,
  HoleResult,
  HandicapResult,
  PointsTable,
  PlayerChampionship,
  RoundPointsEntry,
  StandingRow,
} from '@/lib/scoring'
import type {
  PlayerRow,
  CourseRow,
  TeeRow,
  HoleRow,
  HoleYardageRow,
  RoundRow,
  RoundPlayerRow,
  ScoreRow,
  SettingRow,
} from './types'

// ── Shared lookups ───────────────────────────────────────────────────────────
export interface Db {
  players: PlayerRow[]
  courses: CourseRow[]
  tees: TeeRow[]
  holes: HoleRow[]
  hole_yardages: HoleYardageRow[]
  rounds: RoundRow[]
  round_players: RoundPlayerRow[]
  scores: ScoreRow[]
  settings: SettingRow[]
}

export function pointsTableOf(settings: SettingRow[]): PointsTable {
  const row = settings.find((s) => s.key === 'points_table')
  if (!row || typeof row.value !== 'object' || row.value === null) return DEFAULT_POINTS_TABLE
  return { ...DEFAULT_POINTS_TABLE, ...(row.value as Partial<PointsTable>) }
}

/** The 18 HoleInfo for a course, or null when the card is not fully published (Bone Valley). */
export function holeInfosOf(courseId: string, holes: HoleRow[]): HoleInfo[] | null {
  const rows = holes
    .filter((h) => h.course_id === courseId)
    .sort((a, b) => a.hole_number - b.hole_number)
  if (rows.length !== 18) return null
  const infos: HoleInfo[] = []
  for (const r of rows) {
    if (r.par === null || r.stroke_index === null) return null
    infos.push({ holeNumber: r.hole_number, par: r.par, strokeIndex: r.stroke_index })
  }
  return infos
}

function scoreMap(scores: ScoreRow[], roundId: string, playerId: string): Map<number, HoleScore> {
  const m = new Map<number, HoleScore>()
  for (const s of scores) {
    if (s.round_id !== roundId || s.player_id !== playerId) continue
    m.set(s.hole_number, {
      holeNumber: s.hole_number,
      grossStrokes: s.gross_strokes,
      pickedUp: s.picked_up,
    })
  }
  return m
}

// ── Per-round view model ─────────────────────────────────────────────────────
export interface Worksheet {
  result: HandicapResult
  overrideApplied: boolean
  strokesReceivedFinal: number // what strokes were actually allocated (override wins)
}

export interface PlayerRoundVM {
  playerId: string
  name: string
  sortOrder: number
  status: 'playing' | 'did_not_play'
  teeName: string
  worksheet: Worksheet | null
  holeResults: HoleResult[] // within the counted window; empty for DNP
  totalPoints: number
  thru: number
  projection: number | null // live projected round points; null when not applicable
}

export interface RoundDetailVM {
  round: RoundRow
  course: CourseRow
  holes: HoleInfo[] | null // null when the card is a placeholder (Bone Valley)
  holesCounted: number // effective cutoff (18 when full)
  isShortened: boolean
  players: PlayerRoundVM[] // scorecard-column order (by player sort_order)
  leaderboard: PlayerRoundVM[] // ranked by this round's points (playing only), desc
  parByHole: Map<number, number>
}

export function buildRoundDetail(roundNumber: number, dbData: Db): RoundDetailVM | null {
  const round = dbData.rounds.find((r) => r.round_number === roundNumber)
  if (!round) return null
  const course = dbData.courses.find((c) => c.id === round.course_id)
  if (!course) return null

  const table = pointsTableOf(dbData.settings)
  const holes = holeInfosOf(course.id, dbData.holes)
  const cutoff = round.holes_counted ?? 18
  const parByHole = new Map<number, number>()
  if (holes) for (const h of holes) parByHole.set(h.holeNumber, h.par)

  const rps = dbData.round_players.filter((rp) => rp.round_id === round.id)
  const playersById = new Map(dbData.players.map((p) => [p.id, p]))
  const teesById = new Map(dbData.tees.map((t) => [t.id, t]))

  const players: PlayerRoundVM[] = rps.map((rp) => {
    const player = playersById.get(rp.player_id)
    const tee = teesById.get(rp.tee_id) as TeeRow | undefined
    const name = player?.name ?? 'Unknown'
    const sortOrder = player?.sort_order ?? 999

    // The handicap worksheet is re-derived from the stored inputs (index/allowance/cap +
    // tee rating/slope/par), reproducing the snapshot exactly — audit trail, not a second
    // source of truth. A manual override replaces the allocated strokes.
    let worksheet: Worksheet | null = null
    let strokesReceived = rp.strokes_received
    if (tee) {
      const result = computeHandicap({
        index: rp.index_used,
        rating: tee.rating,
        slope: tee.slope,
        par: tee.par,
        allowancePct: rp.allowance_used,
        cap: rp.cap_used,
      })
      const resolved = resolveStrokesReceived(result.strokesReceived, rp.manual_override)
      strokesReceived = resolved.value
      worksheet = { result, overrideApplied: resolved.overrideApplied, strokesReceivedFinal: resolved.value }
    }

    if (!holes || rp.status === 'did_not_play') {
      return {
        playerId: rp.player_id,
        name,
        sortOrder,
        status: rp.status,
        teeName: tee?.name ?? '—',
        worksheet,
        holeResults: [],
        totalPoints: 0,
        thru: 0,
        projection: null,
      }
    }

    const alloc = allocateStrokes(strokesReceived, holes)
    const scores = scoreMap(dbData.scores, round.id, rp.player_id)
    const rr = computePlayerRound({
      holes,
      scores,
      strokesByHole: alloc,
      status: 'playing',
      pointsTable: table,
      holesCounted: round.holes_counted,
    })
    const projection =
      round.status === 'in_progress'
        ? computeProjection(rr.totalPoints, rr.holesCompleted, 'playing')
        : null

    return {
      playerId: rp.player_id,
      name,
      sortOrder,
      status: 'playing',
      teeName: tee?.name ?? '—',
      worksheet,
      holeResults: rr.holeResults,
      totalPoints: rr.totalPoints,
      thru: rr.holesCompleted,
      projection,
    }
  })

  players.sort((a, b) => a.sortOrder - b.sortOrder)
  const leaderboard = players
    .filter((p) => p.status === 'playing')
    .slice()
    .sort((a, b) => b.totalPoints - a.totalPoints || a.sortOrder - b.sortOrder)

  return {
    round,
    course,
    holes,
    holesCounted: cutoff,
    isShortened: round.holes_counted !== null && round.holes_counted < 18,
    players,
    leaderboard,
    parByHole,
  }
}

// ── Championship standings ───────────────────────────────────────────────────
export interface StandingVM extends StandingRow {
  name: string
  sortOrder: number
  byRound: RoundPointsEntry[] // per-round points, aligned to StandingsVM.roundColumns
}

export interface RoundColumn {
  roundNumber: number
  status: RoundRow['status']
  counts: boolean
}

/** A player's counted points for one round (0 for DNP / unfinished). */
function roundPointsFor(round: RoundRow, playerId: string, dbData: Db, table: PointsTable): number {
  const rp = dbData.round_players.find((r) => r.round_id === round.id && r.player_id === playerId)
  if (!rp || rp.status === 'did_not_play') return 0
  const course = dbData.courses.find((c) => c.id === round.course_id)
  if (!course) return 0
  const holes = holeInfosOf(course.id, dbData.holes)
  if (!holes) return 0
  const resolved = resolveStrokesReceived(rp.strokes_received, rp.manual_override)
  const alloc = allocateStrokes(resolved.value, holes)
  const scores = scoreMap(dbData.scores, round.id, playerId)
  return computePlayerRound({
    holes,
    scores,
    strokesByHole: alloc,
    status: 'playing',
    pointsTable: table,
    holesCounted: round.holes_counted,
  }).totalPoints
}

export function buildChampionships(dbData: Db): PlayerChampionship[] {
  const table = pointsTableOf(dbData.settings)
  const rounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  return dbData.players
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => {
      const byRound: RoundPointsEntry[] = rounds.map((round) => ({
        roundNumber: round.round_number,
        status: round.status,
        points: roundPointsFor(round, p.id, dbData, table),
        // The overall board is INCLUSIVE of the round in play: the live `in_progress`
        // round's points count toward the cumulative total as they currently stand
        // (Kyle, Phase 4 feedback — overrides the Phase 3 "final only" default). Nothing
        // jumps when it finalizes; the points were already there. Upcoming/abandoned never
        // count.
        counts: round.status === 'final' || round.status === 'in_progress',
      }))
      return { playerId: p.id, byRound }
    })
}

export interface StandingsVM {
  rows: StandingVM[]
  roundColumns: RoundColumn[] // every round, in order, for the breakdown matrix
  countingRoundNumbers: number[] // rounds that feed the total (final + the live round)
  liveRoundNumbers: number[] // in_progress rounds included provisionally
  hasCountingRound: boolean
}

export function buildStandings(dbData: Db): StandingsVM {
  const champs = buildChampionships(dbData)
  const byRoundByPlayer = new Map(champs.map((c) => [c.playerId, c.byRound]))
  const nameById = new Map(dbData.players.map((p) => [p.id, p]))

  const counts = (s: RoundRow['status']) => s === 'final' || s === 'in_progress'

  const orderedRounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  const roundColumns: RoundColumn[] = orderedRounds.map((r) => ({
    roundNumber: r.round_number,
    status: r.status,
    counts: counts(r.status),
  }))

  const countingRoundNumbers = orderedRounds.filter((r) => counts(r.status)).map((r) => r.round_number)
  const liveRoundNumbers = orderedRounds
    .filter((r) => r.status === 'in_progress')
    .map((r) => r.round_number)

  // Position change is movement between the two most recent counting rounds.
  let previousPositions: Map<string, number> | undefined
  if (countingRoundNumbers.length >= 2) {
    const prevThrough = countingRoundNumbers[countingRoundNumbers.length - 2]
    const prev = standingsThroughRound(champs, prevThrough)
    previousPositions = new Map(prev.map((r) => [r.playerId, r.position]))
  }

  const rows = computeStandings(champs, previousPositions).map((r) => {
    const p = nameById.get(r.playerId)
    return {
      ...r,
      name: p?.name ?? 'Unknown',
      sortOrder: p?.sort_order ?? 999,
      byRound: byRoundByPlayer.get(r.playerId) ?? [],
    }
  })

  return {
    rows,
    roundColumns,
    countingRoundNumbers,
    liveRoundNumbers,
    hasCountingRound: countingRoundNumbers.length > 0,
  }
}

// ── Rounds list ──────────────────────────────────────────────────────────────
export interface RoundListItemVM {
  round: RoundRow
  course: CourseRow
  leaderName: string | null // current leader for in_progress/final rounds
  playerCount: number
}

export function buildRoundsList(dbData: Db): RoundListItemVM[] {
  const coursesById = new Map(dbData.courses.map((c) => [c.id, c]))
  return dbData.rounds
    .slice()
    .sort((a, b) => a.round_number - b.round_number)
    .map((round) => {
      const course = coursesById.get(round.course_id)!
      const detail =
        round.status === 'final' || round.status === 'in_progress'
          ? buildRoundDetail(round.round_number, dbData)
          : null
      const leader = detail?.leaderboard[0]
      return {
        round,
        course,
        leaderName: leader && leader.totalPoints > 0 ? leader.name : null,
        playerCount: dbData.round_players.filter((rp) => rp.round_id === round.id && rp.status === 'playing').length,
      }
    })
}

// ── Score entry ──────────────────────────────────────────────────────────────
export interface EnterPlayerVM {
  playerId: string
  name: string
  status: 'playing' | 'did_not_play'
  strokesOnHole: number // allocated to THIS hole; negative for a plus handicap
  gross: number | null
  pickedUp: boolean
  /** null when nothing has been entered — the difference between "0 points" and "blank". */
  points: number | null
  netToPar: number | null
  thru: number
  roundPoints: number
}

export interface EnterHoleVM {
  holeNumber: number
  par: number
  strokeIndex: number
  yardage: number | null
  teeName: string | null
}

export interface EnterVM {
  round: RoundRow
  course: CourseRow
  /**
   * Non-null means score entry is HARD blocked, with the specific reasons to show. The
   * server refuses these writes too (rpc_upsert_scores) — this is the humane half.
   */
  blocked: { reason: 'course_card_incomplete' | 'round_upcoming'; issues: string[] } | null
  /** Players with no round_players row: they cannot be scored until one is created. */
  missingRoundPlayers: string[]
  hole: EnterHoleVM | null
  players: EnterPlayerVM[]
  /** This round's standing so far, best first — the Enter screen footer. */
  standing: { name: string; points: number; thru: number }[]
  /** Holes with at least one entered or picked-up cell, for the hole picker. */
  holesWithEntries: number[]
}

/**
 * Everything a course card must satisfy before it can be scored, as a list of what is
 * still missing. Mirrors rpc_validate_and_publish_course's checks so the Enter screen can
 * say what is wrong instead of just refusing.
 */
export function courseCardIssues(courseId: string, dbData: Db): string[] {
  const issues: string[] = []
  const holes = dbData.holes
    .filter((h) => h.course_id === courseId)
    .sort((a, b) => a.hole_number - b.hole_number)

  if (holes.length !== 18) issues.push(`Only ${holes.length} of 18 holes exist`)

  const noPar = holes.filter((h) => h.par === null).length
  if (noPar > 0) issues.push(`Par is not set on ${noPar} hole${noPar === 1 ? '' : 's'}`)

  const noSi = holes.filter((h) => h.stroke_index === null).length
  if (noSi > 0) issues.push(`Stroke index is not set on ${noSi} hole${noSi === 1 ? '' : 's'}`)

  const sis = holes.map((h) => h.stroke_index).filter((n): n is number => n !== null)
  if (noSi === 0 && holes.length === 18 && new Set(sis).size !== 18) {
    issues.push('Stroke indexes are not a complete 1–18 set')
  }

  const holeIds = new Set(holes.map((h) => h.id))
  const tees = dbData.tees.filter((t) => t.course_id === courseId)
  if (tees.length === 0) issues.push('The course has no tees')
  for (const tee of tees) {
    const known = dbData.hole_yardages.filter(
      (y) => y.tee_id === tee.id && y.yardage !== null && holeIds.has(y.hole_id),
    ).length
    if (known < holes.length) issues.push(`${tee.name} tees are missing yardages`)
    // Publishing is what unblocks scoring, and a null slope silently falls back to 113 —
    // every player would get a quietly wrong stroke allocation. Mirrors the same check in
    // rpc_validate_and_publish_course.
    if (tee.rating === null || tee.slope === null) {
      issues.push(`${tee.name} tees have no course rating or slope`)
    }
  }

  return issues
}

/**
 * An un-acknowledged local edit, keyed by player id. The Enter screen holds these while a
 * debounced write is in flight so the steppers respond to a tap instantly instead of a
 * round-trip later (two fast taps must move a 4 to a 6, not to a 5).
 *
 * They are overlaid HERE, in the pure layer, rather than patched over the rendered
 * numbers: points, "thru" and the round standing then all derive from the draft through
 * the scoring engine, so an optimistic hole is arithmetically consistent with a saved one.
 */
export interface EnterDraft {
  grossStrokes: number | null
  pickedUp: boolean
}

function withDrafts(
  dbData: Db,
  roundId: string,
  holeNumber: number,
  drafts: Record<string, EnterDraft>,
): Db {
  const ids = Object.keys(drafts)
  if (ids.length === 0) return dbData
  const drafted = new Set(ids)
  const scores = dbData.scores.filter(
    (s) =>
      !(s.round_id === roundId && s.hole_number === holeNumber && drafted.has(s.player_id)),
  )
  for (const playerId of ids) {
    const d = drafts[playerId]
    scores.push({
      // Never persisted — this Db copy lives for one render.
      id: `draft:${roundId}:${playerId}:${holeNumber}`,
      round_id: roundId,
      player_id: playerId,
      hole_number: holeNumber,
      gross_strokes: d.grossStrokes,
      picked_up: d.pickedUp,
    })
  }
  return { ...dbData, scores }
}

export function buildEnterHole(
  roundNumber: number,
  holeNumber: number,
  rawDb: Db,
  drafts: Record<string, EnterDraft> = {},
): EnterVM | null {
  const round = rawDb.rounds.find((r) => r.round_number === roundNumber)
  if (!round) return null
  const course = rawDb.courses.find((c) => c.id === round.course_id)
  if (!course) return null

  const dbData = withDrafts(rawDb, round.id, holeNumber, drafts)

  // The Round 4 hard block. `data_is_placeholder` is the flag only
  // rpc_validate_and_publish_course may clear, so it is the honest gate; the issue list
  // is what to go fix.
  let blocked: EnterVM['blocked'] = null
  if (course.data_is_placeholder) {
    blocked = { reason: 'course_card_incomplete', issues: courseCardIssues(course.id, dbData) }
  } else if (round.status === 'upcoming') {
    blocked = { reason: 'round_upcoming', issues: [] }
  }

  const detail = buildRoundDetail(roundNumber, dbData)
  const rps = dbData.round_players.filter((rp) => rp.round_id === round.id)
  const havePlayer = new Set(rps.map((rp) => rp.player_id))
  const missingRoundPlayers = dbData.players
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((p) => !havePlayer.has(p.id))
    .map((p) => p.name)

  // Yardage is per tee, so it is only meaningful when the field shares one. When they
  // split tees the number would be a lie, so show none rather than an arbitrary tee's.
  let hole: EnterHoleVM | null = null
  const holeRow = dbData.holes.find(
    (h) => h.course_id === course.id && h.hole_number === holeNumber,
  )
  if (holeRow && holeRow.par !== null && holeRow.stroke_index !== null) {
    const teeIds = new Set(rps.filter((rp) => rp.status === 'playing').map((rp) => rp.tee_id))
    const soleTee = teeIds.size === 1 ? dbData.tees.find((t) => t.id === [...teeIds][0]) : undefined
    const yardage = soleTee
      ? (dbData.hole_yardages.find((y) => y.hole_id === holeRow.id && y.tee_id === soleTee.id)
          ?.yardage ?? null)
      : null
    hole = {
      holeNumber,
      par: holeRow.par,
      strokeIndex: holeRow.stroke_index,
      yardage,
      teeName: soleTee?.name ?? null,
    }
  }

  const players: EnterPlayerVM[] = (detail?.players ?? []).map((p) => {
    const hr = p.holeResults.find((h) => h.holeNumber === holeNumber)
    return {
      playerId: p.playerId,
      name: p.name,
      status: p.status,
      strokesOnHole: hr?.strokesReceived ?? 0,
      gross: hr?.grossStrokes ?? null,
      pickedUp: hr?.pickedUp ?? false,
      points: hr?.completed ? (hr.points ?? 0) : null,
      netToPar: hr?.netToPar ?? null,
      thru: p.thru,
      roundPoints: p.totalPoints,
    }
  })

  const entered = new Set<number>()
  for (const s of dbData.scores) {
    if (s.round_id !== round.id) continue
    if (s.gross_strokes !== null || s.picked_up) entered.add(s.hole_number)
  }

  return {
    round,
    course,
    blocked,
    missingRoundPlayers,
    hole,
    players,
    standing: (detail?.leaderboard ?? []).map((p) => ({
      name: p.name,
      points: p.totalPoints,
      thru: p.thru,
    })),
    holesWithEntries: [...entered].sort((a, b) => a - b),
  }
}

// ── Admin (Phase 5B) ─────────────────────────────────────────────────────────
// /admin edits the rows every other screen derives from, so its view model is deliberately
// close to the raw tables — an editor that shows a prettified version of what it is about
// to overwrite is how you save the wrong thing. The only derived values here are the ones
// the admin needs in order to decide: what a card is still missing, what a handicap
// currently computes to, and who is short of holes before a round can be finalized.

export interface AdminCourseVM {
  course: CourseRow
  tees: TeeRow[]
  /** Always 18 entries, hole 1..18, even where no row exists yet (Bone Valley). */
  holes: { holeNumber: number; row: HoleRow | null }[]
  /** `${holeId}|${teeId}` -> yardage. Flat so React can compare it cheaply. */
  yardages: Record<string, number | null>
  /** Mirror of rpc_validate_and_publish_course's checks. Empty means publishable. */
  issues: string[]
}

export interface AdminParticipantVM {
  playerId: string
  name: string
  row: RoundPlayerRow | null
  /** Holes 1..18 with neither a gross score nor a picked-up flag. */
  missingHoles: number
  thru: number
}

export interface AdminRoundVM {
  round: RoundRow
  course: CourseRow
  tees: TeeRow[]
  participants: AdminParticipantVM[]
  /** Why this round cannot start yet, if it cannot. Mirrors rpc_start_round. */
  startIssues: string[]
}

export interface AdminSettingsVM {
  pointsTable: PointsTable
  allowance: number
  handicapCap: number
  purseMode: string
  purseWeights: { championship: number; roundWinners: number; ctp: number }
  purseAmounts: { buy_in_per_player_cents?: number; fixed_cents?: Record<string, number> }
  ctpCarryMode: string
  assignedIndexFootnote: string
}

export interface AdminVM {
  players: PlayerRow[]
  courses: AdminCourseVM[]
  rounds: AdminRoundVM[]
  settings: AdminSettingsVM
}

function settingValue<T>(settings: SettingRow[], key: string, fallback: T): T {
  const row = settings.find((s) => s.key === key)
  return row === undefined || row.value === null ? fallback : (row.value as T)
}

export function buildAdmin(dbData: Db): AdminVM {
  const coursesById = new Map(dbData.courses.map((c) => [c.id, c]))
  const playersById = new Map(dbData.players.map((p) => [p.id, p]))

  const courses: AdminCourseVM[] = dbData.courses
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((course) => {
      const holeRows = dbData.holes.filter((h) => h.course_id === course.id)
      const byNumber = new Map(holeRows.map((h) => [h.hole_number, h]))
      const tees = dbData.tees
        .filter((t) => t.course_id === course.id)
        .sort((a, b) => (b.total_yardage ?? 0) - (a.total_yardage ?? 0) || a.name.localeCompare(b.name))

      const holeIds = new Set(holeRows.map((h) => h.id))
      const yardages: Record<string, number | null> = {}
      for (const y of dbData.hole_yardages) {
        if (holeIds.has(y.hole_id)) yardages[`${y.hole_id}|${y.tee_id}`] = y.yardage
      }

      return {
        course,
        tees,
        holes: Array.from({ length: 18 }, (_, i) => ({
          holeNumber: i + 1,
          row: byNumber.get(i + 1) ?? null,
        })),
        yardages,
        issues: courseCardIssues(course.id, dbData),
      }
    })

  const rounds: AdminRoundVM[] = dbData.rounds
    .slice()
    .sort((a, b) => a.round_number - b.round_number)
    .map((round) => {
      const course = coursesById.get(round.course_id)!
      const rps = dbData.round_players.filter((rp) => rp.round_id === round.id)
      const rpByPlayer = new Map(rps.map((rp) => [rp.player_id, rp]))

      // Every player gets a row, assigned or not: the pre-flight screen's whole job is
      // making an unassigned player impossible to miss.
      const participants: AdminParticipantVM[] = dbData.players
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((p) => {
          const entered = new Set(
            dbData.scores
              .filter(
                (s) =>
                  s.round_id === round.id &&
                  s.player_id === p.id &&
                  (s.gross_strokes !== null || s.picked_up),
              )
              .map((s) => s.hole_number),
          )
          const row = rpByPlayer.get(p.id) ?? null
          // A did_not_play participant owes no holes — the same exclusion the scoring
          // engine and rpc_finalize_round apply.
          const owes = row !== null && row.status === 'playing'
          return {
            playerId: p.id,
            name: playersById.get(p.id)?.name ?? 'Player',
            row,
            missingHoles: owes ? 18 - entered.size : 0,
            thru: entered.size,
          }
        })

      const startIssues: string[] = []
      if (course.data_is_placeholder) startIssues.push('The course card is not published yet')
      if (rps.length === 0) startIssues.push('No tees or handicaps are set for this round')

      return { round, course, tees: dbData.tees.filter((t) => t.course_id === course.id), participants, startIssues }
    })

  return {
    players: dbData.players.slice().sort((a, b) => a.sort_order - b.sort_order),
    courses,
    rounds,
    settings: {
      pointsTable: pointsTableOf(dbData.settings),
      allowance: settingValue(dbData.settings, 'allowance', 1),
      handicapCap: settingValue(dbData.settings, 'handicap_cap', 18),
      purseMode: settingValue(dbData.settings, 'purse_mode', 'buyin'),
      purseWeights: settingValue(dbData.settings, 'purse_weights', {
        championship: 0.4,
        roundWinners: 0.3,
        ctp: 0.3,
      }),
      purseAmounts: settingValue(dbData.settings, 'purse_amounts', {}),
      ctpCarryMode: settingValue(dbData.settings, 'ctp_carry_mode', 'carry'),
      assignedIndexFootnote: settingValue(dbData.settings, 'assigned_index_footnote', ''),
    },
  }
}
