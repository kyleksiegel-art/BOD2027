-- Clear-scores replaces Abandon in the admin UI (Kyle, 2026-08-23).
--
-- "Abandon" was a one-way door: it dropped a round out of the money and there was no way
-- back from the app. In practice the thing you actually want on the day is a reset — wipe a
-- round's scores after a bad-data test or a mis-entry and re-enter from scratch — not a
-- permanent write-off. So the admin action is now "Clear scores".
--
-- This deletes the round's scores, CTP results and any frozen money, then puts the round
-- back to in_progress with holes_counted reset. The round_players (tees + handicaps) are
-- KEPT, so the round is immediately re-enterable without re-picking tees or re-starting.
--
-- The abandoned status itself stays a valid concept in the schema and the scoring/money
-- engine (a round that never happened), and rpc_abandon_round is left in place for the SQL
-- test surface; only the UI door changes. Clearing an already-abandoned round also revives
-- it (status -> in_progress), which is the deliberate un-abandon path.

create or replace function public.rpc_clear_round_scores(session_token text, p_round_id uuid)
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
     set status = 'in_progress', holes_counted = null
   where r.id = p_round_id
  returning r.* into v_row;

  return jsonb_build_object('cleared', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

revoke execute on function public.rpc_clear_round_scores(text, uuid) from public;
grant  execute on function public.rpc_clear_round_scores(text, uuid) to anon;
