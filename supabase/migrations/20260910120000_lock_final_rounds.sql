-- 2026-09-09 audit (findings F-009 / F-021 companion): a finalized round is closed to scoring.
--
-- Before this, rpc_upsert_scores refused only `upcoming` rounds and rpc_upsert_ctp checked
-- no status at all, so a cell saved on the Enter screen — or a cell queued offline and
-- flushed hours later — landed on a round admin had already marked final. `round_money` had
-- frozen the $ figure but the WINNER is derived live, so the payee moved under a "Frozen"
-- label. Now:
--   · rpc_upsert_scores / rpc_upsert_ctp refuse `final` ('round_final') and `abandoned`
--     ('round_abandoned') rounds per cell, in the same terminal vocabulary the outbox already
--     dead-letters on. (CTP on an `upcoming` round stays accepted, as before — write_path.sql
--     relies on the par-3 check being reachable there.)
--   · rpc_reopen_round(session_token, round_id) is the non-destructive way back: final →
--     in_progress, holes_counted cleared, the frozen round_money row removed (finalize
--     rewrites it). Scores and tees are untouched. Session-gated like every admin RPC.
-- Bodies below are the 20260818 functions with the status checks added; nothing else moved.

create or replace function public.rpc_upsert_scores(cells jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cell        jsonb;
  v_round_id    uuid;
  v_player_id   uuid;
  v_hole        int;
  v_gross       int;
  v_picked_up   boolean;
  v_raw         timestamptz;
  v_effective   timestamptz;
  v_client_id   uuid;
  v_status      public.round_status;
  v_course_id   uuid;
  v_placeholder boolean;
  v_rp_status   public.rp_status;
  v_row         public.scores%rowtype;
  v_err         text;
  v_out         jsonb := '[]'::jsonb;
  v_key         jsonb;
begin
  -- No session check by design (see the header). The validation rules below are what
  -- stands between an open endpoint and a poisoned leaderboard, so they carry more weight
  -- here than they did when a PIN also had to be right.
  if cells is null or jsonb_typeof(cells) <> 'array' then
    raise exception 'cells must be a json array' using errcode = '22023';
  end if;

  for v_cell in select * from jsonb_array_elements(cells) loop
    v_err := null;
    v_row := null;

    -- Echo the key back exactly as sent. Casting it out here, OUTSIDE the per-cell
    -- exception block, would let one malformed uuid abort the entire batch -- which is
    -- precisely the failure this RPC exists to prevent.
    v_key := jsonb_build_object(
      'round_id', v_cell -> 'round_id', 'player_id', v_cell -> 'player_id',
      'hole_number', v_cell -> 'hole_number');
    v_round_id := null; v_player_id := null; v_hole := null;

    begin
      v_round_id  := nullif(v_cell ->> 'round_id', '')::uuid;
      v_player_id := nullif(v_cell ->> 'player_id', '')::uuid;
      v_hole      := (v_cell ->> 'hole_number')::int;
      v_gross     := nullif(v_cell ->> 'gross_strokes', '')::int;
      v_picked_up := coalesce((v_cell ->> 'picked_up')::boolean, false);
      v_raw       := (v_cell ->> 'client_updated_at_raw')::timestamptz;
      v_client_id := (v_cell ->> 'client_id')::uuid;

      -- The server, not the client, decides the effective timestamp: a phone whose clock
      -- is set to 2031 must not win every comparison for the rest of the trip.
      v_effective := least(v_raw, pg_catalog.now() + interval '5 minutes');

      if v_round_id is null or v_player_id is null or v_hole is null
         or v_raw is null or v_client_id is null then
        v_err := 'missing_required_field';
      end if;

      if v_err is null then
        select r.status, r.course_id into v_status, v_course_id
          from public.rounds r where r.id = v_round_id;
        if v_status is null then
          v_err := 'round_not_found';
        elsif v_status = 'upcoming' then
          v_err := 'round_upcoming';
        elsif v_status = 'final' then
          -- Closed to scoring once finalized: the round winner and its money are settled.
          -- Corrections go through rpc_reopen_round first (2026-09-09 audit, F-009).
          v_err := 'round_final';
        elsif v_status = 'abandoned' then
          v_err := 'round_abandoned';
        end if;
      end if;

      -- Belt-and-braces for the Round 4 Bone Valley hard block. The Enter screen refuses
      -- first; this makes a direct API call refuse too.
      if v_err is null then
        select c.data_is_placeholder into v_placeholder
          from public.courses c where c.id = v_course_id;
        if v_placeholder then
          v_err := 'course_data_is_placeholder';
        end if;
      end if;

      if v_err is null then
        select rp.status into v_rp_status
          from public.round_players rp
         where rp.round_id = v_round_id and rp.player_id = v_player_id;
        if v_rp_status is null then
          v_err := 'no_round_player_row';
        elsif v_rp_status <> 'playing' then
          v_err := 'player_not_playing';
        end if;
      end if;

      if v_err is null and not exists (
        select 1 from public.holes h
         where h.course_id = v_course_id and h.hole_number = v_hole
      ) then
        v_err := 'hole_not_on_course';
      end if;

      if v_err is null and v_gross is not null and (v_gross < 1 or v_gross > 25) then
        v_err := 'gross_strokes_out_of_range';
      end if;

      if v_err is null and v_picked_up and v_gross is not null then
        v_err := 'picked_up_requires_null_gross';
      end if;

      if v_err is null then
        insert into public.scores as s (
          round_id, player_id, hole_number, gross_strokes, picked_up,
          client_updated_at_raw, client_updated_at_effective, client_id, updated_at)
        values (
          v_round_id, v_player_id, v_hole, v_gross, v_picked_up,
          v_raw, v_effective, v_client_id, pg_catalog.now())
        on conflict (round_id, player_id, hole_number) do update
           set gross_strokes               = excluded.gross_strokes,
               picked_up                   = excluded.picked_up,
               client_updated_at_raw       = excluded.client_updated_at_raw,
               client_updated_at_effective = excluded.client_updated_at_effective,
               client_id                   = excluded.client_id,
               updated_at                  = pg_catalog.now()
         where (excluded.client_updated_at_effective, excluded.client_id)
             > (s.client_updated_at_effective, s.client_id)
        returning s.* into v_row;
      end if;
    exception when others then
      v_err := 'db_error: ' || sqlstate;
    end;

    if v_err is not null then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', false, 'error', v_err, 'row', null));
    elsif v_row.id is not null then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', true, 'error', null,
                           'row', pg_catalog.to_jsonb(v_row)));
    else
      -- Guard rejected it as stale. Hand back the current winner so the loser can roll
      -- itself back to the winning row instead of guessing.
      select s.* into v_row from public.scores s
       where s.round_id = v_round_id and s.player_id = v_player_id and s.hole_number = v_hole;
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', false, 'error', 'stale',
                           'row', pg_catalog.to_jsonb(v_row)));
    end if;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.rpc_upsert_scores(jsonb) from public;
