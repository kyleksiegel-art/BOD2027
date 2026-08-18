#!/usr/bin/env bash
# Phase 5B — the admin path, demonstrated against a live API rather than asserted. Every
# rule is also covered by supabase/tests/admin_path.sql; this script proves the same rules
# survive the PostgREST and Edge Function hops, with a real token minted by a real PIN.
#
# It MUTATES the local database (it finalizes and abandons rounds). Run `supabase db reset`
# afterwards to get the seeded state back.
#
# Usage (local):
#   supabase start
#   supabase functions serve --env-file supabase/functions/.env --no-verify-jwt   # separate shell
#   ./scripts/verify-admin-path.sh
#
# Against a deployed project, export API_URL / ANON_KEY / PIN first.
set -uo pipefail

API_URL="${API_URL:-http://127.0.0.1:54321}"
ANON_KEY="${ANON_KEY:-$(supabase status -o json 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin)["ANON_KEY"])')}"
PIN="${PIN:-271828}"

RED=c0000000-0000-4000-8000-000000000001
BONE=c0000000-0000-4000-8000-000000000004
R1=e0000000-0000-4000-8000-000000000001   # Red, complete scores
R3=e0000000-0000-4000-8000-000000000003   # Blue, in progress, Chris DNP
R4=e0000000-0000-4000-8000-000000000004   # Bone Valley, placeholder card
JON=d0000000-0000-4000-8000-000000000001

hdr=(-H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}" -H 'Content-Type: application/json')
rpc() { curl -s -w '\n  HTTP %{http_code}\n' -X POST "${API_URL}/rest/v1/rpc/$1" "${hdr[@]}" -d "$2"; }

echo "── 1. every admin RPC refuses a forged token (403, before any argument is read) ──"
# PostgREST resolves an overload by exact parameter names, so each call has to carry the
# real argument list — a short body is a 404 at the routing layer and proves nothing about
# the session check. Every one of these should be 403 (28000 through this PostgREST).
while IFS='|' read -r fn body; do
  [ -z "${fn}" ] && continue
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL}/rest/v1/rpc/${fn}" "${hdr[@]}" -d "${body}")
  printf '  %-40s HTTP %s\n' "${fn}" "${code}"
done <<'RPCS'
rpc_upsert_player|{"session_token":"forged","p_id":null,"p_name":"X","p_title":null,"p_handicap_index":1,"p_index_is_assigned":false,"p_photo_url":null,"p_sort_order":9}
rpc_upsert_course|{"session_token":"forged","p_id":null,"p_name":"X","p_architect":"A","p_year_opened":2000,"p_description":"d"}
rpc_upsert_tee|{"session_token":"forged","p_id":null,"p_course_id":null,"p_name":"X","p_rating":null,"p_slope":null,"p_par":72,"p_total_yardage":null}
rpc_upsert_hole|{"session_token":"forged","p_id":null,"p_course_id":null,"p_hole_number":1,"p_par":4,"p_stroke_index":1}
rpc_upsert_hole_yardage|{"session_token":"forged","p_hole_id":null,"p_tee_id":null,"p_yardage":400}
rpc_validate_and_publish_course|{"session_token":"forged","p_course_id":null}
rpc_upsert_round|{"session_token":"forged","p_id":null,"p_round_number":1,"p_date":"2027-02-04","p_course_id":null,"p_tee_time":null}
rpc_upsert_round_player_admin|{"session_token":"forged","entries":[]}
rpc_resnapshot_round_handicaps|{"session_token":"forged","p_round_id":null}
rpc_start_round|{"session_token":"forged","p_round_id":null}
rpc_finalize_round|{"session_token":"forged","p_round_id":null,"p_holes_counted":null}
rpc_abandon_round|{"session_token":"forged","p_round_id":null}
rpc_set_manual_override|{"session_token":"forged","p_round_id":null,"p_player_id":null,"p_override":1}
rpc_upsert_settings|{"session_token":"forged","p_key":"allowance","p_value":1}
rpc_upsert_itinerary|{"session_token":"forged","entries":[]}
rpc_upsert_lodging|{"session_token":"forged","p_id":null,"p_property":"X","p_check_in":"2027-02-04","p_check_out":"2027-02-07","p_confirmation":null,"p_notes":null}
rpc_upsert_lodging_assignment|{"session_token":"forged","p_id":null,"p_lodging_id":null,"p_player_id":null,"p_room_label":null}
rpc_export_all_scores|{"session_token":"forged"}
RPCS

echo
echo "── 2. anon still cannot write to an admin table directly ──"
curl -s -w '\n  HTTP %{http_code}\n' -X PATCH "${API_URL}/rest/v1/courses?id=eq.${BONE}" "${hdr[@]}" \
  -d '{"data_is_placeholder":false}'

