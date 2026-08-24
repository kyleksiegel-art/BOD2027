-- Money model revision (Kyle 2026-08-23) — buy-in funds 1st ($600) + 2nd ($200) overall and a
-- per-round winner ($50); no closest-to-pin money (CTP is still entered for bragging rights).
--
-- The whole ledger derives on the client (src/lib/data/money.ts). This migration only keeps the
-- server side consistent: the frozen `round_money` mirror written at finalization now freezes the
-- per-round winner amount (championship is a trip-level 1st/2nd, decided at the end, so it is not
-- a per-round figure; CTP pays nothing). The `round_money` table shape is unchanged — the
-- championship_share and ctp columns are simply frozen at 0.
--
-- purse settings now live in `purse_amounts` as:
--   { buy_in_per_player_cents, champ_first_cents, champ_second_cents, round_winner_cents }
-- rpc_upsert_settings already accepts any object for purse_amounts, so no change there.

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
  for v_gap in
    select p.name, pg_catalog.count(*)::int as missing
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
    v_errors := v_errors || (v_gap.name || ' is missing ' || v_gap.missing || ' hole(s)');
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

-- Refresh the seeded purse defaults to the new shape for fresh installs. Existing installs keep
-- whatever admin has set (this only fires when the row is still the original placeholder).
update public.settings
   set value = '{"buy_in_per_player_cents":25000,"champ_first_cents":60000,"champ_second_cents":20000,"round_winner_cents":5000}'::jsonb
 where key = 'purse_amounts'
   and value ? 'fixed_cents'; -- the old shape had fixed_cents; new shape does not
