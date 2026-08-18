/**
 * Phase 4 fake-scores generator.
 *
 * Emits an idempotent SQL seed migration (round_players + scores) whose handicap
 * snapshots are computed by the REAL scoring engine, so the app — which allocates
 * strokes from round_players.strokes_received and derives points from stored gross —
 * agrees with these figures exactly. Also prints the expected per-round leaderboards
 * and cumulative standings so the UI can be eyeballed against a known-good source.
 *
 * Run: npx tsx scripts/gen-phase4-seed.ts > supabase/migrations/<ts>_seed_phase4_fake_scores.sql
 * (the human-readable verification dump goes to stderr, not the SQL file).
 *
 * NOT part of the app bundle. Gross scores below are invented for the read-only demo
 * that exists before any write path (phase-plan.md §Phase 4).
 */
import {
  computeHandicap,
  allocateStrokes,
  computeHoleResult,
  DEFAULT_POINTS_TABLE,
} from '../src/lib/scoring'
import type { HoleInfo } from '../src/lib/scoring'
import { RED_HOLES, BLUE_HOLES, BLACK_HOLES } from '../src/lib/scoring/__fixtures__/streamsong'

// ── Fixed IDs (mirror the Phase 2 seeds) ────────────────────────────────────
const PLAYER = {
  jon: 'd0000000-0000-4000-8000-000000000001',
  kyle: 'd0000000-0000-4000-8000-000000000002',
  adam: 'd0000000-0000-4000-8000-000000000003',
  chris: 'd0000000-0000-4000-8000-000000000004',
} as const
const PLAYER_INDEX = { jon: 9.2, kyle: 12.4, adam: 14.0, chris: 16.8 } as const
const PLAYER_DIGIT = { jon: 1, kyle: 2, adam: 3, chris: 4 } as const

const ROUND = {
  red: 'e0000000-0000-4000-8000-000000000001', // R1
  black: 'e0000000-0000-4000-8000-000000000002', // R2
  blue: 'e0000000-0000-4000-8000-000000000003', // R3
} as const

// Green tee per course (rating / slope / par) + the tee UUID.
const TEE = {
  red: { id: 'bbbb0001-0000-4000-8000-000000000001', rating: 74.1, slope: 137, par: 72 },
  black: { id: 'bbbb0003-0000-4000-8000-000000000001', rating: 74.7, slope: 135, par: 73 },
  blue: { id: 'bbbb0002-0000-4000-8000-000000000001', rating: 74.0, slope: 134, par: 72 },
} as const

const ALLOWANCE = 1.0
const CAP = 18

type PlayerKey = keyof typeof PLAYER
const PLAYERS: PlayerKey[] = ['jon', 'kyle', 'adam', 'chris']

// ── Gross scores as strokes-over-par deltas per hole (18 each) ───────────────
// Authored for a believable mid-trip picture, not from a real card.
// R1 Red (par 72): everyone finishes 18. R2 Black (par 73): weather curtailed
// after 15 → holes 16-18 unplayed, holes_counted=15. R3 Blue: live, ~thru 13,
// Chris did not play.
type Delta = (number | 'PU' | null)[] // number = strokes over par; 'PU' = picked up; null = not entered

const RED: Record<PlayerKey, Delta> = {
  //     1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18
  jon: [0, 1, 0, 1, 0, 1, -1, 0, 1, 0, 1, 1, 0, 1, 2, 0, 0, 1],
  kyle: [1, 1, 2, 0, 1, 1, 1, 2, 0, 1, 1, 0, 2, 1, 1, 1, 2, 1],
  adam: [1, 0, 1, 1, 2, 0, 1, 1, 1, 0, 2, 1, 1, 1, 1, 2, 1, 1],
  chris: [2, 2, 1, 1, 2, 1, 2, 1, 2, 1, 1, 2, 2, 1, 2, 1, 2, 2],
}

const BLACK: Record<PlayerKey, Delta> = {
  //      1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 |16 17 18 curtailed
  jon: [1, 1, 1, 1, 1, 0, 1, 1, 0, 2, 1, 1, 2, 0, 1, null, null, null],
  kyle: [1, 1, 0, 1, 1, 1, 1, 1, 2, 1, 0, 1, 1, 1, 1, null, null, null],
  adam: [0, 1, 3, 1, 1, 1, 'PU', 1, 3, 1, 1, 0, 2, 3, 1, null, null, null],
  chris: [2, 1, 2, 1, 1, 2, 1, 1, 'PU', 2, 1, 2, 1, 1, 2, null, null, null],
}