echo
echo "── 3. unlock with the real PIN ──"
TOKEN=$(curl -s -X POST "${API_URL}/functions/v1/pin-verify" \
  -H 'Content-Type: application/json' -d "{\"pin\":\"${PIN}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
if [ -z "${TOKEN}" ]; then echo "  FAILED to unlock — is the Edge Function running?"; exit 1; fi
echo "  token ${TOKEN:0:12}… (the server stored only its SHA-256)"

echo
echo "── 4. Bone Valley refuses to publish, and says exactly what is missing ──"
rpc rpc_validate_and_publish_course "{\"session_token\":\"${TOKEN}\",\"p_course_id\":\"${BONE}\"}"

echo "── 5. …so round 4 refuses to start ──"
rpc rpc_start_round "{\"session_token\":\"${TOKEN}\",\"p_round_id\":\"${R4}\"}"

echo "── 6. a card that IS complete publishes ──"
rpc rpc_validate_and_publish_course "{\"session_token\":\"${TOKEN}\",\"p_course_id\":\"${RED}\"}"

echo "── 7. editing a hole un-publishes it again (a changed card is not a validated card) ──"
rpc rpc_upsert_hole "{\"session_token\":\"${TOKEN}\",\"p_id\":null,\"p_course_id\":\"${RED}\",\"p_hole_number\":6,\"p_par\":3,\"p_stroke_index\":18}"
curl -s "${API_URL}/rest/v1/courses?id=eq.${RED}&select=name,data_is_placeholder" "${hdr[@]}"; echo
rpc rpc_validate_and_publish_course "{\"session_token\":\"${TOKEN}\",\"p_course_id\":\"${RED}\"}"

echo "── 8. field validation: a slope typo, a bad hole number, a cross-course yardage ──"
rpc rpc_upsert_tee "{\"session_token\":\"${TOKEN}\",\"p_id\":null,\"p_course_id\":\"${RED}\",\"p_name\":\"Typo\",\"p_rating\":74.1,\"p_slope\":1370,\"p_par\":72,\"p_total_yardage\":6500}"
rpc rpc_upsert_hole "{\"session_token\":\"${TOKEN}\",\"p_id\":null,\"p_course_id\":\"${RED}\",\"p_hole_number\":19,\"p_par\":4,\"p_stroke_index\":1}"

echo "── 9. a tee from another course is refused for a round_player ──"
BLACK_TEE=$(curl -s "${API_URL}/rest/v1/tees?course_id=eq.c0000000-0000-4000-8000-000000000003&select=id&limit=1" "${hdr[@]}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')
rpc rpc_upsert_round_player_admin "{\"session_token\":\"${TOKEN}\",\"entries\":[{\"round_id\":\"${R3}\",\"player_id\":\"${JON}\",\"tee_id\":\"${BLACK_TEE}\",\"index_used\":9.2,\"allowance_used\":1.0,\"cap_used\":18}]}"

echo "── 10. settings: an unknown key, a malformed points table, a 150% allowance ──"
rpc rpc_upsert_settings "{\"session_token\":\"${TOKEN}\",\"p_key\":\"points_tabel\",\"p_value\":{}}"
rpc rpc_upsert_settings "{\"session_token\":\"${TOKEN}\",\"p_key\":\"points_table\",\"p_value\":{\"level\":2}}"
rpc rpc_upsert_settings "{\"session_token\":\"${TOKEN}\",\"p_key\":\"allowance\",\"p_value\":1.5}"
rpc rpc_upsert_settings "{\"session_token\":\"${TOKEN}\",\"p_key\":\"allowance\",\"p_value\":0.95}"

echo "── 11. finalize refuses while holes are missing, and names who is short ──"
echo "      (Chris is did_not_play in round 3 and must NOT appear)"
rpc rpc_finalize_round "{\"session_token\":\"${TOKEN}\",\"p_round_id\":\"${R3}\",\"p_holes_counted\":null}"

echo "── 12. a complete round finalizes and freezes its money ──"
rpc rpc_finalize_round "{\"session_token\":\"${TOKEN}\",\"p_round_id\":\"${R1}\",\"p_holes_counted\":null}"

echo "── 13. a final round refuses to re-snapshot (its money is already frozen) ──"
rpc rpc_resnapshot_round_handicaps "{\"session_token\":\"${TOKEN}\",\"p_round_id\":\"${R1}\"}"

echo "── 14. abandoning a round removes its frozen money row ──"
rpc rpc_abandon_round "{\"session_token\":\"${TOKEN}\",\"p_round_id\":\"${R1}\"}"
curl -s "${API_URL}/rest/v1/round_money?select=round_id" "${hdr[@]}"; echo

echo "── 15. the export carries everything needed to reproduce the trip ──"
curl -s -X POST "${API_URL}/rest/v1/rpc/rpc_export_all_scores" "${hdr[@]}" \
  -d "{\"session_token\":\"${TOKEN}\"}" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  keys:", ", ".join(sorted(d))); print("  scores:", len(d["scores"]), "rows · round_players:", len(d["round_players"]))'

echo
echo "Done. Run \`supabase db reset\` to restore the seeded state."
