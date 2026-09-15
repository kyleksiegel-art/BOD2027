-- 2026-09-14 — Reset a round to "upcoming".
--
-- Pre-trip testing left rounds in_progress with no way back: rpc_clear_round_scores wipes a
-- round but deliberately leaves it in_progress (its use is a mid-round re-entry), and
-- start/finalize/reopen/abandon only move forward. The January checklist needs every round
-- back to upcoming, as if it had never started. Same wipe as clear-scores, then status =
-- upcoming. round_players (tees, handicaps, playing/DNP) are kept — they are setup, not play.
create or replace function public.rpc_reset_round(session_token text, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.rounds%rowtype;
begin
  perform public.fn_require_session(session_token);

  select r.* into v_row from public.rounds r where r.id = p_round_id;
  if v_row.id is null then
    raise exception 'round not found' using errcode = 'P0002';
  end if;

  delete from public.scores       s where s.round_id = p_round_id;
  delete from public.ctp_results  c where c.round_id = p_round_id;
  delete from public.round_money  m where m.round_id = p_round_id;

  update public.rounds r
     set status = 'upcoming', holes_counted = null
   where r.id = p_round_id
  returning r.* into v_row;

  return jsonb_build_object('reset', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;
revoke execute on function public.rpc_reset_round(text, uuid) from public;
grant  execute on function public.rpc_reset_round(text, uuid) to anon;