const BLUE: Record<PlayerKey, Delta> = {
  //      1  2  3  4  5  6  7  8  9 10 11 12 13 |14.. not yet played
  // R3 is live and now counts toward the overall board. Kyle is stumbling and Adam is on a
  // heater — enough that, once the live round is included, Adam climbs past Kyle into 2nd.
  jon: [0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, null, null, null, null, null],
  kyle: [1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, null, null, null, null, null],
  adam: [1, 1, 0, 1, 'PU', 1, 1, 0, 1, 1, 0, 1, null, null, null, null, null, null], // thru 12
  chris: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null], // DNP
}

interface RoundDef {
  key: string
  roundId: string
  holes: HoleInfo[]
  tee: { id: string; rating: number; slope: number; par: number }
  deltas: Record<PlayerKey, Delta>
  status: 'final' | 'in_progress'
  holesCounted: number | null // null => all played holes count / full 18
  dnp: PlayerKey[]
}

const ROUNDS: RoundDef[] = [
  { key: 'R1 Red', roundId: ROUND.red, holes: RED_HOLES, tee: TEE.red, deltas: RED, status: 'final', holesCounted: null, dnp: [] },
  { key: 'R2 Black', roundId: ROUND.black, holes: BLACK_HOLES, tee: TEE.black, deltas: BLACK, status: 'final', holesCounted: 15, dnp: [] },
  { key: 'R3 Blue', roundId: ROUND.blue, holes: BLUE_HOLES, tee: TEE.blue, deltas: BLUE, status: 'in_progress', holesCounted: null, dnp: ['chris'] },
]

// ── SQL emit helpers ─────────────────────────────────────────────────────────
const SEED_CLIENT = '00000000-0000-4000-8000-0000000000FE' // fixed "seed" client_id
// Demo scores must carry client timestamps in the PAST, not on the trip dates. The
// comparator is last-write-wins on client_updated_at_effective and the server clamps an
// incoming timestamp to now() + 5 minutes -- so a seed stamped February 2027 would
// out-rank every real entry made before the trip and get it rejected as stale.
const SEED_STAMP_DATE: Record<string, string> = {
  '2027-02-04': '2026-01-04',
  '2027-02-05': '2026-01-05',
  '2027-02-06': '2026-01-06',
}
const stamp = (roundDate: string) => `${SEED_STAMP_DATE[roundDate]}T18:30:00-05`

function scoreUuid(roundDigit: number, playerDigit: number, hole: number): string {
  const first = `f${roundDigit}${String(playerDigit).padStart(2, '0')}0000`
  return `${first}-0000-4000-8000-${String(hole).padStart(12, '0')}`
}

const ROUND_DATE: Record<string, string> = {
  [ROUND.red]: '2027-02-04',
  [ROUND.black]: '2027-02-05',
  [ROUND.blue]: '2027-02-06',
}
const ROUND_DIGIT: Record<string, number> = { [ROUND.red]: 1, [ROUND.black]: 2, [ROUND.blue]: 3 }

const rpRows: string[] = []
const scoreRows: string[] = []
const roundStatusUpdates: string[] = []

// stderr verification dump
const log = (s: string) => process.stderr.write(s + '\n')

interface CumRow { player: PlayerKey; total: number }
const cumulative: Record<PlayerKey, number> = { jon: 0, kyle: 0, adam: 0, chris: 0 }
const afterRound: { round: string; order: CumRow[] }[] = []

