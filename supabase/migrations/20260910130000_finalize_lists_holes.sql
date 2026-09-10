-- 2026-09-09 audit (F-020): the finalize refusal now names the missing HOLE NUMBERS, not
-- just a per-player count ("Jon Aronson is missing holes 16, 17" instead of "… 2 hole(s)").
-- On a shortened round the scorer needs to know which holes are blank to decide whether to
-- enter them or set the cutoff. This re-declares rpc_finalize_round from the money-model
-- revision (20260823120000) with only the gap loop changed; everything else is identical.

create or replace function public.rpc_finalize_round(
  session_token text,
  p_round_id uuid,
  p_holes_counted int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round        public.rounds%rowtype;
  v_upto         int;
  v_errors       text[] := '{}';
  v_gap          record;
  v_round_winner int;
  v_par3_here    int;
begin
  perform public.fn_require_session(session_token);

  select r.* into v_round from public.rounds r where r.id = p_round_id;
  if not found then
    raise exception 'round not found' using errcode = 'P0002';
  end if;
  if v_round.status = 'abandoned' then
    return jsonb_build_object('finalized', false,
      'errors', jsonb_build_array('the round is abandoned'));
  end if;
  if p_holes_counted is not null and (p_holes_counted < 1 or p_holes_counted > 18) then
    raise exception 'holes_counted must be between 1 and 18' using errcode = '22023';
  end if;

  -- null holes_counted means the full round. A shortened round (weather, darkness) names
  -- its cutoff and only those holes are required.
  v_upto := coalesce(p_holes_counted, 18);

  -- DNP players are excluded here exactly as they are excluded from holes-won and the
  -- shortened-round cutoff in the scoring engine.
  -- List the actual missing hole NUMBERS, not just a count, so the scorer knows exactly what
  -- to enter or whether to shorten the round (audit F-020).
  for v_gap in
    select p.name,
           pg_catalog.array_agg(g.hole order by g.hole) as holes
      from public.round_players rp
      join public.players p on p.id = rp.player_id
      cross join pg_catalog.generate_series(1, v_upto) g(hole)
      left join public.scores s
             on s.round_id = rp.round_id and s.player_id = rp.player_id
            and s.hole_number = g.hole
     where rp.round_id = p_round_id
       and rp.status = 'playing'
       and (s.round_id is null or (s.gross_strokes is null and not s.picked_up))
     group by p.name, p.sort_order
     order by p.sort_order
  loop
    v_errors := v_errors || (
      v_gap.name || ' is missing hole' ||
      case when pg_catalog.array_length(v_gap.holes, 1) = 1 then ' ' else 's ' end ||
      pg_catalog.array_to_string(v_gap.holes, ', '));
  end loop;

  if pg_catalog.array_length(v_errors, 1) is not null then
    return jsonb_build_object('finalized', false, 'errors', pg_catalog.to_jsonb(v_errors));
  end if;

  -- ── Freeze the money ───────────────────────────────────────────────────────
  -- Only the per-round winner amount is a per-round figure now. Championship (1st/2nd overall)
  -- is decided across the whole trip, and CTP pays nothing, so both freeze at 0.
  select coalesce((s.value ->> 'round_winner_cents')::int, 0) into v_round_winner
    from public.settings s where s.key = 'purse_amounts';
  v_round_winner := coalesce(v_round_winner, 0);

  select pg_catalog.count(*)::int into v_par3_here
    from public.holes h where h.course_id = v_round.course_id and h.par = 3;

  update public.rounds r
     set status = 'final', holes_counted = p_holes_counted
   where r.id = p_round_id;

  insert into public.round_money as m
    (round_id, championship_share_cents, round_purse_cents, ctp_pot_cents, par_3_count, frozen_at)
  values
    (p_round_id, 0, v_round_winner, 0, v_par3_here, pg_catalog.now())
  on conflict (round_id) do update
     set championship_share_cents = excluded.championship_share_cents,
         round_purse_cents        = excluded.round_purse_cents,
         ctp_pot_cents            = excluded.ctp_pot_cents,
         par_3_count              = excluded.par_3_count,
         frozen_at                = excluded.frozen_at;

  return jsonb_build_object(
    'finalized', true, 'errors', '[]'::jsonb,
    'round_money', (select pg_catalog.to_jsonb(m) from public.round_money m where m.round_id = p_round_id));
end;
$$;

revoke execute on function public.rpc_finalize_round(text, uuid, int) from public;
grant  execute on function public.rpc_finalize_round(text, uuid, int) to anon;