grant  execute on function public.rpc_upsert_scores(jsonb) to anon;

create or replace function public.rpc_upsert_ctp(results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res       jsonb;
  v_round_id  uuid;
  v_hole      int;
  v_player_id uuid;
  v_distance  numeric;
  v_raw       timestamptz;
  v_effective timestamptz;
  v_client_id uuid;
  v_course_id uuid;
  v_status    public.round_status;
  v_par       int;
  v_rp_status public.rp_status;
  v_row       public.ctp_results%rowtype;
  v_err       text;
  v_out       jsonb := '[]'::jsonb;
  v_key       jsonb;
begin
  -- Open, like rpc_upsert_scores. CTP is entered in the same cart at the same moment.
  if results is null or jsonb_typeof(results) <> 'array' then
    raise exception 'results must be a json array' using errcode = '22023';
  end if;

  for v_res in select * from jsonb_array_elements(results) loop
    v_err := null;
    v_row := null;

    -- Echo the key back exactly as sent. Casting it out here, OUTSIDE the per-cell
    -- exception block, would let one malformed uuid abort the entire batch -- which is
    -- precisely the failure this RPC exists to prevent.
    v_key := jsonb_build_object(
      'round_id', v_res -> 'round_id', 'hole_number', v_res -> 'hole_number');
    v_round_id := null; v_hole := null;

    begin
      v_round_id  := nullif(v_res ->> 'round_id', '')::uuid;
      v_hole      := (v_res ->> 'hole_number')::int;
      v_player_id := nullif(v_res ->> 'player_id', '')::uuid;
      v_distance  := nullif(v_res ->> 'distance_feet', '')::numeric;
      v_raw       := (v_res ->> 'client_updated_at_raw')::timestamptz;
      v_client_id := (v_res ->> 'client_id')::uuid;
      v_effective := least(v_raw, pg_catalog.now() + interval '5 minutes');

      if v_round_id is null or v_hole is null or v_raw is null or v_client_id is null then
        v_err := 'missing_required_field';
      end if;

      if v_err is null then
        select r.course_id, r.status into v_course_id, v_status
          from public.rounds r where r.id = v_round_id;
        if v_course_id is null then
          v_err := 'round_not_found';
        elsif v_status = 'final' then
          v_err := 'round_final';
        elsif v_status = 'abandoned' then
          v_err := 'round_abandoned';
        end if;
      end if;

      if v_err is null then
        select h.par into v_par
          from public.holes h
         where h.course_id = v_course_id and h.hole_number = v_hole;
        if not found then
          v_err := 'hole_not_on_course';
        elsif v_par is distinct from 3 then
          v_err := 'hole_is_not_a_par_3';
        end if;
      end if;

      if v_err is null and v_player_id is not null then
        select rp.status into v_rp_status
          from public.round_players rp
         where rp.round_id = v_round_id and rp.player_id = v_player_id;
        if v_rp_status is null then
          v_err := 'no_round_player_row';
        elsif v_rp_status <> 'playing' then
          v_err := 'player_not_playing';
        end if;
      end if;

      if v_err is null and v_distance is not null and v_distance < 0 then
        v_err := 'distance_negative';
      end if;

      if v_err is null then
        insert into public.ctp_results as c (
          round_id, hole_number, player_id, distance_feet,
          client_updated_at_raw, client_updated_at_effective, client_id)
        values (
          v_round_id, v_hole, v_player_id, v_distance, v_raw, v_effective, v_client_id)
        on conflict (round_id, hole_number) do update
           set player_id                   = excluded.player_id,
               distance_feet               = excluded.distance_feet,
               client_updated_at_raw       = excluded.client_updated_at_raw,
               client_updated_at_effective = excluded.client_updated_at_effective,
               client_id                   = excluded.client_id
         where (excluded.client_updated_at_effective, excluded.client_id)
             > (c.client_updated_at_effective, c.client_id)
        returning c.* into v_row;
      end if;
    exception when others then
      v_err := 'db_error: ' || sqlstate;
    end;

    if v_err is not null then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', false, 'error', v_err, 'row', null));
    elsif v_row.id is not null then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', true, 'error', null,
                           'row', pg_catalog.to_jsonb(v_row)));
    else
      select c.* into v_row from public.ctp_results c
       where c.round_id = v_round_id and c.hole_number = v_hole;
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', false, 'error', 'stale',
                           'row', pg_catalog.to_jsonb(v_row)));
    end if;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.rpc_upsert_ctp(jsonb) from public;
grant  execute on function public.rpc_upsert_ctp(jsonb) to anon;

-- ── Reopen a finalized round ─────────────────────────────────────────────────
create or replace function public.rpc_reopen_round(session_token text, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
begin
  perform public.fn_require_session(session_token);

  select r.* into v_round from public.rounds r where r.id = p_round_id;
  if not found then
    raise exception 'round not found' using errcode = 'P0002';
  end if;
  if v_round.status <> 'final' then
    return jsonb_build_object('reopened', false, 'errors',
      jsonb_build_array('only a final round can be reopened (this one is ' || v_round.status || ')'));
  end if;

  update public.rounds r set status = 'in_progress', holes_counted = null
   where r.id = p_round_id
  returning r.* into v_round;

  -- The frozen figure belongs to a finalization that no longer stands; finalize writes a new one.
  delete from public.round_money m where m.round_id = p_round_id;

  return jsonb_build_object('reopened', true, 'errors', '[]'::jsonb,
                            'row', pg_catalog.to_jsonb(v_round));
end;
$$;

revoke execute on function public.rpc_reopen_round(text, uuid) from public;
grant  execute on function public.rpc_reopen_round(text, uuid) to anon;
