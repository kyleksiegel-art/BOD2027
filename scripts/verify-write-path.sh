#!/usr/bin/env bash
# Phase 5A — the write path and the auth posture, demonstrated against a live API rather
# than asserted. Every rule is also covered by supabase/tests/write_path.sql; this script
# proves the same rules survive the PostgREST and Edge Function hops.
#
# Score and CTP entry are OPEN by decision (docs/spec/decisions.md §"PIN removed from score
# entry"); /admin and rpc_upsert_round_player still require a PIN session. Both halves are
# demonstrated below, because "which writes are gated" is exactly the thing that drifts.
#
# Usage (local):
#   supabase start
#   supabase functions serve --env-file supabase/functions/.env --no-verify-jwt   # separate shell
#   ./scripts/verify-write-path.sh
#
# Against a deployed project, export API_URL / ANON_KEY / PIN first.
set -uo pipefail

API_URL="${API_URL:-http://127.0.0.1:54321}"
ANON_KEY="${ANON_KEY:-$(supabase status -o json 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin)["ANON_KEY"])')}"
PIN="${PIN:-1922}"

R3=e0000000-0000-4000-8000-000000000003   # Round 3, Blue, in progress
R4=e0000000-0000-4000-8000-000000000004   # Round 4, Bone Valley, placeholder card
JON=d0000000-0000-4000-8000-000000000001
CHRIS=d0000000-0000-4000-8000-000000000004  # DNP in round 3
CID=11111111-1111-1111-1111-111111111111
TS=2026-08-17T12:00:00Z

hdr=(-H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}" -H 'Content-Type: application/json')
rpc() { curl -s -w '\n  HTTP %{http_code}\n' -X POST "${API_URL}/rest/v1/rpc/$1" "${hdr[@]}" -d "$2"; }

# One score cell. $1 round, $2 player, $3 hole, $4 gross (null allowed), $5 picked_up, $6 raw ts
cell() {
  printf '{"round_id":"%s","player_id":"%s","hole_number":%s,"gross_strokes":%s,"picked_up":%s,"client_updated_at_raw":"%s","client_id":"%s"}' \
    "$1" "$2" "$3" "$4" "$5" "$6" "${CID}"
}

echo "── 1. anon cannot write to a table directly (RLS + blanket REVOKE) ──"
curl -s -w '\n  HTTP %{http_code}\n' -X POST "${API_URL}/rest/v1/scores" "${hdr[@]}" \
  -d "{\"round_id\":\"${R3}\",\"player_id\":\"${JON}\",\"hole_number\":1,\"gross_strokes\":4,\"client_updated_at_raw\":\"${TS}\",\"client_updated_at_effective\":\"${TS}\",\"client_id\":\"${CID}\"}"

echo "── 2. anon cannot mint itself a session ──"
rpc rpc_create_session '{"token_hash":"forged","expires_at":"2027-02-08T00:00:00Z"}'

echo "── 3. the still-gated RPCs refuse a forged token ──"
rpc rpc_upsert_round_player '{"session_token":"forged","entries":[]}'
rpc rpc_revoke_all_sessions '{"admin_token":"forged"}'

echo "── 4. a wrong PIN is refused, in constant language ──"
curl -s -w '\n  HTTP %{http_code}\n' -X POST "${API_URL}/functions/v1/pin-verify" \
  -H 'Content-Type: application/json' -d '{"pin":"000000"}'

echo "── 5. a malformed PIN gets the SAME answer (no oracle) ──"
curl -s -w '\n  HTTP %{http_code}\n' -X POST "${API_URL}/functions/v1/pin-verify" \
  -H 'Content-Type: application/json' -d '{"pin":"nope"}'

echo "── 6. the correct PIN mints a session (for /admin, not for scoring) ──"
TOKEN=$(curl -s -X POST "${API_URL}/functions/v1/pin-verify" \
  -H 'Content-Type: application/json' -d "{\"pin\":\"${PIN}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
if [ -z "${TOKEN}" ]; then echo "  FAILED to unlock — is the Edge Function running?"; exit 1; fi
echo "  token ${TOKEN:0:12}… (the server stored only its SHA-256)"

echo "── 7. a score write is accepted with NO session token at all ──"
rpc rpc_upsert_scores "{\"cells\":[$(cell "${R3}" "${JON}" 18 5 false "${TS}")]}"

echo "── 8. every validation rule, one cell each, and the batch survives ──"
echo "     (upcoming round | DNP player | gross > 25 | picked_up with a gross |"
echo "      unknown hole | malformed uuid | then one good cell)"
rpc rpc_upsert_scores "{\"cells\":[
  $(cell "${R4}"        "${JON}"   1  4    false "${TS}"),
  $(cell "${R3}"        "${CHRIS}" 1  4    false "${TS}"),
  $(cell "${R3}"        "${JON}"   16 26   false "${TS}"),
  $(cell "${R3}"        "${JON}"   16 4    true  "${TS}"),
  $(cell "${R3}"        "${JON}"   19 4    false "${TS}"),
  $(cell "not-a-uuid"   "${JON}"   16 4    false "${TS}"),
  $(cell "${R3}"        "${JON}"   16 6    false "${TS}")
]}"

echo "── 9. the comparator: an older write loses and is handed the winner ──"
rpc rpc_upsert_scores "{\"cells\":[$(cell "${R3}" "${JON}" 18 9 false 2026-08-17T11:00:00Z)]}"

echo "── 10. six wrong PINs throttle unlocking — while the issued session keeps"
echo "       working and open score entry never depended on it ──"
for _ in 1 2 3 4 5 6; do
  curl -s -o /dev/null -X POST "${API_URL}/functions/v1/pin-verify" \
    -H 'Content-Type: application/json' -d '{"pin":"000000"}'
done
echo "  unlocking is now throttled:"
curl -s -w '\n  HTTP %{http_code}\n' -X POST "${API_URL}/functions/v1/pin-verify" \
  -H 'Content-Type: application/json' -d "{\"pin\":\"${PIN}\"}"
echo "  the already-issued session still reaches a gated RPC:"
rpc rpc_upsert_round_player "{\"session_token\":\"${TOKEN}\",\"entries\":[]}"
echo "  and score entry is unaffected either way:"
rpc rpc_upsert_scores "{\"cells\":[$(cell "${R3}" "${JON}" 18 4 false 2026-08-17T13:00:00Z)]}"
