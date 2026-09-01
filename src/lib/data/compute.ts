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
  tallyHolesWon,
  compareOverall,
  DEFAULT_COUNTBACK_ROUND_ORDER,
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
  HoleNetCell,
  CountbackRound,
  CountbackContext,
  OverallTiebreakContext,
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
  CtpResultRow,
  SettingRow,
  ItineraryItemRow,
  LodgingRow,
  LodgingAssignmentRow,
  ItinCategory,
} from './types'
import { formatDay, formatDayLong, formatTeeTime, etDateString } from '@/lib/format'

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
  ctp_results: CtpResultRow[]
  settings: SettingRow[]
  // Info reference tables (Phase 8). Optional so the many scoring-only test fixtures that
  // predate them still satisfy Db; the build functions treat an absent table as empty.
  itinerary_items?: ItineraryItemRow[]
  lodging?: LodgingRow[]
  lodging_assignments?: LodgingAssignmentRow[]
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
  strokesReceivedFinal: number // strokes actually allocated: own strokes minus the field low
  ownStrokes: number // this player's own strokes (post cap/override), before the low subtraction
  fieldLowest: number // the round field's lowest strokes, subtracted from everyone (low = scratch)
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

  // Pass 1 — each player's OWN strokes received. The handicap index is read LIVE from the
  // player (not a per-round snapshot): editing a player's index applies everywhere at once,
  // which is the whole point of the simplified Players/Rounds screens. Allowance and cap are
  // still the values captured on the round_players row. `rp.index_used` remains only as the
  // fallback when a player row is somehow missing.
  const prelim = rps.map((rp) => {
    const player = playersById.get(rp.player_id)
    const tee = teesById.get(rp.tee_id) as TeeRow | undefined
    let result: HandicapResult | null = null
    let ownStrokes = rp.strokes_received
    let overrideApplied = false
    if (tee) {
      result = computeHandicap({
        index: player?.handicap_index ?? rp.index_used,
        rating: tee.rating,
        slope: tee.slope,
        par: tee.par,
        allowancePct: rp.allowance_used,
        cap: rp.cap_used,
      })
      const resolved = resolveStrokesReceived(result.strokesReceived, rp.manual_override)
      ownStrokes = resolved.value
      overrideApplied = resolved.overrideApplied
    }
    return { rp, player, tee, result, ownStrokes, overrideApplied }
  })

  // This trip plays off the low handicap: the field's lowest strokes is scratch and everyone
  // else receives only the difference (Kyle 2026-08-22 — see decisions.md §"Play off the low
  // handicap"). Computed over PLAYING players only; DNP takes no strokes and doesn't set the
  // floor. Applied here, at the one round-level allocation, so points/standings/money agree.
  const playingStrokes = prelim.filter((x) => x.rp.status === 'playing').map((x) => x.ownStrokes)
  const fieldLowest = playingStrokes.length > 0 ? Math.min(...playingStrokes) : 0

  const players: PlayerRoundVM[] = prelim.map(({ rp, player, tee, result, ownStrokes, overrideApplied }) => {
    const name = player?.name ?? 'Unknown'
    const sortOrder = player?.sort_order ?? 999
    const playedOff = Math.max(0, ownStrokes - fieldLowest)
    const worksheet: Worksheet | null = result
      ? { result, overrideApplied, strokesReceivedFinal: playedOff, ownStrokes, fieldLowest }
      : null

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

    const alloc = allocateStrokes(playedOff, holes)
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

export function buildChampionships(
  dbData: Db,
  prebuiltDetails?: Map<number, RoundDetailVM | null>,
): PlayerChampionship[] {
  const rounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  // Build each round once and read points from it, so the cumulative board uses the SAME
  // low-handicap allocation as the round screen and the money page (one source of truth).
  // buildStandings passes its already-built details so we don't build them twice.
  const detailByRound = prebuiltDetails ?? new Map<number, RoundDetailVM | null>()
  if (!prebuiltDetails) {
    for (const round of rounds) detailByRound.set(round.round_number, buildRoundDetail(round.round_number, dbData))
  }

  return dbData.players
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => {
      const byRound: RoundPointsEntry[] = rounds.map((round) => {
        const detail = detailByRound.get(round.round_number) ?? null
        const pr = detail?.players.find((x) => x.playerId === p.id)
        return {
          roundNumber: round.round_number,
          status: round.status,
          points: pr && pr.status === 'playing' ? pr.totalPoints : 0,
          // The overall board is INCLUSIVE of the round in play: the live `in_progress`
          // round's points count toward the cumulative total as they currently stand
          // (Kyle, Phase 4 feedback — overrides the Phase 3 "final only" default). Nothing
          // jumps when it finalizes; the points were already there. Upcoming/abandoned never
          // count.
          counts: round.status === 'final' || round.status === 'in_progress',
        }
      })
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
  const counts = (s: RoundRow['status']) => s === 'final' || s === 'in_progress'

  const orderedRounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)

  // Build every round's detail once; reuse it for the totals AND the tiebreak chain.
  const detailByRound = new Map<number, RoundDetailVM | null>()
  for (const r of orderedRounds) detailByRound.set(r.round_number, buildRoundDetail(r.round_number, dbData))

  const champs = buildChampionships(dbData, detailByRound)
  const byRoundByPlayer = new Map(champs.map((c) => [c.playerId, c.byRound]))
  const nameById = new Map(dbData.players.map((p) => [p.id, p]))

  const roundColumns: RoundColumn[] = orderedRounds.map((r) => ({
    roundNumber: r.round_number,
    status: r.status,
    counts: counts(r.status),
  }))

  const countingRoundNumbers = orderedRounds.filter((r) => counts(r.status)).map((r) => r.round_number)
  const liveRoundNumbers = orderedRounds
    .filter((r) => r.status === 'in_progress')
    .map((r) => r.round_number)

  // ── Overall tiebreak context: best single round → holes won → countback ──
  // Everything is drawn from the SAME round details used for the totals, so a tie is broken
  // on exactly the numbers shown on the board. Built over counting rounds only.
  const roundPointsById = new Map<string, readonly number[]>(
    champs.map((c) => [c.playerId, c.byRound.filter((r) => r.counts).map((r) => r.points)]),
  )
  const holeCells: HoleNetCell[][] = []
  const cbRounds = new Map<number, CountbackRound>()
  for (const rn of countingRoundNumbers) {
    const d = detailByRound.get(rn)
    if (!d) continue
    const playing = d.players.filter((p) => p.status === 'playing')
    // Holes-won: one cell-set per counted hole.
    if (d.holes) {
      for (let holeNo = 1; holeNo <= d.holesCounted; holeNo++) {
        holeCells.push(
          playing.map((p) => {
            const hr = p.holeResults.find((h) => h.holeNumber === holeNo)
            return { playerId: p.playerId, net: hr?.net ?? null, completed: hr?.completed ?? false }
          }),
        )
      }
    }
    // Countback: per-player per-hole Stableford points.
    const pointsByPlayerHole = new Map<string, Map<number, number>>()
    for (const p of playing) {
      const m = new Map<number, number>()
      for (const hr of p.holeResults) m.set(hr.holeNumber, hr.points ?? 0)
      pointsByPlayerHole.set(p.playerId, m)
    }
    cbRounds.set(rn, {
      roundNumber: rn,
      status: d.round.status,
      holesCounted: d.holesCounted,
      pointsByPlayerHole,
    })
  }
  const countback: CountbackContext = { rounds: cbRounds, roundOrder: DEFAULT_COUNTBACK_ROUND_ORDER }
  const tbCtx: OverallTiebreakContext = {
    roundPointsById,
    holesWonById: tallyHolesWon(holeCells),
    countback,
  }
  const breakTie = (a: string, b: string) => compareOverall(a, b, tbCtx)

  // Position change is movement between the two most recent counting rounds.
  let previousPositions: Map<string, number> | undefined
  if (countingRoundNumbers.length >= 2) {
    const prevThrough = countingRoundNumbers[countingRoundNumbers.length - 2]
    const prev = standingsThroughRound(champs, prevThrough)
    previousPositions = new Map(prev.map((r) => [r.playerId, r.position]))
  }

  const rows = computeStandings(champs, previousPositions, breakTie).map((r) => {
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
  /** Par 3 within the counting holes — the only holes that carry a closest-to-pin. */
  ctpEligible: boolean
  /** Stored CTP for this hole: a winner id, null for "no winner", undefined if unentered. */
  ctpWinnerId: string | null | undefined
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
    const holesCounted = detail?.holesCounted ?? 18
    const ctpRow = dbData.ctp_results.find(
      (c) => c.round_id === round.id && c.hole_number === holeNumber,
    )
    hole = {
      holeNumber,
      par: holeRow.par,
      strokeIndex: holeRow.stroke_index,
      yardage,
      teeName: soleTee?.name ?? null,
      ctpEligible: holeRow.par === 3 && holeNumber <= holesCounted,
      ctpWinnerId: ctpRow ? ctpRow.player_id : undefined,
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
  purseAmounts: {
    buy_in_per_player_cents?: number
    champ_first_cents?: number
    champ_second_cents?: number
    round_winner_cents?: number
    fixed_cents?: Record<string, number> // legacy — no longer written
  }
  ctpCarryMode: string
  assignedIndexFootnote: string
}

export interface AdminLodgingVM {
  row: LodgingRow
  assignments: LodgingAssignmentRow[]
}

export interface AdminVM {
  players: PlayerRow[]
  courses: AdminCourseVM[]
  rounds: AdminRoundVM[]
  settings: AdminSettingsVM
  /** Raw itinerary rows, day then sort_order — the editor edits these in place. */
  itinerary: ItineraryItemRow[]
  lodging: AdminLodgingVM[]
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

  const itinerary = (dbData.itinerary_items ?? [])
    .slice()
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.sort_order - b.sort_order ||
        (a.start_time ?? '').localeCompare(b.start_time ?? ''),
    )

  const lodgingAssignments = dbData.lodging_assignments ?? []
  const lodging: AdminLodgingVM[] = (dbData.lodging ?? [])
    .slice()
    .sort((a, b) => a.check_in.localeCompare(b.check_in) || a.property.localeCompare(b.property))
    .map((row) => ({
      row,
      assignments: lodgingAssignments.filter((a) => a.lodging_id === row.id),
    }))

  return {
    players: dbData.players.slice().sort((a, b) => a.sort_order - b.sort_order),
    courses,
    rounds,
    itinerary,
    lodging,
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
      ctpCarryMode: settingValue(dbData.settings, 'ctp_carry_mode', 'return'),
      assignedIndexFootnote: settingValue(dbData.settings, 'assigned_index_footnote', ''),
    },
  }
}

// ── Info: itinerary ────────────────────────────────────────────────────────────
// The public timeline. Grouped by day, each day's items ordered by sort_order then
// start_time. "Today" is decided in America/New_York (the trip's timezone), never the
// device locale — so a phone left on Pacific time still highlights the right day.

export interface ItineraryEntryVM {
  id: string
  time: string | null // "1:10 PM ET", or null for an all-day item
  category: ItinCategory
  title: string
  detail: string | null
  location: string | null
}

export interface ItineraryDayVM {
  day: string // 'YYYY-MM-DD'
  label: string // "Thursday, February 4"
  isToday: boolean
  entries: ItineraryEntryVM[]
}

export interface ItineraryVM {
  days: ItineraryDayVM[]
  isEmpty: boolean
}

/** `todayET` is injectable for tests; in the app it defaults to the ET date of now. */
export function buildItinerary(dbData: Db, todayET: string = etDateString(new Date())): ItineraryVM {
  const items = (dbData.itinerary_items ?? []).slice()
  const byDay = new Map<string, ItineraryItemRow[]>()
  for (const it of items) {
    const list = byDay.get(it.day) ?? []
    list.push(it)
    byDay.set(it.day, list)
  }

  const days: ItineraryDayVM[] = [...byDay.keys()]
    .sort()
    .map((day) => {
      const entries = byDay
        .get(day)!
        .slice()
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order ||
            (a.start_time ?? '').localeCompare(b.start_time ?? '') ||
            a.title.localeCompare(b.title),
        )
        .map(
          (it): ItineraryEntryVM => ({
            id: it.id,
            time: formatTeeTime(it.start_time),
            category: it.category,
            title: it.title,
            detail: it.detail,
            location: it.location,
          }),
        )
      return { day, label: formatDayLong(day), isToday: day === todayET, entries }
    })

  return { days, isEmpty: days.length === 0 }
}

// ── Info: lodging ────────────────────────────────────────────────────────────
export interface LodgingAssignmentVM {
  id: string
  playerName: string
  roomLabel: string | null
  sortOrder: number
}

export interface LodgingVM {
  properties: {
    id: string
    property: string
    checkIn: string // "Thu, Feb 4"
    checkOut: string
    nights: number
    confirmation: string | null
    notes: string | null
    assignments: LodgingAssignmentVM[]
  }[]
  isEmpty: boolean
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(`${checkIn}T12:00:00-05:00`).getTime()
  const b = new Date(`${checkOut}T12:00:00-05:00`).getTime()
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export function buildLodging(dbData: Db): LodgingVM {
  const playersById = new Map(dbData.players.map((p) => [p.id, p]))
  const assignments = dbData.lodging_assignments ?? []

  const properties = (dbData.lodging ?? [])
    .slice()
    .sort((a, b) => a.check_in.localeCompare(b.check_in) || a.property.localeCompare(b.property))
    .map((l) => ({
      id: l.id,
      property: l.property,
      checkIn: formatDay(l.check_in),
      checkOut: formatDay(l.check_out),
      nights: nightsBetween(l.check_in, l.check_out),
      confirmation: l.confirmation,
      notes: l.notes,
      assignments: assignments
        .filter((a) => a.lodging_id === l.id)
        .map((a): LodgingAssignmentVM => {
          const p = playersById.get(a.player_id)
          return {
            id: a.id,
            playerName: p?.name ?? 'Unknown',
            roomLabel: a.room_label,
            sortOrder: p?.sort_order ?? 999,
          }
        })
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))

  return { properties, isEmpty: properties.length === 0 }
}

// ── Info: courses ──────────────────────────────────────────────────────────────
// The index and the per-course scorecard. Everything here is already hydrated (courses,
// tees, holes, hole_yardages); this only shapes it for reading. A course whose card is a
// placeholder (Bone Valley pre-publish) renders with nulls, never fabricated numbers.

/** The round that plays a given course, if any — used to order the index and label a page. */
function roundForCourse(courseId: string, dbData: Db): RoundRow | undefined {
  return dbData.rounds.find((r) => r.course_id === courseId)
}

export interface CourseIndexItemVM {
  id: string
  name: string
  architect: string
  yearOpened: number
  isPlaceholder: boolean
  roundNumber: number | null
  dayLabel: string | null
  par: number | null // the primary tee's par, when a tee exists
  totalYardage: number | null
}

export function buildCoursesIndex(dbData: Db): CourseIndexItemVM[] {
  return dbData.courses
    .map((course) => {
      const round = roundForCourse(course.id, dbData)
      const tees = dbData.tees.filter((t) => t.course_id === course.id)
      const primary = tees
        .slice()
        .sort((a, b) => (b.total_yardage ?? 0) - (a.total_yardage ?? 0))[0]
      return {
        id: course.id,
        name: course.name,
        architect: course.architect,
        yearOpened: course.year_opened,
        isPlaceholder: course.data_is_placeholder,
        roundNumber: round?.round_number ?? null,
        dayLabel: round ? formatDay(round.date) : null,
        par: primary?.par ?? null,
        totalYardage: primary?.total_yardage ?? null,
      }
    })
    .sort(
      (a, b) =>
        (a.roundNumber ?? 99) - (b.roundNumber ?? 99) || a.name.localeCompare(b.name),
    )
}

export interface CourseTeeVM {
  id: string
  name: string
  rating: number | null
  slope: number | null
  par: number
  totalYardage: number | null
  frontPar: number | null
  backPar: number | null
  frontYardage: number | null
  backYardage: number | null
}

export interface CourseHoleVM {
  holeNumber: number
  par: number | null
  strokeIndex: number | null
  yardageByTee: Record<string, number | null> // teeId -> yardage
}

export interface CourseDetailVM {
  course: CourseRow
  roundNumber: number | null
  dayLabel: string | null
  teeTime: string | null
  isPlaceholder: boolean
  tees: CourseTeeVM[]
  holes: CourseHoleVM[] // always 18
  // The tee this round is actually played from — the modal tee among the round's PLAYING
  // players (excludes DNP). Drives the scorecard's default single-column view on phones.
  // Null when the round has no player-tee assignments yet; the UI then falls back to a
  // middle tee. Self-correcting: updates the instant the real tees are entered pre-trip.
  groupTeeId: string | null
}

export function buildCourseDetail(courseId: string, dbData: Db): CourseDetailVM | null {
  const course = dbData.courses.find((c) => c.id === courseId)
  if (!course) return null

  const round = roundForCourse(course.id, dbData)
  const holeRows = dbData.holes.filter((h) => h.course_id === course.id)
  const byNumber = new Map(holeRows.map((h) => [h.hole_number, h]))
  const holeIds = new Set(holeRows.map((h) => h.id))
  const holeById = new Map(holeRows.map((h) => [h.id, h]))

  // yardage[teeId][holeNumber]
  const yByTeeHole = new Map<string, Map<number, number | null>>()
  for (const y of dbData.hole_yardages) {
    if (!holeIds.has(y.hole_id)) continue
    const holeNumber = holeById.get(y.hole_id)!.hole_number
    const m = yByTeeHole.get(y.tee_id) ?? new Map<number, number | null>()
    m.set(holeNumber, y.yardage)
    yByTeeHole.set(y.tee_id, m)
  }

  const tees: CourseTeeVM[] = dbData.tees
    .filter((t) => t.course_id === course.id)
    .sort((a, b) => (b.total_yardage ?? 0) - (a.total_yardage ?? 0) || a.name.localeCompare(b.name))
    .map((t) => {
      const yards = yByTeeHole.get(t.id)
      const sumRange = (from: number, to: number): number | null => {
        if (!yards) return null
        let total = 0
        for (let h = from; h <= to; h++) {
          const v = yards.get(h)
          if (v === null || v === undefined) return null
          total += v
        }
        return total
      }
      const sumParRange = (from: number, to: number): number | null => {
        let total = 0
        for (let h = from; h <= to; h++) {
          const p = byNumber.get(h)?.par
          if (p === null || p === undefined) return null
          total += p
        }
        return total
      }
      return {
        id: t.id,
        name: t.name,
        rating: t.rating,
        slope: t.slope,
        par: t.par,
        totalYardage: t.total_yardage,
        frontPar: sumParRange(1, 9),
        backPar: sumParRange(10, 18),
        frontYardage: sumRange(1, 9),
        backYardage: sumRange(10, 18),
      }
    })

  const holes: CourseHoleVM[] = Array.from({ length: 18 }, (_, i) => {
    const n = i + 1
    const row = byNumber.get(n)
    const yardageByTee: Record<string, number | null> = {}
    for (const t of tees) yardageByTee[t.id] = yByTeeHole.get(t.id)?.get(n) ?? null
    return {
      holeNumber: n,
      par: row?.par ?? null,
      strokeIndex: row?.stroke_index ?? null,
      yardageByTee,
    }
  })

  // Modal tee among this round's playing players (DNP excluded). Falls back to null when
  // no assignments exist for the round yet — the scorecard UI then picks a middle tee.
  let groupTeeId: string | null = null
  if (round) {
    const counts = new Map<string, number>()
    for (const rp of dbData.round_players) {
      if (rp.round_id !== round.id || rp.status === 'did_not_play') continue
      counts.set(rp.tee_id, (counts.get(rp.tee_id) ?? 0) + 1)
    }
    let best = -1
    for (const [teeId, n] of counts) {
      if (n > best) {
        best = n
        groupTeeId = teeId
      }
    }
  }

  return {
    course,
    roundNumber: round?.round_number ?? null,
    dayLabel: round ? formatDay(round.date) : null,
    teeTime: round ? formatTeeTime(round.tee_time) : null,
    isPlaceholder: course.data_is_placeholder,
    tees,
    holes,
    groupTeeId,
  }
}

// ── Info: players — course handicap per course ──────────────────────────────────
// Each player's PLAYING handicap at each round's tee, computed LIVE from the player's
// current index (CLAUDE.md §Scoring — the index is read live, never a per-round snapshot),
// so the reference page moves the instant an index is edited on the admin Players tab. This
// is the player's own handicap (post allowance/cap/override), NOT the play-off-the-low
// relative figure the scorecard uses.

export interface PlayerCourseHandicapVM {
  roundNumber: number
  courseName: string
  teeName: string | null
  playingHandicap: number | null // null when the player is not assigned / DNP / no card
  didNotPlay: boolean
}

export function buildPlayerCourseHandicaps(dbData: Db): Map<string, PlayerCourseHandicapVM[]> {
  const coursesById = new Map(dbData.courses.map((c) => [c.id, c]))
  const teesById = new Map(dbData.tees.map((t) => [t.id, t]))
  const rounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  const out = new Map<string, PlayerCourseHandicapVM[]>()

  for (const player of dbData.players) {
    const rows: PlayerCourseHandicapVM[] = rounds.map((round) => {
      const course = coursesById.get(round.course_id)
      const rp = dbData.round_players.find(
        (x) => x.round_id === round.id && x.player_id === player.id,
      )
      const tee = rp ? teesById.get(rp.tee_id) : undefined
      const didNotPlay = rp?.status === 'did_not_play'

      let playingHandicap: number | null = null
      if (rp && tee && !didNotPlay) {
        const result = computeHandicap({
          index: player.handicap_index ?? rp.index_used,
          rating: tee.rating,
          slope: tee.slope,
          par: tee.par,
          allowancePct: rp.allowance_used,
          cap: rp.cap_used,
        })
        playingHandicap = resolveStrokesReceived(result.strokesReceived, rp.manual_override).value
      }

      return {
        roundNumber: round.round_number,
        courseName: course?.name ?? 'Course',
        teeName: tee?.name ?? null,
        playingHandicap,
        didNotPlay,
      }
    })
    out.set(player.id, rows)
  }

  return out
}

// ── Round recap — the live round story ───────────────────────────────────────
// ONE view model driven by round state: the same card evolves opening → moving →
// closing → final as scores come in, then settles into the recap. No new scoring
// math — everything is assembled from the round detail + championship data every
// other screen uses. Rendered on /rounds/:n once play has begun; it re-derives on
// every score change through the normal useLiveQuery path (live on all four phones).
export type RecapAct = 'opening' | 'moving' | 'closing' | 'final'

export interface RecapWinner {
  name: string
  points: number
}
export interface RecapStanding {
  playerId: string
  name: string
  points: number
  thru: number
  projection: number | null
  gapToLeader: number // points behind the leader (0 for the leader)
}
export interface RecapCtpWinner {
  holeNumber: number
  name: string | null // null => carry / no winner recorded
  open: boolean // hole not yet played (live) — distinct from a played-but-no-winner carry
}
export interface RecapMover {
  name: string
  from: number
  to: number
  change: number // from - to; > 0 means moved up
}
export interface RecapHoleLeaders {
  holeNumber: number
  order: string[] // playing playerIds ranked by cumulative points through this hole, desc
  inPlay: boolean // at least one player has completed this hole
}
export interface RecapPlayer {
  playerId: string
  name: string
  short: string // first name, for chips + legend
  colorIndex: number // STABLE identity slot (by sort order) — never re-keyed as the board moves
}
/** One headline is a few segments; `gold` marks the part rendered as leader/winner status. */
export interface RecapHeadlineSeg {
  text: string
  gold?: boolean
}
export interface RecapHighlight {
  name: string
  holeNumber: number
  points: number
  label: string // "net eagle" | "net birdie"
}
export interface RoundRecapVM {
  round: RoundRow
  course: CourseRow
  act: RecapAct
  complete: boolean // every playing player thru the counted window
  official: boolean // round.status === 'final'
  live: boolean // still in progress (drives the pulse dot / present tense)
  roundThru: number // furthest any playing player has reached
  remaining: number // counted holes still to play
  headline: RecapHeadlineSeg[]
  narrative: string
  winners: RecapWinner[] // co-winners share the top on a tie
  margin: number // top points minus the best non-winner; 0 when tied at the top
  runnerUp: RecapWinner | null
  standing: RecapStanding[] // this round's order (playing only), desc
  roundWinnerCents: number
  highlights: RecapFact[] // point-native superlatives, ranked by notability (most interesting first)
  biggestMove: RecapMover | null
  ctpWinners: RecapCtpWinner[]
  nextPar3: number | null // next unplayed par 3 (live drama)
  parThreeCount: number
  leadChangeCount: number
  holeLeaders: RecapHoleLeaders[]
  players: RecapPlayer[] // playing players, leaderboard order
  week: RecapWeekVM | null // what this round is doing to the overall championship (null on round 1)
  dispatch: string // one line of editorial voice, situation-picked
}

/** One player's line in the overall (championship) standings as of this round. */
export interface RecapWeekRow {
  playerId: string
  name: string
  overall: number // cumulative points through this round
  position: number
  change: number // positions moved this round; > 0 = climbed
}
export interface RecapWeekVM {
  throughLabel: string // "round 3 live" | "after 3 of 4"
  line: string // voice line about the trip race
  rows: RecapWeekRow[] // overall order, desc
  leaderName: string
}

/** One picked highlight fact — a label + a display value, ranked by how interesting it is. */
export interface RecapFact {
  key: string
  label: string
  value: string
  notability: number // higher = more interesting; candidates with 0 are dropped
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}

function ordinalOf(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function courseShortName(name: string): string {
  return name.replace(/^Streamsong\s+/i, '')
}

/** One line of voice, deterministic — picks the strongest hook the round currently offers. */
function pickDispatch(x: {
  act: RecapAct
  leadLabel: string
  multi: boolean
  margin: number
  remaining: number
  theShort: string
  biggestMove: RecapMover | null
}): string {
  const { act, leadLabel, multi, margin, remaining, theShort, biggestMove } = x
  const final = act === 'final'
  const late = final || act === 'closing'
  if (final && !multi && biggestMove && firstName(biggestMove.name) === leadLabel)
    return `${leadLabel} came for the round and left with the week.`
  if (late && !multi && margin >= 6) return `${leadLabel} turned it into a procession.`
  if (late && margin <= 1)
    return final ? 'It went to the very last holes.' : 'Nothing to separate them down the stretch.'
  switch (act) {
    case 'opening':
      return `${leadLabel} away first — a long way to go on ${theShort}.`
    case 'moving':
      return multi ? 'Still everything to play for.' : `${leadLabel} edging clear.`
    case 'closing':
      return `${remaining} to play${margin > 0 ? `, ${margin} in hand` : ', all square'}.`
    default:
      return multi ? `Honours shared on ${theShort}.` : `${leadLabel} closes out ${theShort}.`
  }
}

/**
 * The highlight picker: computes every point-native superlative the round can offer, scores each
 * by how interesting it is, drops the ones with no signal, and returns them ranked. The card shows
 * the top one or two — so a net eagle beats a quiet "+2", a meltdown can win the slot, and nothing
 * ever renders a dead value. Everything is derived from the per-hole Stableford points.
 */
function buildHighlights(a: {
  playing: PlayerRoundVM[]
  holesCounted: number
  holeLeaders: RecapHoleLeaders[]
  act: RecapAct
  winPoints: number
  priorBestRound: number | null
}): RecapFact[] {
  const { playing, holesCounted, holeLeaders, act, winPoints, priorBestRound } = a
  const fn = firstName
  const done = (p: PlayerRoundVM) => p.holeResults.filter((h) => h.completed)
  const ptsMap = (p: PlayerRoundVM) =>
    new Map(done(p).map((h) => [h.holeNumber, h.points ?? 0] as [number, number]))
  const cands: RecapFact[] = []

  // Against the number — points vs net-Stableford par pace (2/hole). The golfer's measure.
  {
    let best: { p: PlayerRoundVM; v: number } | null = null
    for (const p of playing) {
      const v = p.totalPoints - 2 * p.thru
      if (p.thru >= 3 && (best === null || v > best.v)) best = { p, v }
    }
    if (best && best.v > 0)
      cands.push({ key: 'vsnum', label: 'Against the number', value: `${fn(best.p.name)} · +${best.v}`, notability: best.v * 8 })
  }

  // Net birdies (3+), with a bump for eagles (4+).
  {
    let best: { p: PlayerRoundVM; b: number; e: number } | null = null
    for (const p of playing) {
      let b = 0
      let e = 0
      for (const h of done(p)) {
        const pts = h.points ?? 0
        if (pts >= 3) b++
        if (pts >= 4) e++
      }
      if (b > 0 && (best === null || b > best.b)) best = { p, b, e }
    }
    if (best)
      cands.push({ key: 'birdies', label: 'Net birdies', value: `${fn(best.p.name)} · ${best.b}`, notability: best.b * 15 + best.e * 15 })
  }

  // Shot of the day — single best hole (net birdie or better).
  {
    let best: { p: PlayerRoundVM; pts: number; hole: number } | null = null
    for (const p of playing)
      for (const h of done(p)) {
        const pts = h.points ?? 0
        if (pts >= 3 && (best === null || pts > best.pts)) best = { p, pts, hole: h.holeNumber }
      }
    if (best)
      cands.push({
        key: 'shot',
        label: 'Shot of the day',
        value: `${fn(best.p.name)} · ${best.pts >= 4 ? 'net eagle' : 'net birdie'}, ${ordinalOf(best.hole)}`,
        notability: best.pts >= 4 ? 80 : 45,
      })
  }

  // Best nine — a full front or full back nine's points.
  {
    let best: { p: PlayerRoundVM; pts: number; side: string } | null = null
    for (const p of playing) {
      const m = ptsMap(p)
      if (holesCounted >= 9) {
        let ok = true
        let sum = 0
        for (let h = 1; h <= 9; h++) {
          if (!m.has(h)) { ok = false; break }
          sum += m.get(h)!
        }
        if (ok && (best === null || sum > best.pts)) best = { p, pts: sum, side: 'front' }
      }
      if (holesCounted >= 18) {
        let ok = true
        let sum = 0
        for (let h = 10; h <= 18; h++) {
          if (!m.has(h)) { ok = false; break }
          sum += m.get(h)!
        }
        if (ok && (best === null || sum > best.pts)) best = { p, pts: sum, side: 'back' }
      }
    }
    if (best && best.pts > 18)
      cands.push({ key: 'nine', label: 'Best nine', value: `${fn(best.p.name)} · ${best.pts} ${best.side}`, notability: (best.pts - 18) * 5 })
  }

  // Hot streak — best three consecutive played holes.
  {
    let best: { p: PlayerRoundVM; sum: number; s: number } | null = null
    for (const p of playing) {
      const m = ptsMap(p)
      for (let s = 1; s + 2 <= holesCounted; s++) {
        if (m.has(s) && m.has(s + 1) && m.has(s + 2)) {
          const sum = m.get(s)! + m.get(s + 1)! + m.get(s + 2)!
          if (best === null || sum > best.sum) best = { p, sum, s }
        }
      }
    }
    if (best && best.sum >= 7)
      cands.push({ key: 'streak', label: 'Hot streak', value: `${fn(best.p.name)} · ${best.sum} on ${best.s}–${best.s + 2}`, notability: (best.sum - 6) * 10 })
  }

  // Scoring streak — longest run of holes without a blank.
  {
    let best: { p: PlayerRoundVM; run: number } | null = null
    for (const p of playing) {
      const m = ptsMap(p)
      let run = 0
      let top = 0
      for (let h = 1; h <= holesCounted; h++) {
        if (m.has(h) && m.get(h)! >= 1) { run++; top = Math.max(top, run) } else if (m.has(h)) run = 0
      }
      if (best === null || top > best.run) best = { p, run: top }
    }
    if (best && best.run >= 6)
      cands.push({ key: 'sstreak', label: 'Scoring streak', value: `${fn(best.p.name)} · ${best.run} straight`, notability: (best.run - 4) * 8 })
  }

  // Scoring holes — the cleanest card (fewest blanks), notable only when near-perfect.
  {
    let best: { p: PlayerRoundVM; scored: number; total: number; blanks: number } | null = null
    for (const p of playing) {
      const d = done(p)
      const scored = d.filter((h) => (h.points ?? 0) >= 1).length
      const blanks = d.length - scored
      if (d.length >= 6 && (best === null || blanks < best.blanks)) best = { p, scored, total: d.length, blanks }
    }
    if (best) {
      const n = best.blanks === 0 ? 40 : best.blanks === 1 ? 12 : 0
      if (n > 0)
        cands.push({ key: 'scoring', label: 'Scoring holes', value: `${fn(best.p.name)} · ${best.scored} of ${best.total}`, notability: n })
    }
  }

  // Blow-ups — the most blank holes (the roast).
  {
    let best: { p: PlayerRoundVM; blanks: number } | null = null
    for (const p of playing) {
      const blanks = done(p).filter((h) => (h.points ?? 0) === 0).length
      if (best === null || blanks > best.blanks) best = { p, blanks }
    }
    if (best && best.blanks >= 3)
      cands.push({ key: 'blanks', label: 'Blow-ups', value: `${fn(best.p.name)} · ${best.blanks} blanks`, notability: best.blanks * 14 })
  }

  // Time in front — holes spent leading (from the ribbon).
  {
    const led = new Map<string, number>()
    for (const h of holeLeaders) if (h.inPlay) led.set(h.order[0], (led.get(h.order[0]) ?? 0) + 1)
    let best: { p: PlayerRoundVM; n: number } | null = null
    for (const p of playing) {
      const n = led.get(p.playerId) ?? 0
      if (best === null || n > best.n) best = { p, n }
    }
    if (best && best.n >= 3)
      cands.push({ key: 'front', label: 'In front', value: `${fn(best.p.name)} · led ${best.n}`, notability: Math.min(best.n * 3, 28) })
  }

  // Low round of the trip — is this the best single round posted so far? (Only once it's done.)
  if (act === 'final' && priorBestRound !== null && winPoints > 0 && winPoints >= priorBestRound)
    cands.push({ key: 'lowround', label: 'Trip', value: `${winPoints} · low round so far`, notability: 70 })

  return cands.filter((c) => c.notability > 0).sort((x, y) => y.notability - x.notability)
}

export function buildRoundRecap(roundNumber: number, dbData: Db): RoundRecapVM | null {
  const detail = buildRoundDetail(roundNumber, dbData)
  if (!detail) return null
  const { round, course, holes, holesCounted } = detail

  // Nothing to recap until a real, started round has scores on the board.
  if (round.status === 'upcoming' || round.status === 'abandoned') return null
  if (!holes || course.data_is_placeholder) return null

  const playing = detail.leaderboard // already playing-only, desc by points
  if (playing.length === 0 || playing.every((p) => p.thru === 0)) return null

  const complete = playing.every((p) => p.thru === holesCounted)
  const official = round.status === 'final'
  const live = !official && !complete
  const roundThru = Math.max(...playing.map((p) => p.thru))
  const remaining = Math.max(0, holesCounted - roundThru)

  // The act is derived purely from progress + status — this is the state machine.
  const act: RecapAct =
    official || complete ? 'final' : remaining <= 4 ? 'closing' : roundThru >= 6 ? 'moving' : 'opening'

  // Winner(s) / current leader(s) + margin.
  const top = playing[0].totalPoints
  const winners: RecapWinner[] = playing
    .filter((p) => p.totalPoints === top)
    .map((p) => ({ name: p.name, points: p.totalPoints }))
  const multi = winners.length > 1
  const firstLoser = playing.find((p) => p.totalPoints < top) ?? null
  const margin = firstLoser ? top - firstLoser.totalPoints : 0
  const runnerUp = firstLoser ? { name: firstLoser.name, points: firstLoser.totalPoints } : null
  const standing: RecapStanding[] = playing.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    points: p.totalPoints,
    thru: p.thru,
    projection: p.projection,
    gapToLeader: top - p.totalPoints,
  }))

  const roundWinnerCents = settingValue<{ round_winner_cents?: number }>(
    dbData.settings,
    'purse_amounts',
    {},
  ).round_winner_cents ?? 0

  // The overall championship as of this round, the biggest mover, and the best single round
  // posted before this one (for the "low round of the trip" highlight) — all from the SAME
  // cumulative standings. Only meaningful once a prior round counts; the week stays null on r1.
  let biggestMove: RecapMover | null = null
  let week: RecapWeekVM | null = null
  let priorBestRound: number | null = null
  const countingBefore = dbData.rounds.some(
    (r) => r.round_number < roundNumber && (r.status === 'final' || r.status === 'in_progress'),
  )
  if (countingBefore) {
    const champs = buildChampionships(dbData)
    let mx = 0
    let anyPrior = false
    for (const c of champs)
      for (const r of c.byRound)
        if (r.counts && r.roundNumber < roundNumber) {
          anyPrior = true
          if (r.points > mx) mx = r.points
        }
    priorBestRound = anyPrior ? mx : null
    const nmById = new Map(dbData.players.map((p) => [p.id, p.name]))
    const beforePos = new Map(
      standingsThroughRound(champs, roundNumber - 1).map((r) => [r.playerId, r.position]),
    )
    const after = standingsThroughRound(champs, roundNumber) // sorted by position
    const weekRows: RecapWeekRow[] = after.map((r) => ({
      playerId: r.playerId,
      name: nmById.get(r.playerId) ?? 'Unknown',
      overall: r.total,
      position: r.position,
      change: (beforePos.get(r.playerId) ?? r.position) - r.position,
    }))
    for (const row of weekRows) {
      if (row.change > 0 && (!biggestMove || row.change > biggestMove.change)) {
        biggestMove = { name: row.name, from: row.position + row.change, to: row.position, change: row.change }
      }
    }
    const wl = weekRows[0]
    const gap2 = weekRows[1] ? wl.overall - weekRows[1].overall : 0
    const line =
      wl.change > 0
        ? `${firstName(wl.name)} ${live ? 'is flipping the week' : 'seizes the week lead'} — ${ordinalOf(
            wl.position + wl.change,
          )} to the overall lead.`
        : `${firstName(wl.name)} holds the week lead${gap2 > 0 ? ` by ${gap2}` : ''}.`
    const countingThrough = dbData.rounds.filter(
      (r) => r.round_number <= roundNumber && (r.status === 'final' || r.status === 'in_progress'),
    ).length
    week = {
      throughLabel: live ? `round ${roundNumber} live` : `after ${countingThrough} of ${dbData.rounds.length}`,
      line,
      rows: weekRows,
      leaderName: wl.name,
    }
  }

  // Closest to pin — every par 3: a winner, a played carry, or still open (live).
  const parThrees = holes.filter((h) => h.par === 3).map((h) => h.holeNumber).sort((a, b) => a - b)
  const ctpByHole = new Map<number, string | null>()
  const nameById = new Map(dbData.players.map((p) => [p.id, p.name]))
  for (const c of dbData.ctp_results) {
    if (c.round_id !== round.id) continue
    ctpByHole.set(c.hole_number, c.player_id ? nameById.get(c.player_id) ?? null : null)
  }
  const ctpWinners: RecapCtpWinner[] = parThrees.map((holeNumber) => ({
    holeNumber,
    name: ctpByHole.has(holeNumber) ? ctpByHole.get(holeNumber) ?? null : null,
    open: !ctpByHole.has(holeNumber) && holeNumber > roundThru,
  }))
  const nextPar3 = parThrees.find((h) => h > roundThru) ?? null

  // Stable identity colours: keyed by sort order, so a player's ribbon colour never changes as
  // the board reshuffles mid-round.
  const colorRank = new Map(
    playing
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p, i) => [p.playerId, i]),
  )
  const players: RecapPlayer[] = playing.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    short: firstName(p.name),
    colorIndex: colorRank.get(p.playerId) ?? 0,
  }))

  // Lead-change timeline — cumulative points per player through each counted hole.
  const running = new Map<string, number>(playing.map((p) => [p.playerId, 0]))
  const holeLeaders: RecapHoleLeaders[] = []
  let leadChangeCount = 0
  let prevLeader: string | null = null
  for (let hole = 1; hole <= holesCounted; hole++) {
    let inPlay = false
    for (const p of playing) {
      const hr = p.holeResults.find((h) => h.holeNumber === hole)
      if (hr?.completed) {
        running.set(p.playerId, (running.get(p.playerId) ?? 0) + (hr.points ?? 0))
        inPlay = true
      }
    }
    const order = playing
      .slice()
      .sort(
        (a, b) =>
          (running.get(b.playerId) ?? 0) - (running.get(a.playerId) ?? 0) || a.sortOrder - b.sortOrder,
      )
      .map((p) => p.playerId)
    holeLeaders.push({ holeNumber: hole, order, inPlay })
    if (inPlay) {
      const leader = order[0]
      if (prevLeader !== null && leader !== prevLeader) leadChangeCount++
      prevLeader = leader
    }
  }

  // ── Headline + narrative, templated per act (deterministic, no AI) ──
  const leadLabel = winners.map((w) => firstName(w.name)).join(' & ')
  const runnerFirst = runnerUp ? firstName(runnerUp.name) : null
  const short = courseShortName(course.name)
  // "the Red / the Black" reads right; "the Bone Valley" doesn't — article only for the colours.
  const theShort = /^(Red|Blue|Black)$/i.test(short) ? `the ${short}` : short
  const winPoints = winners[0]?.points ?? 0

  let headline: RecapHeadlineSeg[]
  switch (act) {
    case 'opening':
      headline = [{ text: leadLabel, gold: true }, { text: ' out of the gate.' }]
      break
    case 'moving':
      headline = [
        { text: leadLabel, gold: true },
        { text: multi ? ' share the lead.' : roundThru <= 10 ? ' leads at the turn.' : ' out front.' },
      ]
      break
    case 'closing':
      headline =
        margin > 0
          ? [{ text: `${margin} to hold, ${remaining} to play.` }]
          : [{ text: `All square, ${remaining} to play.` }]
      break
    default: // final
      headline = [{ text: leadLabel, gold: true }, { text: multi ? ` share ${theShort}.` : ` takes ${theShort}.` }]
  }

  const marginPhrase = margin > 0 ? ` — ${margin} clear of ${runnerFirst}` : multi ? ' — level at the top' : ''
  let narrative: string
  switch (act) {
    case 'opening':
      narrative = `${roundThru} hole${roundThru === 1 ? '' : 's'} into ${theShort}, ${leadLabel} ${
        multi ? 'set' : 'sets'
      } the early pace${marginPhrase}.`
      break
    case 'moving':
      narrative = `${leadLabel} ${multi ? 'lead' : 'leads'} through ${roundThru}${marginPhrase}.`
      break
    case 'closing':
      narrative =
        margin > 0
          ? `${leadLabel} ${multi ? 'carry' : 'carries'} a ${margin}-point lead into the closing stretch${
              nextPar3 ? `; the par-3 ${ordinalOf(nextPar3)} still to come` : ''
            }.`
          : `Nothing between them with ${remaining} to play${
              nextPar3 ? ` — the par-3 ${ordinalOf(nextPar3)} could decide it` : ''
            }.`
      break
    default: {
      // final. The holes-won / biggest-move numbers show as their own fact rows, so the
      // narrative only adds the mover storyline (round 2+), never a line that repeats them.
      const moverClause = biggestMove
        ? ` ${firstName(biggestMove.name)} was the big mover, ${ordinalOf(biggestMove.from)} to ${ordinalOf(
            biggestMove.to,
          )} overall.`
        : ''
      narrative = `${leadLabel} ${multi ? 'share' : 'takes'} ${theShort}${
        margin > 0 ? ` by ${margin}` : ''
      } — a round of ${winPoints}.${moverClause}`
    }
  }

  // ── Highlights: point-native superlatives, ranked so the most interesting one wins the slot
  //    (and nothing shows a dead value early). ──
  const highlights = buildHighlights({ playing, holesCounted, holeLeaders, act, winPoints, priorBestRound })

  // ── Dispatch: one line of editorial voice, chosen by the strongest hook available ──
  const dispatch = pickDispatch({ act, leadLabel, multi, margin, remaining, theShort, biggestMove })

  return {
    week,
    dispatch,
    round,
    course,
    act,
    complete,
    official,
    live,
    roundThru,
    remaining,
    headline,
    narrative,
    winners,
    margin,
    runnerUp,
    standing,
    roundWinnerCents,
    highlights,
    biggestMove,
    ctpWinners,
    nextPar3,
    parThreeCount: parThrees.length,
    leadChangeCount,
    holeLeaders,
    players,
  }
}
