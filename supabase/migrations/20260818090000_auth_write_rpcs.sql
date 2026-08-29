-- Phase 5A — Auth + the write path (scores, CTP, round_players).
-- Canonical reference: docs/spec/schema.md §"RPC signatures" and §"Server-side validation".
--
-- WHO NEEDS A SESSION (amended 2026-08-17 — see docs/spec/decisions.md §"PIN removed from
-- score entry", which supersedes the brief):
--   rpc_upsert_scores, rpc_upsert_ctp  -- NO session. Open to anon. These are the writes
--       that happen in a cart, and Kyle chose an explicit Save button over a lock.
--   rpc_upsert_round_player            -- session required: it rewrites handicaps.
--   every admin RPC (Phase 5B)         -- session required.
-- The RPC is still the only door in either case: anon has no direct INSERT/UPDATE/DELETE
-- on any table, so removing the check unlocks that door rather than removing it.
--
-- Every function here is SECURITY DEFINER with `SET search_path = ''` and fully
-- schema-qualified references (the canonical Supabase privilege-escalation footgun --
-- the DB linter flags anything else). CREATE FUNCTION implicitly grants EXECUTE TO
-- PUBLIC, so each one is revoked and then re-granted only to the role that should
-- call it: `anon` for the client-callable RPCs, `service_role` for the ones only the
-- pin-verify Edge Function may call.
--
-- The comparator (row-level last-write-wins on the tuple
-- (client_updated_at_effective, client_id)) appears here as SQL guard #1 of the four
-- sites listed in CLAUDE.md. Sites 2-4 are client-side and arrive in Phase 6.

-- ── Token hashing ────────────────────────────────────────────────────────────
-- Session tokens are 128 bits of CSPRNG output minted in the Edge Function, so a plain
-- SHA-256 is the right hash here: there is no low-entropy secret to brute-force, and the
-- table stores only the digest. (The PIN itself is argon2id, in the Edge Function.)
create or replace function public.fn_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
$$;

revoke execute on function public.fn_token_hash(text) from public;

-- Raises 28000 unless the token hashes to an unexpired session row. PostgREST answers
-- that with 403 (measured; see the Phase 5A acceptance checklist). Never grantable: SECURITY DEFINER callers run as the owner
-- and can reach it regardless, and exposing it to anon would make it a token oracle.
create or replace function public.fn_require_session(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_token is null or p_token = '' then
    raise exception 'invalid or expired session' using errcode = '28000';
  end if;

  select s.id into v_id
    from public.sessions s
   where s.token_hash = public.fn_token_hash(p_token)
     and s.expires_at > pg_catalog.now();

  if v_id is null then
    raise exception 'invalid or expired session' using errcode = '28000';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.fn_require_session(text) from public;

-- ── Session lifecycle ────────────────────────────────────────────────────────
-- Called ONLY by the pin-verify Edge Function (service-role key). Granting this to anon
-- would let anybody mint themselves a session, which is the whole ballgame.
create or replace function public.rpc_create_session(token_hash text, expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  delete from public.sessions s where s.expires_at <= pg_catalog.now();

  insert into public.sessions (token_hash, expires_at)
  values (token_hash, expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.rpc_create_session(text, timestamptz) from public;
grant  execute on function public.rpc_create_session(text, timestamptz) to service_role;

-- Changing the PIN does nothing to tokens already issued, so admin needs this.
-- Callable by any holder of a valid session -- including the caller's own, which is
-- revoked too (deliberate: "revoke all" means all).
create or replace function public.rpc_revoke_all_sessions(admin_token text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform public.fn_require_session(admin_token);
  delete from public.sessions;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.rpc_revoke_all_sessions(text) from public;
grant  execute on function public.rpc_revoke_all_sessions(text) to anon;

-- ── PIN throttling ───────────────────────────────────────────────────────────
-- Layered on purpose (brief §Auth): a naive global lockout is a denial-of-service
-- against our own foursome -- one person fat-fingering the PIN must not lock the other
-- three out mid-round. So: per-IP is the primary control, a SHORT global backoff only
-- kicks in at a high threshold, and neither is ever an indefinite lockout.
--
-- Neither function touches public.sessions. That is the mechanism behind
-- "failed attempts never invalidate an already-issued valid session".
create or replace function public.rpc_pin_gate(p_ip inet)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since       timestamptz;
  v_ip_fails    int;
  v_ip_last     timestamptz;
  v_backoff     int;
  v_global      int;
  v_global_last timestamptz;
begin
  -- Failures only count since this IP's most recent success: unlocking successfully
  -- wipes the slate, so yesterday's typos don't stack onto today's.
  select pg_catalog.max(a.attempted_at) into v_since
    from public.pin_attempts a
   where a.ip is not distinct from p_ip and a.success;

  v_since := greatest(
    coalesce(v_since, '-infinity'::timestamptz),
    pg_catalog.now() - interval '15 minutes'
  );

  select pg_catalog.count(*), pg_catalog.max(a.attempted_at)
    into v_ip_fails, v_ip_last
    from public.pin_attempts a
   where a.ip is not distinct from p_ip
     and not a.success
     and a.attempted_at > v_since;

  -- 5 free tries, then an exponential per-IP backoff capped at 5 minutes.
  if v_ip_fails >= 5 then
    v_backoff := least(300, 30 * (2 ^ (v_ip_fails - 5))::int);
    if pg_catalog.now() - v_ip_last < pg_catalog.make_interval(secs => v_backoff) then
      return jsonb_build_object(
        'allowed', false,
        'scope', 'ip',
        'retry_after',
          pg_catalog.ceil(
            extract(
              epoch from (v_ip_last + pg_catalog.make_interval(secs => v_backoff)) - pg_catalog.now()
            )
          )::int
      );
    end if;
  end if;

  -- Global brake: only above a high threshold, and only for 60 seconds at a time.
  select pg_catalog.count(*), pg_catalog.max(a.attempted_at)
    into v_global, v_global_last
    from public.pin_attempts a
   where not a.success
     and a.attempted_at > pg_catalog.now() - interval '10 minutes';

  if v_global >= 25 and pg_catalog.now() - v_global_last < interval '60 seconds' then
    return jsonb_build_object(
      'allowed', false,
      'scope', 'global',
      'retry_after',
        pg_catalog.ceil(
          extract(epoch from (v_global_last + interval '60 seconds') - pg_catalog.now())
        )::int
    );
  end if;

  return jsonb_build_object('allowed', true, 'scope', null, 'retry_after', 0);
end;
$$;

revoke execute on function public.rpc_pin_gate(inet) from public;
grant  execute on function public.rpc_pin_gate(inet) to service_role;

create or replace function public.rpc_record_pin_attempt(p_ip inet, p_success boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pin_attempts (ip, success) values (p_ip, p_success);
  -- Keep the table from growing without bound over six months of use.
  delete from public.pin_attempts a where a.attempted_at < pg_catalog.now() - interval '30 days';
end;
$$;

revoke execute on function public.rpc_record_pin_attempt(inet, boolean) from public;
grant  execute on function public.rpc_record_pin_attempt(inet, boolean) to service_role;

-- ── Scores (the hot path) ────────────────────────────────────────────────────
-- Whole-tuple replacement: gross_strokes AND picked_up are overwritten together or
-- neither is. COALESCE-style partial merges are explicitly forbidden -- with one
-- timestamp per row a partial merge lets a stale write's non-null column survive beside
-- a newer one and the two devices never converge.
--
-- A failing cell is reported specifically and the rest of the batch continues, so one
-- bad cell can never cost a scorer the other 71.
drop function if exists public.rpc_upsert_scores(text, jsonb);
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

-- ── Closest to pin ───────────────────────────────────────────────────────────
-- player_id is nullable: no winner yet, or a carry. The par-3 check also happens to be
-- the Bone Valley block for CTP -- a placeholder card has null pars, so nothing matches.
drop function if exists public.rpc_upsert_ctp(text, jsonb);
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
        select r.course_id into v_course_id from public.rounds r where r.id = v_round_id;
        if v_course_id is null then v_err := 'round_not_found'; end if;
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

-- ── Handicap math, server side ───────────────────────────────────────────────
-- A mirror of src/lib/scoring/handicap.ts computeHandicap(). The client sends INPUTS
-- (index, allowance, cap, tee); the server owns the arithmetic so a day-of tee change
-- can never produce two devices with different stroke allocations.
--
-- numeric round() in Postgres is already half-away-from-zero, which is exactly what
-- src/lib/scoring/rounding.ts implements (and what JS Math.round is not).
create or replace function public.fn_compute_handicap(
  p_index numeric, p_rating numeric, p_slope int, p_par int,
  p_allowance numeric, p_cap int)
returns table (course_handicap numeric, playing_handicap int, cap_applied boolean, strokes_received int)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_slope int;
  v_ch    numeric;
  v_ph    int;
  v_cap   boolean;
begin
  if p_rating is null and p_slope is null then
    -- Bone Valley, nothing published: Course Handicap = Index, full stop.
    v_ch := p_index;
  else
    v_slope := coalesce(p_slope, 113);  -- rating known, slope not yet published
    v_ch := p_index * (v_slope::numeric / 113) + (coalesce(p_rating, p_par::numeric) - p_par);
  end if;

  v_ph  := pg_catalog.round(v_ch * p_allowance)::int;
  -- Cap bites only on a strict exceed, and is applied LAST -- after the allowance and
  -- after rounding (never 24 -> 18 -> 17).
  v_cap := v_ph > p_cap;

  return query select v_ch, v_ph, v_cap, case when v_cap then p_cap else v_ph end;
end;
$$;

revoke execute on function public.fn_compute_handicap(numeric, numeric, int, int, numeric, int) from public;

-- ── round_players (the offline admin carve-out) ──────────────────────────────
-- Decision (a): a day-of tee or handicap change must work from a cart with no signal,
-- so it rides the same comparator as scores rather than the online-only admin path.
--
-- This one KEEPS the session check even though score entry lost it. Changing a tee or an
-- index silently re-derives every stroke allocation and therefore every leaderboard, and
-- a wrong one is invisible until someone recomputes by hand. It is not a score; it is the
-- rules the scores are read through.
create or replace function public.rpc_upsert_round_player(session_token text, entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e         jsonb;
  v_round_id  uuid;
  v_player_id uuid;
  v_tee_id    uuid;
  v_index     numeric;
  v_allowance numeric;
  v_cap       int;
  v_status    public.rp_status;
  v_override  int;
  v_raw       timestamptz;
  v_effective timestamptz;
  v_client_id uuid;
  v_course_id uuid;
  v_tee       public.tees%rowtype;
  v_calc      record;
  v_row       public.round_players%rowtype;
  v_err       text;
  v_out       jsonb := '[]'::jsonb;
  v_key       jsonb;
begin
  perform public.fn_require_session(session_token);

  if entries is null or jsonb_typeof(entries) <> 'array' then
    raise exception 'entries must be a json array' using errcode = '22023';
  end if;

  for v_e in select * from jsonb_array_elements(entries) loop
    v_err := null;
    v_row := null;

    -- Echo the key back exactly as sent. Casting it out here, OUTSIDE the per-cell
    -- exception block, would let one malformed uuid abort the entire batch -- which is
    -- precisely the failure this RPC exists to prevent.
    v_key := jsonb_build_object(
      'round_id', v_e -> 'round_id', 'player_id', v_e -> 'player_id');
    v_round_id := null; v_player_id := null;

    begin
      v_round_id  := nullif(v_e ->> 'round_id', '')::uuid;
      v_player_id := nullif(v_e ->> 'player_id', '')::uuid;
      v_tee_id    := nullif(v_e ->> 'tee_id', '')::uuid;
      v_index     := (v_e ->> 'index_used')::numeric;
      v_allowance := (v_e ->> 'allowance_used')::numeric;
      v_cap       := (v_e ->> 'cap_used')::int;
      v_status    := coalesce(nullif(v_e ->> 'status', ''), 'playing')::public.rp_status;
      v_override  := nullif(v_e ->> 'manual_override', '')::int;
      v_raw       := (v_e ->> 'client_updated_at_raw')::timestamptz;
      v_client_id := (v_e ->> 'client_id')::uuid;
      v_effective := least(v_raw, pg_catalog.now() + interval '5 minutes');

      if v_round_id is null or v_player_id is null or v_tee_id is null or v_index is null
         or v_allowance is null or v_cap is null or v_raw is null or v_client_id is null then
        v_err := 'missing_required_field';
      end if;

      if v_err is null then
        select r.course_id into v_course_id from public.rounds r where r.id = v_round_id;
        if v_course_id is null then v_err := 'round_not_found'; end if;
      end if;

      if v_err is null and not exists (
        select 1 from public.players p where p.id = v_player_id
      ) then
        v_err := 'player_not_found';
      end if;

      if v_err is null then
        select t.* into v_tee from public.tees t where t.id = v_tee_id;
        if not found then
          v_err := 'tee_not_found';
        elsif v_tee.course_id <> v_course_id then
          -- Assigning a Blue tee to a Black round would silently mis-derive every stroke.
          v_err := 'tee_not_on_round_course';
        end if;
      end if;

      if v_err is null then
        select * into v_calc from public.fn_compute_handicap(
          v_index, v_tee.rating, v_tee.slope, v_tee.par, v_allowance, v_cap);

        insert into public.round_players as rp (
          round_id, player_id, tee_id, index_used, allowance_used, cap_used,
          course_handicap, playing_handicap, cap_applied, strokes_received,
          manual_override, status,
          client_updated_at_raw, client_updated_at_effective, client_id)
        values (
          v_round_id, v_player_id, v_tee_id, v_index, v_allowance, v_cap,
          v_calc.course_handicap, v_calc.playing_handicap, v_calc.cap_applied,
          v_calc.strokes_received, v_override, v_status,
          v_raw, v_effective, v_client_id)
        on conflict (round_id, player_id) do update
           set tee_id                      = excluded.tee_id,
               index_used                  = excluded.index_used,
               allowance_used              = excluded.allowance_used,
               cap_used                    = excluded.cap_used,
               course_handicap             = excluded.course_handicap,
               playing_handicap            = excluded.playing_handicap,
               cap_applied                 = excluded.cap_applied,
               strokes_received            = excluded.strokes_received,
               manual_override             = excluded.manual_override,
               status                      = excluded.status,
               client_updated_at_raw       = excluded.client_updated_at_raw,
               client_updated_at_effective = excluded.client_updated_at_effective,
               client_id                   = excluded.client_id
         -- Phase 2/4 seeded these rows with null client timestamps; coalesce so a first
         -- real write always beats the seed instead of comparing against null and losing.
         where (excluded.client_updated_at_effective, excluded.client_id)
             > (coalesce(rp.client_updated_at_effective, '-infinity'::timestamptz),
                coalesce(rp.client_id, '00000000-0000-0000-0000-000000000000'::uuid))
        returning rp.* into v_row;
      end if;
    exception when others then
      v_err := 'db_error: ' || sqlstate;
    end;

    if v_err is not null then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', false, 'error', v_err, 'row', null));
    elsif v_row.round_id is not null then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', true, 'error', null,
                           'row', pg_catalog.to_jsonb(v_row)));
    else
      select rp.* into v_row from public.round_players rp
       where rp.round_id = v_round_id and rp.player_id = v_player_id;
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', false, 'error', 'stale',
                           'row', pg_catalog.to_jsonb(v_row)));
    end if;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.rpc_upsert_round_player(text, jsonb) from public;
grant  execute on function public.rpc_upsert_round_player(text, jsonb) to anon;
