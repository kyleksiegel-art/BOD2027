// CSV shaping for the admin export (brief §Diagnostics: "export all scores as CSV/JSON").
//
// The JSON export is the faithful, reproduce-anything dump. The CSV is the human one: one
// row per entered score, names resolved, sorted round → player → hole, openable in any
// spreadsheet. It is derived entirely from the same rpc_export_all_scores payload, so the
// two exports can never disagree.

interface ExportPayload {
  players?: { id: string; name: string }[]
  courses?: { id: string; name: string }[]
  rounds?: { id: string; round_number: number; course_id: string; date: string }[]
  scores?: {
    round_id: string
    player_id: string
    hole_number: number
    gross_strokes: number | null
    picked_up: boolean
  }[]
}

/** RFC-4180-ish escaping: quote a field iff it contains a comma, quote or newline. */
function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toRows(headers: string[], rows: (string | number | boolean | null)[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

/** One row per entered score, names resolved, sorted round → player → hole. */
export function scoresToCsv(payload: ExportPayload): string {
  const playerName = new Map((payload.players ?? []).map((p) => [p.id, p.name]))
  const courseName = new Map((payload.courses ?? []).map((c) => [c.id, c.name]))
  const round = new Map((payload.rounds ?? []).map((r) => [r.id, r]))

  const rows = (payload.scores ?? [])
    .map((s) => {
      const r = round.get(s.round_id)
      return {
        roundNumber: r?.round_number ?? 0,
        course: r ? (courseName.get(r.course_id) ?? '') : '',
        date: r?.date ?? '',
        player: playerName.get(s.player_id) ?? s.player_id,
        hole: s.hole_number,
        gross: s.gross_strokes,
        pickedUp: s.picked_up,
      }
    })
    .sort(
      (a, b) =>
        a.roundNumber - b.roundNumber ||
        a.player.localeCompare(b.player) ||
        a.hole - b.hole,
    )

  return toRows(
    ['round', 'course', 'date', 'player', 'hole', 'gross_strokes', 'picked_up'],
    rows.map((r) => [r.roundNumber, r.course, r.date, r.player, r.hole, r.gross, r.pickedUp]),
  )
}
