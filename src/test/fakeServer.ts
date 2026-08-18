// An in-memory stand-in for rpc_upsert_scores / rpc_upsert_ctp.
//
// It exists to exercise the CLIENT: coalescing, retries, dead-lettering, the pending-write
// shield, two devices converging. It applies the same guard the SQL does — but note what
// that does and does not prove. It does NOT prove the SQL guard is correct; a mocked RPC
// proves nothing about Postgres, which is why the guard has its own pgTAP assertions in
// supabase/tests/write_path.sql and why src/lib/sync/comparator.test.ts re-runs those exact
// cases in TypeScript. What this proves is that the client behaves correctly given a
// server that behaves as specified.
import { incomingWins } from '@/lib/sync/comparator'
import { OfflineError, TransportError, type RpcResult, type Transport } from '@/lib/sync/outbox'
import type { CtpResultRow, ScoreRow } from '@/lib/data/types'

type Cell = {
  round_id: string
  player_id: string
  hole_number: number
  gross_strokes: number | null
  picked_up: boolean
  client_updated_at_raw: string
  client_id: string
}

export class FakeServer {
  scores = new Map<string, ScoreRow>()
  ctp = new Map<string, CtpResultRow>()

  /** No route to the server. Requests never land; nothing may be counted against them. */
  offline = false
  /** The server answers, badly (a 5xx). Retryable. */
  failing = false
  /** Cells the server refuses on their merits, keyed `round|player|hole` → error code. */
  refusals = new Map<string, string>()
  /** Every cell the wire actually carried, in order — the coalescing assertions read this. */
  received: Cell[] = []
  requests = 0
  /** Server "now", for the 5-minute clamp on client_updated_at_effective. */
  now = '2027-02-06T20:00:00.000Z'

  transport: Transport = {
    call: async (fn, args) => {
      this.requests += 1
      if (this.offline) throw new OfflineError('Failed to fetch')
      if (this.failing) throw new TransportError('500 internal server error')
      return fn === 'rpc_upsert_scores'
        ? this.upsertScores((args.cells ?? []) as Cell[])
        : this.upsertCtp((args.results ?? []) as never[])
    },
  }

  private clamp(raw: string): string {
    const limit = Date.parse(this.now) + 5 * 60_000
    return Date.parse(raw) > limit ? new Date(limit).toISOString() : raw
  }

  private upsertScores(cells: Cell[]): RpcResult[] {
    const out: RpcResult[] = []
    for (const cell of cells) {
      this.received.push(cell)
      const k = `${cell.round_id}|${cell.player_id}|${cell.hole_number}`
      const key = {
        round_id: cell.round_id,
        player_id: cell.player_id,
        hole_number: cell.hole_number,
      }

      const refusal = this.refusals.get(k)
      if (refusal) {
        out.push({ key, applied: false, error: refusal, row: null })
        continue
      }

      const effective = this.clamp(cell.client_updated_at_raw)
      const incoming: ScoreRow = {
        id: this.scores.get(k)?.id ?? `srv-${k}`,
        round_id: cell.round_id,
        player_id: cell.player_id,
        hole_number: cell.hole_number,
        gross_strokes: cell.gross_strokes,
        picked_up: cell.picked_up,
        client_updated_at_raw: cell.client_updated_at_raw,
        client_updated_at_effective: effective,
        client_id: cell.client_id,
      }
      const existing = this.scores.get(k)
      if (incomingWins(incoming, existing)) {
        this.scores.set(k, incoming)
        out.push({ key, applied: true, error: null, row: incoming })
      } else {
        // The guard rejected it. Hand back the current winner so the loser rolls itself
        // back rather than guessing.
        out.push({ key, applied: false, error: 'stale', row: existing! })
      }
    }
    return out
  }

  private upsertCtp(results: (Omit<Cell, 'player_id' | 'gross_strokes' | 'picked_up'> & {
    player_id: string | null
    distance_feet: number | null
  })[]): RpcResult[] {
    const out: RpcResult[] = []
    for (const r of results) {
      const k = `${r.round_id}|${r.hole_number}`
      const key = { round_id: r.round_id, hole_number: r.hole_number }
      const refusal = this.refusals.get(k)
      if (refusal) {
        out.push({ key, applied: false, error: refusal, row: null })
        continue
      }
      const incoming: CtpResultRow = {
        id: this.ctp.get(k)?.id ?? `srv-${k}`,
        round_id: r.round_id,
        hole_number: r.hole_number,
        player_id: r.player_id,
        distance_feet: r.distance_feet,
        client_updated_at_raw: r.client_updated_at_raw,
        client_updated_at_effective: this.clamp(r.client_updated_at_raw),
        client_id: r.client_id,
      }
      const existing = this.ctp.get(k)
      if (incomingWins(incoming, existing)) {
        this.ctp.set(k, incoming)
        out.push({ key, applied: true, error: null, row: incoming })
      } else {
        out.push({ key, applied: false, error: 'stale', row: existing! })
      }
    }
    return out
  }

  /** The rows a fresh hydrate would fetch. */
  scoreRows(): ScoreRow[] {
    return [...this.scores.values()]
  }
}
