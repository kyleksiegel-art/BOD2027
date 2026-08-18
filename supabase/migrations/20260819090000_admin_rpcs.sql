-- Phase 5B — the admin RPCs (docs/spec/schema.md §"Admin (online-only)" + §Diagnostics).
--
-- These are the writes that are NOT in the offline outbox (CLAUDE.md §"Offline capability
-- boundary"): players, indexes, tees, scorecards, settings, rounds, purse config,
-- re-snapshotting, and round finalization. Every one of them requires a PIN session —
-- unlike score entry, which lost its PIN on 2026-08-17. The line is not "how dangerous is
-- the SQL"; it is the brief's own offline/online split. A wrong score is one cell that the
-- next scorer fixes in a tap. A wrong stroke index, allowance, or handicap snapshot
-- silently re-derives every leaderboard for the rest of the trip and looks fine.
--
-- Conventions carried from 20260818090000_auth_write_rpcs.sql:
--   * SECURITY DEFINER + `SET search_path = ''` + fully schema-qualified references.
--   * CREATE FUNCTION's implicit EXECUTE TO PUBLIC revoked, then re-granted to `anon`
--     only (the session token, not the Postgres role, is the authorization).
--   * Batch RPCs parse each entry INSIDE its own exception block, so one malformed uuid
--     costs that entry and not the batch.
--   * COALESCE / LEAST / GREATEST / EXTRACT are SQL constructs, not schema-qualifiable
--     functions — they stay bare under `SET search_path = ''`.

-- ── Cent allocation, mirrored from src/lib/scoring/money.ts ──────────────────
-- rpc_finalize_round freezes dollar figures into round_money, and Phase 7's Money page
-- derives the same figures in TypeScript at display time. If the two arithmetics disagree
-- by a cent the trip ends in an argument, so these are deliberate line-for-line mirrors of
-- allocateEvenCents() and allocateProportionalCents() — including where the remainder
-- cents land. Integer cents throughout; rounding happens only at display.

-- allocateEvenCents: extra cents to the EARLIEST parts.
create or replace function public.fn_allocate_even_cents(p_total int, p_n int)
returns int[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base int;
  v_rem  int;
  v_out  int[] := '{}';
  i      int;
begin
  if p_n is null or p_n <= 0 then return '{}'; end if;
  v_base := p_total / p_n;              -- integer division truncates toward zero;
  v_rem  := p_total - v_base * p_n;     -- purses are never negative, so that is floor().
  for i in 1..p_n loop
    v_out := v_out || (v_base + case when i <= v_rem then 1 else 0 end);
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.fn_allocate_even_cents(int, int) from public;

-- allocateProportionalCents: largest-remainder (Hamilton). Leftover cents go to the
-- largest fractional remainders, ties broken by index (earlier wins) — so the result is
-- deterministic and always sums back to p_total exactly.
create or replace function public.fn_allocate_proportional_cents(p_total int, p_weights numeric[])
returns int[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum   numeric := 0;
  v_n     int := coalesce(pg_catalog.array_length(p_weights, 1), 0);
  v_exact numeric[] := '{}';
  v_out   int[] := '{}';
  v_alloc int := 0;
  v_rem   int;
  i       int;
  r       record;
begin
  if v_n = 0 then return '{}'; end if;
  for i in 1..v_n loop v_sum := v_sum + p_weights[i]; end loop;
  if v_sum <= 0 then
    for i in 1..v_n loop v_out := v_out || 0; end loop;
    return v_out;
  end if;

  for i in 1..v_n loop
    v_exact := v_exact || (p_total * p_weights[i] / v_sum);
    v_out   := v_out || pg_catalog.floor(v_exact[i])::int;
    v_alloc := v_alloc + v_out[i];
  end loop;

  v_rem := p_total - v_alloc;
  for r in
    select g.i as idx
      from pg_catalog.generate_series(1, v_n) g(i)
     order by (v_exact[g.i] - pg_catalog.floor(v_exact[g.i])) desc, g.i asc
     limit greatest(v_rem, 0)
  loop
    v_out[r.idx] := v_out[r.idx] + 1;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.fn_allocate_proportional_cents(int, numeric[]) from public;

-- ── Players ──────────────────────────────────────────────────────────────────
-- index_updated_at is bumped server-side and ONLY when the index actually moves, so the
-- Players page's "index as of" line means what it says: editing a title or a photo must
-- not make a stale index look freshly checked.
create or replace function public.rpc_upsert_player(
  session_token text,
  p_id uuid,
  p_name text,
  p_title text,
  p_handicap_index numeric,
  p_index_is_assigned boolean,
  p_photo_url text,
  p_sort_order int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.players%rowtype;
  v_old numeric;
begin
  perform public.fn_require_session(session_token);

  if p_name is null or pg_catalog.btrim(p_name) = '' then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if p_handicap_index is null then
    raise exception 'handicap_index is required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.players
      (name, title, handicap_index, index_is_assigned, index_updated_at, photo_url, sort_order)
    values
      (p_name, p_title, p_handicap_index, coalesce(p_index_is_assigned, false),
       pg_catalog.now(), p_photo_url,
       coalesce(p_sort_order,
                (select coalesce(pg_catalog.max(p.sort_order), 0) + 1 from public.players p)))
    returning * into v_row;
  else
    select p.handicap_index into v_old from public.players p where p.id = p_id;
    if v_old is null then
      raise exception 'player not found' using errcode = 'P0002';
    end if;

    update public.players p
       set name              = p_name,
           title             = p_title,
           handicap_index    = p_handicap_index,
           index_is_assigned = coalesce(p_index_is_assigned, p.index_is_assigned),
           photo_url         = p_photo_url,
           sort_order        = coalesce(p_sort_order, p.sort_order),
           index_updated_at  = case when p_handicap_index is distinct from v_old
                                    then pg_catalog.now() else p.index_updated_at end
     where p.id = p_id
    returning * into v_row;
  end if;

  -- Changing an index does NOT retroactively change any round: handicaps are snapshotted
  -- per round in round_players, and re-snapshotting is a separate, explicit admin action
  -- (rpc_resnapshot_round_handicaps). That is the brief's rule, and it is why this
  -- function deliberately touches nothing but public.players.
  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_player(text, uuid, text, text, numeric, boolean, text, int) from public;
grant  execute on function public.rpc_upsert_player(text, uuid, text, text, numeric, boolean, text, int) to anon;

-- ── Courses ──────────────────────────────────────────────────────────────────
-- data_is_placeholder is NOT a parameter: only rpc_validate_and_publish_course may clear
-- it, and it does so only after proving the card is complete. A brand-new course is
-- created placeholder=true, because a course with no holes yet is exactly the state the
-- flag exists to describe — and that also means a new course cannot be scored by accident.
create or replace function public.rpc_upsert_course(
  session_token text,
  p_id uuid,
  p_name text,
  p_architect text,
  p_year_opened int,
  p_description text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.courses%rowtype;
begin
  perform public.fn_require_session(session_token);

  if p_name is null or pg_catalog.btrim(p_name) = '' then
    raise exception 'name is required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.courses (name, architect, year_opened, description, data_is_placeholder)
    values (p_name, coalesce(p_architect, ''), coalesce(p_year_opened, 0),
            coalesce(p_description, ''), true)
    returning * into v_row;
  else
    update public.courses c
       set name         = p_name,
           architect    = coalesce(p_architect, c.architect),
           year_opened  = coalesce(p_year_opened, c.year_opened),
           description  = coalesce(p_description, c.description)
     where c.id = p_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'course not found' using errcode = 'P0002';
    end if;
  end if;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_course(text, uuid, text, text, int, text) from public;
grant  execute on function public.rpc_upsert_course(text, uuid, text, text, int, text) to anon;

create or replace function public.rpc_upsert_tee(
  session_token text,
  p_id uuid,
  p_course_id uuid,
  p_name text,
  p_rating numeric,
  p_slope int,
  p_par int,
  p_total_yardage int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tees%rowtype;
begin
  perform public.fn_require_session(session_token);

  if p_course_id is null or not exists (select 1 from public.courses c where c.id = p_course_id) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if p_name is null or pg_catalog.btrim(p_name) = '' then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if p_par is null or p_par < 27 or p_par > 100 then
    raise exception 'par must be a plausible 18-hole par' using errcode = '22023';
  end if;
  -- Slope 55-155 is the WHS legal range. A typo here (1370 for 137) would divide every
  -- course handicap on that tee by twelve and nothing on screen would look wrong.
  if p_slope is not null and (p_slope < 55 or p_slope > 155) then
    raise exception 'slope must be between 55 and 155' using errcode = '22023';
  end if;
  if p_rating is not null and (p_rating < 50 or p_rating > 90) then
    raise exception 'course rating must be between 50 and 90' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.tees (course_id, name, rating, slope, par, total_yardage)
    values (p_course_id, p_name, p_rating, p_slope, p_par, p_total_yardage)
    on conflict (course_id, name) do update
       set rating = excluded.rating, slope = excluded.slope,
           par = excluded.par, total_yardage = excluded.total_yardage
    returning * into v_row;
  else
    update public.tees t
       set course_id = p_course_id, name = p_name, rating = p_rating,
           slope = p_slope, par = p_par, total_yardage = p_total_yardage
     where t.id = p_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'tee not found' using errcode = 'P0002';
    end if;
  end if;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_tee(text, uuid, uuid, text, numeric, int, int, int) from public;
grant  execute on function public.rpc_upsert_tee(text, uuid, uuid, text, numeric, int, int, int) to anon;

-- Keyed on (course_id, hole_number), not the surrogate id: the Bone Valley editor knows
-- "hole 7 of this course" and should not have to know a uuid to fill in its par.
create or replace function public.rpc_upsert_hole(
  session_token text,
  p_id uuid,
  p_course_id uuid,
  p_hole_number int,
  p_par int,
  p_stroke_index int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.holes%rowtype;
begin
  perform public.fn_require_session(session_token);

  if p_course_id is null or not exists (select 1 from public.courses c where c.id = p_course_id) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if p_hole_number is null or p_hole_number < 1 or p_hole_number > 18 then
    raise exception 'hole_number must be between 1 and 18' using errcode = '22023';
  end if;
  -- Nulls are allowed (that is what a placeholder card IS); nonsense is not.
  if p_par is not null and (p_par < 3 or p_par > 6) then
    raise exception 'par must be between 3 and 6' using errcode = '22023';
  end if;
  if p_stroke_index is not null and (p_stroke_index < 1 or p_stroke_index > 18) then
    raise exception 'stroke_index must be between 1 and 18' using errcode = '22023';
  end if;

  insert into public.holes as h (id, course_id, hole_number, par, stroke_index)
  values (coalesce(p_id, pg_catalog.gen_random_uuid()), p_course_id, p_hole_number,
          p_par, p_stroke_index)
  on conflict (course_id, hole_number) do update
     set par = excluded.par, stroke_index = excluded.stroke_index
  returning h.* into v_row;

  -- Editing a hole re-opens the card: a published course whose par just changed is no
  -- longer a validated card, and scoring must stop until it is re-validated. Silently
  -- leaving it published is how a mid-trip typo becomes four wrong leaderboards.
  update public.courses c set data_is_placeholder = true
   where c.id = p_course_id and not c.data_is_placeholder;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_hole(text, uuid, uuid, int, int, int) from public;
grant  execute on function public.rpc_upsert_hole(text, uuid, uuid, int, int, int) to anon;

create or replace function public.rpc_upsert_hole_yardage(
  session_token text,
  p_hole_id uuid,
  p_tee_id uuid,
  p_yardage int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.hole_yardages%rowtype;
  v_hole_crs  uuid;
  v_tee_crs   uuid;
begin
  perform public.fn_require_session(session_token);

  select h.course_id into v_hole_crs from public.holes h where h.id = p_hole_id;
  if v_hole_crs is null then
    raise exception 'hole not found' using errcode = 'P0002';
  end if;
  select t.course_id into v_tee_crs from public.tees t where t.id = p_tee_id;
  if v_tee_crs is null then
    raise exception 'tee not found' using errcode = 'P0002';
  end if;
  -- A Blue yardage on a Black hole would publish a card that validates and reads wrong.
  if v_hole_crs <> v_tee_crs then
    raise exception 'hole and tee belong to different courses' using errcode = '22023';
  end if;
  if p_yardage is not null and (p_yardage < 30 or p_yardage > 800) then
    raise exception 'yardage must be between 30 and 800' using errcode = '22023';
  end if;

  insert into public.hole_yardages as y (hole_id, tee_id, yardage)
  values (p_hole_id, p_tee_id, p_yardage)
  on conflict (hole_id, tee_id) do update set yardage = excluded.yardage
  returning y.* into v_row;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_hole_yardage(text, uuid, uuid, int) from public;
grant  execute on function public.rpc_upsert_hole_yardage(text, uuid, uuid, int) to anon;

-- ── Validate and publish a course card ───────────────────────────────────────
-- The ONLY function permitted to clear data_is_placeholder. Round 4's hard block is
-- exactly this flag, so everything that could make a card silently wrong is checked here
-- and the whole thing is one statement — no partial publish.
create or replace function public.rpc_validate_and_publish_course(
  session_token text,
  p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_errors    text[] := '{}';
  v_holes     int;
  v_missing   int;
  v_si_ok     boolean;
  v_tee       record;
begin
  perform public.fn_require_session(session_token);

  if p_course_id is null or not exists (select 1 from public.courses c where c.id = p_course_id) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;

  select pg_catalog.count(*)::int into v_holes
    from public.holes h where h.course_id = p_course_id;
  if v_holes <> 18 then
    v_errors := v_errors || ('the card has ' || v_holes || ' holes, not 18');
  end if;

  select pg_catalog.count(*)::int into v_missing
    from public.holes h where h.course_id = p_course_id and h.par is null;
  if v_missing > 0 then
    v_errors := v_errors || (v_missing || ' hole(s) have no par');
  end if;

  select pg_catalog.count(*)::int into v_missing
    from public.holes h where h.course_id = p_course_id and h.stroke_index is null;
  if v_missing > 0 then
    v_errors := v_errors || (v_missing || ' hole(s) have no stroke index');
  end if;

  -- A complete permutation of 1..18 — not merely "18 non-null values". Two holes sharing
  -- stroke index 7 allocates strokes to the wrong hole and nothing on screen looks odd.
  select pg_catalog.count(distinct h.stroke_index) = 18
     and pg_catalog.min(h.stroke_index) = 1
     and pg_catalog.max(h.stroke_index) = 18
    into v_si_ok
    from public.holes h
   where h.course_id = p_course_id and h.stroke_index is not null;
  if v_holes = 18 and not coalesce(v_si_ok, false) then
    v_errors := v_errors || 'stroke indexes are not a complete 1–18 with no repeats'::text;
  end if;

  -- Every tee needs a yardage for every hole …
  for v_tee in
    select t.id, t.name, t.rating, t.slope from public.tees t where t.course_id = p_course_id
  loop
    select pg_catalog.count(*)::int into v_missing
      from public.holes h
      left join public.hole_yardages y on y.hole_id = h.id and y.tee_id = v_tee.id
     where h.course_id = p_course_id and (y.hole_id is null or y.yardage is null);
    if v_missing > 0 then
      v_errors := v_errors || (v_tee.name || ' tee is missing ' || v_missing || ' hole yardage(s)');
    end if;

    -- … and a rating and slope. Not in the brief's four checks, but publishing is what
    -- unblocks scoring, and fn_compute_handicap falls back to slope 113 when slope is
    -- null. Publishing a card with a null slope would hand every player a quietly wrong
    -- stroke allocation. See docs/spec/decisions.md §"Publishing also requires rating and
    -- slope".
    if v_tee.rating is null or v_tee.slope is null then
      v_errors := v_errors || (v_tee.name || ' tee has no course rating or slope');
    end if;
  end loop;

  if not exists (select 1 from public.tees t where t.course_id = p_course_id) then
    v_errors := v_errors || 'the course has no tees'::text;
  end if;

  if pg_catalog.array_length(v_errors, 1) is not null then
    return jsonb_build_object('published', false, 'errors', pg_catalog.to_jsonb(v_errors));
  end if;

  update public.courses c set data_is_placeholder = false where c.id = p_course_id;
  return jsonb_build_object('published', true, 'errors', '[]'::jsonb);
end;
$$;

revoke execute on function public.rpc_validate_and_publish_course(text, uuid) from public;
grant  execute on function public.rpc_validate_and_publish_course(text, uuid) to anon;

-- ── Rounds ───────────────────────────────────────────────────────────────────
-- status and holes_counted are not parameters: they move only through the lifecycle RPCs
-- below, so "the round is final" always means finalize's preconditions were met.
create or replace function public.rpc_upsert_round(
  session_token text,
  p_id uuid,
  p_round_number int,
  p_date date,
  p_course_id uuid,
  p_tee_time timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.rounds%rowtype;
begin
  perform public.fn_require_session(session_token);

  if p_round_number is null or p_round_number < 1 or p_round_number > 4 then
    raise exception 'round_number must be between 1 and 4' using errcode = '22023';
  end if;
  if p_course_id is null or not exists (select 1 from public.courses c where c.id = p_course_id) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if p_date is null then
    raise exception 'date is required' using errcode = '22023';
  end if;

  insert into public.rounds as r (id, round_number, date, course_id, tee_time)
  values (coalesce(p_id, pg_catalog.gen_random_uuid()), p_round_number, p_date,
          p_course_id, p_tee_time)
  on conflict (round_number) do update
     set date = excluded.date, course_id = excluded.course_id, tee_time = excluded.tee_time
  returning r.* into v_row;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_round(text, uuid, int, date, uuid, timestamptz) from public;
grant  execute on function public.rpc_upsert_round(text, uuid, int, date, uuid, timestamptz) to anon;

-- Pre-trip setup and the "Set tees and confirm handicaps" pre-flight screen. Same table as
-- the outbox variant, no comparator — but it DOES stamp the comparator columns, with a
-- sentinel client_id. Leaving them null would make this deliberate admin write lose to any
-- older cart write that arrived later; stamping now() makes it beat everything already
-- recorded and lose only to a genuinely newer day-of change from a cart.
create or replace function public.rpc_upsert_round_player_admin(session_token text, entries jsonb)
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
  v_course_id uuid;
  v_tee       public.tees%rowtype;
  v_calc      record;
  v_row       public.round_players%rowtype;
  v_err       text;
  v_out       jsonb := '[]'::jsonb;
  v_key       jsonb;
  -- Stable sentinel so an admin write is identifiable in the comparator's tiebreak and in
  -- an export. Deliberately high-sorting: on an exact timestamp tie, admin wins.
  v_admin_id  constant uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
begin
  perform public.fn_require_session(session_token);

  if entries is null or jsonb_typeof(entries) <> 'array' then
    raise exception 'entries must be a json array' using errcode = '22023';
  end if;

  for v_e in select * from jsonb_array_elements(entries) loop
    v_err := null;
    v_row := null;
    v_key := jsonb_build_object('round_id', v_e -> 'round_id', 'player_id', v_e -> 'player_id');
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

      if v_round_id is null or v_player_id is null or v_tee_id is null
         or v_index is null or v_allowance is null or v_cap is null then
        v_err := 'missing_required_field';
      end if;

      if v_err is null then
        select r.course_id into v_course_id from public.rounds r where r.id = v_round_id;
        if v_course_id is null then v_err := 'round_not_found'; end if;
      end if;

      if v_err is null and not exists (select 1 from public.players p where p.id = v_player_id) then
        v_err := 'player_not_found';
      end if;

      if v_err is null then
        select t.* into v_tee from public.tees t where t.id = v_tee_id;
        if not found then
          v_err := 'tee_not_found';
        elsif v_tee.course_id <> v_course_id then
          v_err := 'tee_not_on_round_course';
        end if;
      end if;

      if v_err is null then
        -- The client sends INPUTS; the server owns the arithmetic. Same function the
        -- outbox variant uses, so the two paths can never disagree.
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
          pg_catalog.now(), pg_catalog.now(), v_admin_id)
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
        returning rp.* into v_row;
      end if;
    exception when others then
      v_err := 'db_error: ' || sqlstate;
    end;

    if v_err is not null then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', false, 'error', v_err, 'row', null));
    else
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('key', v_key, 'applied', true, 'error', null,
                           'row', pg_catalog.to_jsonb(v_row)));
    end if;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.rpc_upsert_round_player_admin(text, jsonb) from public;
grant  execute on function public.rpc_upsert_round_player_admin(text, jsonb) to anon;

-- Re-derive every round_players row for a round from the CURRENT players table and the
-- current settings. This is the explicit action the brief requires: an index edit is never
-- retroactive on its own, and this is the one door that makes it so — deliberately, for
-- one named round, after someone decided that is what they meant.
create or replace function public.rpc_resnapshot_round_handicaps(session_token text, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowance numeric;
  v_cap       int;
  v_status    public.round_status;
  v_rp        record;
  v_tee       public.tees%rowtype;
  v_calc      record;
  v_rows      jsonb := '[]'::jsonb;
  v_n         int := 0;
  v_admin_id  constant uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
begin
  perform public.fn_require_session(session_token);

  select r.status into v_status from public.rounds r where r.id = p_round_id;
  if v_status is null then
    raise exception 'round not found' using errcode = 'P0002';
  end if;
  -- A final round's money is already frozen against its handicaps. Re-deriving them after
  -- the fact would move a leaderboard that has been paid out.
  if v_status = 'final' then
    raise exception 'round is final — abandon or reopen it before re-snapshotting'
      using errcode = '22023';
  end if;

  select (s.value #>> '{}')::numeric into v_allowance from public.settings s where s.key = 'allowance';
  select (s.value #>> '{}')::int     into v_cap       from public.settings s where s.key = 'handicap_cap';
  v_allowance := coalesce(v_allowance, 1.0);
  v_cap       := coalesce(v_cap, 18);

  for v_rp in
    select rp.player_id, rp.tee_id, rp.status, rp.manual_override, p.handicap_index
      from public.round_players rp
      join public.players p on p.id = rp.player_id
     where rp.round_id = p_round_id
  loop
    select t.* into v_tee from public.tees t where t.id = v_rp.tee_id;
    select * into v_calc from public.fn_compute_handicap(
      v_rp.handicap_index, v_tee.rating, v_tee.slope, v_tee.par, v_allowance, v_cap);

    update public.round_players rp
       set index_used                  = v_rp.handicap_index,
           allowance_used              = v_allowance,
           cap_used                    = v_cap,
           course_handicap             = v_calc.course_handicap,
           playing_handicap            = v_calc.playing_handicap,
           cap_applied                 = v_calc.cap_applied,
           strokes_received            = v_calc.strokes_received,
           client_updated_at_raw       = pg_catalog.now(),
           client_updated_at_effective = pg_catalog.now(),
           client_id                   = v_admin_id
     where rp.round_id = p_round_id and rp.player_id = v_rp.player_id;

    v_n := v_n + 1;
  end loop;

  select coalesce(jsonb_agg(pg_catalog.to_jsonb(rp)), '[]'::jsonb) into v_rows
    from public.round_players rp where rp.round_id = p_round_id;

  return jsonb_build_object('resnapshotted', v_n, 'rows', v_rows);
end;
$$;

revoke execute on function public.rpc_resnapshot_round_handicaps(text, uuid) from public;
grant  execute on function public.rpc_resnapshot_round_handicaps(text, uuid) to anon;

-- ── Round lifecycle ──────────────────────────────────────────────────────────
-- Not in schema.md's original RPC list, and needed: the Enter screen refuses an `upcoming`
-- round and tells the scorer to "start it from admin", but nothing could move the status.
-- See docs/spec/decisions.md §"Starting a round".
create or replace function public.rpc_start_round(session_token text, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_ph    boolean;
  v_n     int;
begin
  perform public.fn_require_session(session_token);

  select r.* into v_round from public.rounds r where r.id = p_round_id;
  if not found then
    raise exception 'round not found' using errcode = 'P0002';
  end if;
  if v_round.status <> 'upcoming' then
    return jsonb_build_object('started', false, 'errors',
      jsonb_build_array('round is already ' || v_round.status));
  end if;

  -- The same two preconditions the Enter screen checks, enforced where they cannot be
  -- skipped: a placeholder card cannot be scored, and a player with no round_players row
  -- has no stroke allocation on any device.
  select c.data_is_placeholder into v_ph from public.courses c where c.id = v_round.course_id;
  if v_ph then
    return jsonb_build_object('started', false, 'errors',
      jsonb_build_array('the course card is not published yet'));
  end if;

  select pg_catalog.count(*)::int into v_n
    from public.round_players rp where rp.round_id = p_round_id;
  if v_n = 0 then
    return jsonb_build_object('started', false, 'errors',
      jsonb_build_array('no tees or handicaps are set for this round'));
  end if;

  update public.rounds r set status = 'in_progress' where r.id = p_round_id
  returning r.* into v_round;

  return jsonb_build_object('started', true, 'errors', '[]'::jsonb,
                            'row', pg_catalog.to_jsonb(v_round));
end;
$$;

revoke execute on function public.rpc_start_round(text, uuid) from public;
grant  execute on function public.rpc_start_round(text, uuid) to anon;

-- Finalizing freezes money. It refuses unless every playing participant has a result on
-- every counting hole — "result" meaning a gross score OR a picked-up flag, because a
-- picked-up hole is a complete answer (0 points), not a missing one.
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
  v_round       public.rounds%rowtype;
  v_upto        int;
  v_errors      text[] := '{}';
  v_gap         record;
  v_mode        text;
  v_weights     jsonb;
  v_amounts     jsonb;
  v_players     int;
  v_total       int;
  v_split       int[];
  v_ch_total    int;
  v_rw_total    int;
  v_ctp_total   int;
  v_par3        numeric[] := '{}';
  v_idx         int := 0;
  v_this        int := 0;
  v_ch_parts    int[];
  v_rw_parts    int[];
  v_ctp_parts   int[];
  v_par3_here   int;
  v_r           record;
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
  -- A line-for-line mirror of computePurse() in src/lib/scoring/money.ts, so the frozen
  -- figures and Phase 7's compute-time derivation agree to the cent.
  select (s.value #>> '{}')      into v_mode    from public.settings s where s.key = 'purse_mode';
  select s.value                 into v_weights from public.settings s where s.key = 'purse_weights';
  select s.value                 into v_amounts from public.settings s where s.key = 'purse_amounts';
  v_mode    := coalesce(v_mode, 'buyin');
  v_weights := coalesce(v_weights, '{"championship":0.4,"roundWinners":0.3,"ctp":0.3}'::jsonb);
  v_amounts := coalesce(v_amounts, '{}'::jsonb);

  select pg_catalog.count(*)::int into v_players from public.players;

  if v_mode = 'buyin' then
    v_total := coalesce((v_amounts ->> 'buy_in_per_player_cents')::int, 0) * v_players;
    v_split := public.fn_allocate_proportional_cents(v_total, array[
      coalesce((v_weights ->> 'championship')::numeric, 0),
      coalesce((v_weights ->> 'roundWinners')::numeric, 0),
      coalesce((v_weights ->> 'ctp')::numeric, 0)]);
    v_ch_total := v_split[1]; v_rw_total := v_split[2]; v_ctp_total := v_split[3];
  else
    v_ch_total  := coalesce((v_amounts #>> '{fixed_cents,championship}')::int, 0);
    v_rw_total  := coalesce((v_amounts #>> '{fixed_cents,roundWinners}')::int, 0);
    v_ctp_total := coalesce((v_amounts #>> '{fixed_cents,ctp}')::int, 0);
  end if;

  -- Counting rounds, in play order: an abandoned round's shares redistribute to the rest.
  for v_r in
    select r.id, r.course_id
      from public.rounds r
     where r.status <> 'abandoned'
     order by r.round_number
  loop
    v_idx := v_idx + 1;
    if v_r.id = p_round_id then v_this := v_idx; end if;
    select pg_catalog.count(*)::numeric into v_par3_here
      from public.holes h where h.course_id = v_r.course_id and h.par = 3;
    v_par3 := v_par3 || v_par3_here::numeric;
  end loop;

  if v_this = 0 then
    -- Unreachable via the guard above (abandoned returns early), but indexing an array
    -- with 0 yields NULL and the insert would fail with a bare not-null violation.
    raise exception 'round is not a counting round' using errcode = '22023';
  end if;

  v_ch_parts  := public.fn_allocate_even_cents(v_ch_total, v_idx);
  v_rw_parts  := public.fn_allocate_even_cents(v_rw_total, v_idx);
  v_ctp_parts := public.fn_allocate_proportional_cents(v_ctp_total, v_par3);

  select pg_catalog.count(*)::int into v_par3_here
    from public.holes h where h.course_id = v_round.course_id and h.par = 3;

  update public.rounds r
     set status = 'final', holes_counted = p_holes_counted
   where r.id = p_round_id;

  insert into public.round_money as m
    (round_id, championship_share_cents, round_purse_cents, ctp_pot_cents, par_3_count, frozen_at)
  values
    (p_round_id, v_ch_parts[v_this], v_rw_parts[v_this], v_ctp_parts[v_this],
     v_par3_here, pg_catalog.now())
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

-- Abandoning drops the round out of the money entirely, so any frozen figures go with it.
-- Scores are NOT deleted: an abandoned round still has a scorecard worth reading.
create or replace function public.rpc_abandon_round(session_token text, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.rounds%rowtype;
begin
  perform public.fn_require_session(session_token);

  update public.rounds r set status = 'abandoned', holes_counted = null
   where r.id = p_round_id
  returning r.* into v_row;
  if v_row.id is null then
    raise exception 'round not found' using errcode = 'P0002';
  end if;

  delete from public.round_money m where m.round_id = p_round_id;

  return jsonb_build_object('abandoned', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

revoke execute on function public.rpc_abandon_round(text, uuid) from public;
grant  execute on function public.rpc_abandon_round(text, uuid) to anon;

-- The escape hatch when the computed allocation is wrong on the day (a plus handicap, a
-- disputed index). null clears it and the computed value takes over again.
create or replace function public.rpc_set_manual_override(
  session_token text,
  p_round_id uuid,
  p_player_id uuid,
  p_override int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.round_players%rowtype;
begin
  perform public.fn_require_session(session_token);

  if p_override is not null and (p_override < -10 or p_override > 54) then
    raise exception 'override must be between -10 and 54' using errcode = '22023';
  end if;

  update public.round_players rp set manual_override = p_override
   where rp.round_id = p_round_id and rp.player_id = p_player_id
  returning rp.* into v_row;
  if v_row.round_id is null then
    raise exception 'round_player not found' using errcode = 'P0002';
  end if;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_set_manual_override(text, uuid, uuid, int) from public;
grant  execute on function public.rpc_set_manual_override(text, uuid, uuid, int) to anon;

-- ── Settings ─────────────────────────────────────────────────────────────────
-- A whitelist, and a shape check per key. Both matter: settings are read by the scoring
-- engine at compute time and are RETROACTIVE, so a malformed points_table silently
-- rewrites every leaderboard on the trip, and a typo'd key writes a row nothing reads.
create or replace function public.rpc_upsert_settings(session_token text, p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.settings%rowtype;
  v_n   numeric;
  k     text;
begin
  perform public.fn_require_session(session_token);

  if p_key is null or p_value is null then
    raise exception 'key and value are required' using errcode = '22023';
  end if;

  case p_key
    when 'points_table' then
      if jsonb_typeof(p_value) <> 'object' then
        raise exception 'points_table must be an object' using errcode = '22023';
      end if;
      foreach k in array array['threeOrMoreUnder','twoUnder','oneUnder','level','oneOver','twoOrMoreOver'] loop
        -- `NULL <> 'number'` is NULL, not true, so a MISSING key would sail through a
        -- plain <>. IS DISTINCT FROM is what makes absence a failure.
        if jsonb_typeof(p_value -> k) is distinct from 'number' then
          raise exception 'points_table.% must be a number', k using errcode = '22023';
        end if;
      end loop;

    when 'allowance' then
      if jsonb_typeof(p_value) <> 'number' then
        raise exception 'allowance must be a number' using errcode = '22023';
      end if;
      v_n := (p_value #>> '{}')::numeric;
      if v_n <= 0 or v_n > 1 then
        raise exception 'allowance must be greater than 0 and at most 1' using errcode = '22023';
      end if;

    when 'handicap_cap' then
      if jsonb_typeof(p_value) <> 'number' then
        raise exception 'handicap_cap must be a number' using errcode = '22023';
      end if;
      v_n := (p_value #>> '{}')::numeric;
      if v_n < 0 or v_n > 54 or v_n <> pg_catalog.trunc(v_n) then
        raise exception 'handicap_cap must be a whole number between 0 and 54' using errcode = '22023';
      end if;

    when 'purse_mode' then
      if (p_value #>> '{}') not in ('fixed', 'buyin') then
        raise exception 'purse_mode must be "fixed" or "buyin"' using errcode = '22023';
      end if;

    when 'purse_weights' then
      foreach k in array array['championship','roundWinners','ctp'] loop
        if jsonb_typeof(p_value -> k) is distinct from 'number' or (p_value ->> k)::numeric < 0 then
          raise exception 'purse_weights.% must be a non-negative number', k using errcode = '22023';
        end if;
      end loop;

    when 'purse_amounts' then
      if jsonb_typeof(p_value) <> 'object' then
        raise exception 'purse_amounts must be an object' using errcode = '22023';
      end if;

    when 'ctp_carry_mode' then
      if (p_value #>> '{}') not in ('carry', 'return') then
        raise exception 'ctp_carry_mode must be "carry" or "return"' using errcode = '22023';
      end if;

    when 'assigned_index_footnote' then
      if jsonb_typeof(p_value) <> 'string' then
        raise exception 'assigned_index_footnote must be a string' using errcode = '22023';
      end if;

    else
      raise exception 'unknown setting key: %', p_key using errcode = '22023';
  end case;

  insert into public.settings as s (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value
  returning s.* into v_row;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_settings(text, text, jsonb) from public;
grant  execute on function public.rpc_upsert_settings(text, text, jsonb) to anon;

-- ── Itinerary and lodging (editors land in Phase 8; the doors open now) ──────
create or replace function public.rpc_upsert_itinerary(session_token text, entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e   jsonb;
  v_row public.itinerary_items%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_err text;
begin
  perform public.fn_require_session(session_token);

  if entries is null or jsonb_typeof(entries) <> 'array' then
    raise exception 'entries must be a json array' using errcode = '22023';
  end if;

  for v_e in select * from jsonb_array_elements(entries) loop
    v_err := null;
    v_row := null;
    begin
      insert into public.itinerary_items as it
        (id, day, sort_order, start_time, category, title, detail, location)
      values (
        coalesce(nullif(v_e ->> 'id', '')::uuid, pg_catalog.gen_random_uuid()),
        (v_e ->> 'day')::date,
        coalesce((v_e ->> 'sort_order')::int, 0),
        nullif(v_e ->> 'start_time', '')::timestamptz,
        coalesce(nullif(v_e ->> 'category', ''), 'other')::public.itin_category,
        v_e ->> 'title',
        nullif(v_e ->> 'detail', ''),
        nullif(v_e ->> 'location', ''))
      on conflict (id) do update
         set day = excluded.day, sort_order = excluded.sort_order,
             start_time = excluded.start_time, category = excluded.category,
             title = excluded.title, detail = excluded.detail, location = excluded.location
      returning it.* into v_row;
    exception when others then
      v_err := 'db_error: ' || sqlstate;
    end;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'applied', v_err is null, 'error', v_err, 'row', pg_catalog.to_jsonb(v_row)));
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.rpc_upsert_itinerary(text, jsonb) from public;
grant  execute on function public.rpc_upsert_itinerary(text, jsonb) to anon;

create or replace function public.rpc_upsert_lodging(
  session_token text, p_id uuid, p_property text,
  p_check_in date, p_check_out date, p_confirmation text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.lodging%rowtype;
begin
  perform public.fn_require_session(session_token);

  if p_property is null or pg_catalog.btrim(p_property) = '' then
    raise exception 'property is required' using errcode = '22023';
  end if;
  if p_check_in is null or p_check_out is null or p_check_out < p_check_in then
    raise exception 'check_out must be on or after check_in' using errcode = '22023';
  end if;

  insert into public.lodging as l (id, property, check_in, check_out, confirmation, notes)
  values (coalesce(p_id, pg_catalog.gen_random_uuid()), p_property, p_check_in,
          p_check_out, p_confirmation, p_notes)
  on conflict (id) do update
     set property = excluded.property, check_in = excluded.check_in,
         check_out = excluded.check_out, confirmation = excluded.confirmation,
         notes = excluded.notes
  returning l.* into v_row;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_lodging(text, uuid, text, date, date, text, text) from public;
grant  execute on function public.rpc_upsert_lodging(text, uuid, text, date, date, text, text) to anon;

create or replace function public.rpc_upsert_lodging_assignment(
  session_token text, p_id uuid, p_lodging_id uuid, p_player_id uuid, p_room_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.lodging_assignments%rowtype;
begin
  perform public.fn_require_session(session_token);

  if not exists (select 1 from public.lodging l where l.id = p_lodging_id) then
    raise exception 'lodging not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'player not found' using errcode = 'P0002';
  end if;

  insert into public.lodging_assignments as a (id, lodging_id, player_id, room_label)
  values (coalesce(p_id, pg_catalog.gen_random_uuid()), p_lodging_id, p_player_id, p_room_label)
  on conflict (id) do update
     set lodging_id = excluded.lodging_id, player_id = excluded.player_id,
         room_label = excluded.room_label
  returning a.* into v_row;

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke execute on function public.rpc_upsert_lodging_assignment(text, uuid, uuid, uuid, text) from public;
grant  execute on function public.rpc_upsert_lodging_assignment(text, uuid, uuid, uuid, text) to anon;

-- ── Diagnostics ──────────────────────────────────────────────────────────────
-- Everything needed to reproduce any number the app ever showed, after the fact, from one
-- request: stored gross scores, the handicap snapshots they were read through, CTP, the
-- frozen money, and the settings in force. Phase 6 puts a CSV/JSON download on top of it.
create or replace function public.rpc_export_all_scores(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fn_require_session(session_token);

  return jsonb_build_object(
    'exported_at',    pg_catalog.now(),
    'players',        (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t) order by t.sort_order), '[]'::jsonb)
                         from public.players t),
    'courses',        (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t) order by t.name), '[]'::jsonb)
                         from public.courses t),
    'tees',           (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t)), '[]'::jsonb) from public.tees t),
    'holes',          (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t) order by t.course_id, t.hole_number), '[]'::jsonb)
                         from public.holes t),
    'rounds',         (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t) order by t.round_number), '[]'::jsonb)
                         from public.rounds t),
    'round_players',  (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t)), '[]'::jsonb) from public.round_players t),
    'scores',         (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t) order by t.round_id, t.player_id, t.hole_number), '[]'::jsonb)
                         from public.scores t),
    'ctp_results',    (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t)), '[]'::jsonb) from public.ctp_results t),
    'round_money',    (select coalesce(jsonb_agg(pg_catalog.to_jsonb(t)), '[]'::jsonb) from public.round_money t),
    'settings',       (select coalesce(jsonb_object_agg(t.key, t.value), '{}'::jsonb) from public.settings t));
end;
$$;

revoke execute on function public.rpc_export_all_scores(text) from public;
grant  execute on function public.rpc_export_all_scores(text) to anon;