for (const rd of ROUNDS) {
  log(`\n=== ${rd.key}  (status=${rd.status}, holes_counted=${rd.holesCounted ?? 'full'}) ===`)
  const cutoff = rd.holesCounted ?? 18

  for (const pk of PLAYERS) {
    const isDnp = rd.dnp.includes(pk)
    const index = PLAYER_INDEX[pk]
    const hc = computeHandicap({
      index,
      rating: rd.tee.rating,
      slope: rd.tee.slope,
      par: rd.tee.par,
      allowancePct: ALLOWANCE,
      cap: CAP,
    })
    const status = isDnp ? 'did_not_play' : 'playing'

    rpRows.push(
      `  ('${rd.roundId}', '${PLAYER[pk]}', '${rd.tee.id}', ${index}, ${ALLOWANCE.toFixed(3)}, ${CAP}, ` +
        `${hc.courseHandicapUnrounded.toFixed(2)}, ${hc.playingHandicap}, ${hc.capApplied}, ${hc.strokesReceived}, ` +
        `null, '${status}')`,
    )

    if (isDnp) {
      log(`  ${pk.padEnd(6)} DNP`)
      continue
    }

    const alloc = allocateStrokes(hc.strokesReceived, rd.holes)
    const deltas = rd.deltas[pk]
    let pts = 0
    let thru = 0
    for (const hole of rd.holes) {
      const i = hole.holeNumber - 1
      const d = deltas[i]
      if (d === null || d === undefined) continue // not entered
      const pickedUp = d === 'PU'
      const gross = pickedUp ? null : hole.par + (d as number)
      const strokes = alloc.get(hole.holeNumber) ?? 0
      const res = computeHoleResult(hole, { holeNumber: hole.holeNumber, grossStrokes: gross, pickedUp }, strokes, DEFAULT_POINTS_TABLE)
      if (res.completed) thru++
      const counted = hole.holeNumber <= cutoff
      if (counted && res.points !== null) pts += res.points

      const rawGross = pickedUp ? 'null' : String(gross)
      const t = stamp(ROUND_DATE[rd.roundId])
      scoreRows.push(
        `  ('${scoreUuid(ROUND_DIGIT[rd.roundId], PLAYER_DIGIT[pk], hole.holeNumber)}', '${rd.roundId}', '${PLAYER[pk]}', ${hole.holeNumber}, ${rawGross}, ${pickedUp}, '${t}', '${t}', '${SEED_CLIENT}')`,
      )
    }
    if (rd.status === 'final' && rd.key !== 'R3 Blue') cumulative[pk] += pts
    log(`  ${pk.padEnd(6)} PH=${hc.strokesReceived}${hc.capApplied ? ' (cap)' : ''}  thru ${thru}  points(counted)=${pts}`)
  }

  // update round status + holes_counted
  const hcSql = rd.holesCounted === null ? 'null' : String(rd.holesCounted)
  roundStatusUpdates.push(`update public.rounds set status = '${rd.status}', holes_counted = ${hcSql} where id = '${rd.roundId}';`)

  const order = PLAYERS.map((p) => ({ player: p, total: cumulative[p] })).sort((a, b) => b.total - a.total)
  if (rd.status === 'final') afterRound.push({ round: rd.key, order })
}

log('\n=== Cumulative championship (final rounds only) ===')
for (const snap of afterRound) {
  log(`After ${snap.round}: ` + snap.order.map((r, i) => `${i + 1}.${r.player}(${r.total})`).join('  '))
}

// ── Emit SQL ─────────────────────────────────────────────────────────────────
const out: string[] = []
out.push(`-- Phase 4 — Fake scores + round_players snapshots for the read-only UI demo.
--
-- GENERATED by scripts/gen-phase4-seed.ts (do not hand-edit). Idempotent:
-- stable UUIDs + on-conflict guards. Handicap snapshot columns are computed by the
-- real scoring engine (src/lib/scoring) so the app's derived points agree exactly.
--
-- These gross scores are INVENTED for a mid-trip demo before any write path exists
-- (phase-plan.md §Phase 4): R1 Red final (18 holes); R2 Black final but weather-
-- curtailed after 15 (holes_counted=15, holes 16-18 excluded); R3 Blue in progress
-- (~thru 13), Chris did not play. Overwritten by real entry in Phase 5+.
--
-- round_players tees are all Green (championship). index_used mirrors the working
-- placeholder indexes; allowance 1.0, cap 18. Two players cap at 18 — intentional,
-- to exercise the cap badge and the shortened/excluded/PU/DNP rendering paths.

-- ─── Round status (advance from 'upcoming') ──────────────────────────────────`)
out.push(...roundStatusUpdates)

out.push(`
-- ─── round_players (per-round handicap snapshot) ─────────────────────────────
insert into public.round_players
  (round_id, player_id, tee_id, index_used, allowance_used, cap_used,
   course_handicap, playing_handicap, cap_applied, strokes_received,
   manual_override, status) values`)
out.push(rpRows.join(',\n') + '\non conflict (round_id, player_id) do nothing;')

out.push(`
-- ─── scores (gross only; points derived at read time) ────────────────────────
insert into public.scores
  (id, round_id, player_id, hole_number, gross_strokes, picked_up,
   client_updated_at_raw, client_updated_at_effective, client_id) values`)
out.push(scoreRows.join(',\n') + '\non conflict (id) do nothing;')

process.stdout.write(out.join('\n') + '\n')
