-- Phase 5A — pgTAP for the auth + write path.
-- The brief's definition of done requires that "every server-side validation rule is
-- enforced against a direct API call". These tests are that enforcement proved at the
-- SQL layer, where it actually lives; scripts/verify-write-path.sh proves the same rules
-- survive the PostgREST hop.
--
-- Score and CTP entry are OPEN (no session) as of the 2026-08-17 amendment; round_player
-- and every admin RPC still require one. Both halves are asserted below, because "which
-- writes are gated" is exactly the kind of thing that drifts silently.
-- Run with:  supabase test db

begin;

select plan(71);

create extension if not exists pgtap with schema extensions;

-- A known-good session, minted the way the Edge Function mints one (store the digest,
-- never the token). 'good-token' stands in for 256 bits of CSPRNG output.
insert into public.sessions (token_hash, expires_at)
values (public.fn_token_hash('good-token'), now() + interval '1 day');

-- An already-expired session, to prove expiry is enforced and not merely recorded.
insert into public.sessions (token_hash, expires_at)
values (public.fn_token_hash('expired-token'), now() - interval '1 second');

-- Fixtures. Round 3 (Blue) is in progress with Chris DNP; round 4 (Bone Valley) is
-- upcoming on a placeholder course.
create temporary table t_ids as
select
  (select id from public.rounds  where round_number = 3)      as r3,
  (select id from public.rounds  where round_number = 4)      as r4,
  (select id from public.players where name = 'Jon Aronson')  as jon,
  (select id from public.players where name = 'Chris Denove') as chris,
  '11111111-1111-1111-1111-111111111111'::uuid                as client_a,
  '22222222-2222-2222-2222-222222222222'::uuid                as client_b;

-- ── 1. Function hardening ────────────────────────────────────────────────────
-- Every SECURITY DEFINER function must pin search_path. This is the canonical Supabase
-- privilege-escalation footgun; a single unpinned function undoes the whole model.
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not coalesce(p.proconfig, '{}') @> array['search_path=""']),
  0,
  'every SECURITY DEFINER function in public pins search_path = ''''');

select ok(prosecdef, 'rpc_upsert_scores is SECURITY DEFINER')
  from pg_proc where proname = 'rpc_upsert_scores';
select ok(prosecdef, 'rpc_upsert_ctp is SECURITY DEFINER')
  from pg_proc where proname = 'rpc_upsert_ctp';
select ok(prosecdef, 'rpc_upsert_round_player is SECURITY DEFINER')
  from pg_proc where proname = 'rpc_upsert_round_player';

-- ── 2. Grants: who may call what ─────────────────────────────────────────────
select ok(has_function_privilege('anon', 'public.rpc_upsert_scores(jsonb)', 'execute'),
  'anon may execute rpc_upsert_scores');
select ok(has_function_privilege('anon', 'public.rpc_upsert_ctp(jsonb)', 'execute'),
  'anon may execute rpc_upsert_ctp');
select ok(has_function_privilege('anon', 'public.rpc_upsert_round_player(text, jsonb)', 'execute'),
  'anon may execute rpc_upsert_round_player');
select ok(has_function_privilege('anon', 'public.rpc_revoke_all_sessions(text)', 'execute'),
  'anon may execute rpc_revoke_all_sessions (it still demands a valid session)');

-- The one that matters most: if anon could mint a session, the PIN is decorative.
select ok(not has_function_privilege('anon', 'public.rpc_create_session(text, timestamptz)', 'execute'),
  'anon may NOT execute rpc_create_session');
select ok(not has_function_privilege('anon', 'public.rpc_pin_gate(inet)', 'execute'),
  'anon may NOT execute rpc_pin_gate');
select ok(not has_function_privilege('anon', 'public.rpc_record_pin_attempt(inet, boolean)', 'execute'),
  'anon may NOT execute rpc_record_pin_attempt');
select ok(not has_function_privilege('anon', 'public.fn_require_session(text)', 'execute'),
  'anon may NOT execute fn_require_session (no token oracle)');
select ok(has_function_privilege('service_role', 'public.rpc_create_session(text, timestamptz)', 'execute'),
  'service_role (the Edge Function) may execute rpc_create_session');

-- ── 3. Session validation ────────────────────────────────────────────────────
-- Score and CTP entry take no token at all any more.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_upsert_scores'),
  1, 'rpc_upsert_scores exists exactly once — the old session-taking overload is gone');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_upsert_scores'),
  'cells jsonb', 'rpc_upsert_scores takes no session token');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_upsert_ctp'),
  'results jsonb', 'rpc_upsert_ctp takes no session token');

-- ...but round_player and revoke-all still demand one, and enforce expiry.
select throws_ok(
  $$ select public.rpc_upsert_round_player('wrong-token', '[]'::jsonb) $$,
  '28000', null, 'round_player refuses a bogus session token');
select throws_ok(
  $$ select public.rpc_upsert_round_player('expired-token', '[]'::jsonb) $$,
  '28000', null, 'round_player refuses an EXPIRED session token');
select throws_ok(
  $$ select public.rpc_upsert_round_player(null, '[]'::jsonb) $$,
  '28000', null, 'round_player refuses a null session token');
select lives_ok(
  $$ select public.rpc_upsert_round_player('good-token', '[]'::jsonb) $$,
  'round_player accepts a valid session token');

-- Only the digest is ever stored.
select is(
  (select count(*)::int from public.sessions where token_hash = 'good-token'),
  0, 'sessions stores the hash, never the raw token');

-- Score entry is open: anon itself must be able to write one, with no token anywhere.
set local role anon;
select lives_ok(
  $$ select public.rpc_upsert_scores('[]'::jsonb) $$,
  'anon can call rpc_upsert_scores with no session at all');
select lives_ok(
  $$ select public.rpc_upsert_ctp('[]'::jsonb) $$,
  'anon can call rpc_upsert_ctp with no session at all');
select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole_number, gross_strokes,
       client_updated_at_raw, client_updated_at_effective, client_id)
     values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
             1, 4, now(), now(), '00000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'but anon still cannot touch the scores table directly — the RPC is the only door');
reset role;

-- ── 4. Score validation, rule by rule ────────────────────────────────────────
create or replace function pg_temp.score_err(payload jsonb) returns text
language sql as $$
  select public.rpc_upsert_scores(jsonb_build_array(payload)) -> 0 ->> 'error'
$$;

create or replace function pg_temp.cell(
  p_round uuid, p_player uuid, p_hole int, p_gross int, p_pu boolean,
  p_raw timestamptz, p_client uuid)
returns jsonb language sql as $$
  select jsonb_build_object(
    'round_id', p_round, 'player_id', p_player, 'hole_number', p_hole,
    'gross_strokes', p_gross, 'picked_up', p_pu,
    'client_updated_at_raw', p_raw, 'client_id', p_client)
$$;

select is(pg_temp.score_err(pg_temp.cell(r4, jon, 1, 4, false, now(), client_a)),
  'round_upcoming', 'a round with status upcoming refuses scores') from t_ids;

select is(pg_temp.score_err(pg_temp.cell(
    '00000000-0000-4000-8000-00000000dead', jon, 1, 4, false, now(), client_a)),
  'round_not_found', 'an unknown round is refused') from t_ids;

select is(pg_temp.score_err(pg_temp.cell(r3, chris, 1, 4, false, now(), client_a)),
  'player_not_playing', 'a DNP player refuses scores') from t_ids;

select is(pg_temp.score_err(pg_temp.cell(
    r3, '00000000-0000-4000-8000-00000000beef', 1, 4, false, now(), client_a)),
  'no_round_player_row', 'a player with no round_players row is refused') from t_ids;

select is(pg_temp.score_err(pg_temp.cell(r3, jon, 19, 4, false, now(), client_a)),
  'hole_not_on_course', 'a hole outside the course is refused') from t_ids;

select is(pg_temp.score_err(pg_temp.cell(r3, jon, 1, 26, false, now(), client_a)),
  'gross_strokes_out_of_range', 'gross_strokes above 25 is refused') from t_ids;

select is(pg_temp.score_err(pg_temp.cell(r3, jon, 1, 0, false, now(), client_a)),
  'gross_strokes_out_of_range', 'gross_strokes below 1 is refused') from t_ids;

select is(pg_temp.score_err(pg_temp.cell(r3, jon, 1, 4, true, now(), client_a)),
  'picked_up_requires_null_gross',
  'picked_up with a gross score is refused (they are mutually exclusive)') from t_ids;

select is(pg_temp.score_err(jsonb_build_object(
    'round_id', r3, 'player_id', jon, 'hole_number', 1, 'gross_strokes', 4,
    'picked_up', false, 'client_id', client_a)),
  'missing_required_field', 'a cell with no client timestamp is refused') from t_ids;

-- One malformed cell must not cost the scorer the rest of the batch.
select is(
  (select count(*)::int from jsonb_array_elements(
     public.rpc_upsert_scores(jsonb_build_array(
       jsonb_build_object('round_id', 'not-a-uuid', 'player_id', jon, 'hole_number', 1,
         'gross_strokes', 4, 'picked_up', false,
         'client_updated_at_raw', now(), 'client_id', client_a),
       pg_temp.cell(r3, jon, 2, 4, false, now(), client_a)))
     ) x
   where (x ->> 'applied')::boolean),
  1, 'a malformed cell fails alone; the rest of the batch still applies') from t_ids;

-- The Bone Valley hard block, proved independently of the upcoming-status check.
update public.rounds set status = 'in_progress' where round_number = 4;
insert into public.round_players (
  round_id, player_id, tee_id, index_used, allowance_used, cap_used,
  course_handicap, playing_handicap, cap_applied, strokes_received)
select r4, jon, (select id from public.tees
                  where course_id = (select course_id from public.rounds where round_number = 4)
                  limit 1),
       9.2, 1.0, 18, 9.2, 9, false, 9
from t_ids;

select is(pg_temp.score_err(pg_temp.cell(r4, jon, 1, 4, false, now(), client_a)),
  'course_data_is_placeholder',
  'a course whose card is still a placeholder refuses scores (Bone Valley hard block)')
from t_ids;

update public.rounds set status = 'upcoming' where round_number = 4;

-- ── 5. The comparator (SQL guard — site 1 of 4) ──────────────────────────────
-- Hole 18 of round 3 is unscored in the seed, so this sequence starts from nothing.
select is(
  (select public.rpc_upsert_scores(jsonb_build_array(
     pg_temp.cell(r3, jon, 18, 5, false, '2026-08-17T12:00:00Z', client_a))) -> 0 ->> 'applied'),
  'true', 'a first write to an empty cell applies') from t_ids;

select is(
  (select public.rpc_upsert_scores(jsonb_build_array(
     pg_temp.cell(r3, jon, 18, 9, false, '2026-08-17T11:00:00Z', client_a))) -> 0 ->> 'error'),
  'stale', 'an older write is rejected as stale') from t_ids;

select is((select gross_strokes from public.scores s, t_ids
            where s.round_id = r3 and s.player_id = jon and s.hole_number = 18),
  5, 'the stale write did not overwrite the winner');

select is(
  (select public.rpc_upsert_scores(jsonb_build_array(
     pg_temp.cell(r3, jon, 18, 9, false, '2026-08-17T11:00:00Z', client_a)))
     -> 0 -> 'row' ->> 'gross_strokes'),
  '5', 'a rejected write is handed the current winner row, not just a failure') from t_ids;

select is(
  (select public.rpc_upsert_scores(jsonb_build_array(
     pg_temp.cell(r3, jon, 18, 9, false, '2026-08-17T12:00:00Z', client_a))) -> 0 ->> 'error'),
  'stale', 'an identical (timestamp, client_id) tie loses — replays are idempotent')
from t_ids;

select is(
  (select public.rpc_upsert_scores(jsonb_build_array(
     pg_temp.cell(r3, jon, 18, 7, false, '2026-08-17T12:00:00Z', client_b))) -> 0 ->> 'applied'),
  'true', 'a timestamp tie is broken by client_id, higher wins') from t_ids;

select is(
  (select public.rpc_upsert_scores(jsonb_build_array(
     pg_temp.cell(r3, jon, 18, 3, false, '2026-08-17T12:00:00Z', client_a))) -> 0 ->> 'error'),
  'stale', 'a timestamp tie is broken by client_id, lower loses') from t_ids;

select is(
  (select public.rpc_upsert_scores(jsonb_build_array(
     pg_temp.cell(r3, jon, 18, 4, false, '2026-08-17T13:00:00Z', client_a))) -> 0 ->> 'applied'),
  'true', 'a newer write wins regardless of client_id') from t_ids;

-- Whole-tuple replacement: picking up must clear the gross score, not merge beside it.
select is(
  (select public.rpc_upsert_scores(jsonb_build_array(
     pg_temp.cell(r3, jon, 18, null, true, '2026-08-17T14:00:00Z', client_a)))
     -> 0 -> 'row' ->> 'gross_strokes'),
  null, 'picking up clears gross_strokes — whole-tuple replacement, no COALESCE merge')
from t_ids;

select is((select picked_up from public.scores s, t_ids
            where s.round_id = r3 and s.player_id = jon and s.hole_number = 18),
  true, 'and picked_up is now set');

-- A phone whose clock is wrong must not win every comparison for the rest of the trip.
-- Materialised into a table so the write is a separate statement from the assertions on it.
create temporary table t_skew as
select public.rpc_upsert_scores(jsonb_build_array(
         pg_temp.cell((select r3 from t_ids), (select jon from t_ids), 17, 6, false,
                      '2031-01-01T00:00:00Z', (select client_a from t_ids)))) as res;

select is((select res -> 0 ->> 'applied' from t_skew), 'true',
  'a write carrying a wildly future clock is still accepted');

select ok(
  (select client_updated_at_effective < now() + interval '6 minutes'
     from public.scores s, t_ids
    where s.round_id = r3 and s.player_id = jon and s.hole_number = 17),
  'client_updated_at_effective is clamped to now() + 5 minutes');

select ok(
  (select client_updated_at_raw > now() + interval '1 year'
     from public.scores s, t_ids
    where s.round_id = r3 and s.player_id = jon and s.hole_number = 17),
  'client_updated_at_raw keeps the value as sent, for diagnostics');

-- ── 6. CTP validation ────────────────────────────────────────────────────────
create or replace function pg_temp.ctp_err(payload jsonb) returns text
language sql as $$
  select public.rpc_upsert_ctp(jsonb_build_array(payload)) -> 0 ->> 'error'
$$;

-- Blue's par 3s are holes 5, 7, 10 and 16.
select is(pg_temp.ctp_err(jsonb_build_object(
    'round_id', r3, 'hole_number', 5, 'player_id', jon, 'distance_feet', 14.5,
    'client_updated_at_raw', now(), 'client_id', client_a)),
  null, 'a CTP on a par 3 is accepted') from t_ids;

select is(pg_temp.ctp_err(jsonb_build_object(
    'round_id', r3, 'hole_number', 1, 'player_id', jon, 'distance_feet', 14.5,
    'client_updated_at_raw', now(), 'client_id', client_a)),
  'hole_is_not_a_par_3', 'a CTP on a par 4 is refused') from t_ids;

select is(pg_temp.ctp_err(jsonb_build_object(
    'round_id', r3, 'hole_number', 5, 'player_id', chris, 'distance_feet', 14.5,
    'client_updated_at_raw', now(), 'client_id', client_a)),
  'player_not_playing', 'a DNP player cannot win a CTP') from t_ids;

select is(pg_temp.ctp_err(jsonb_build_object(
    'round_id', r3, 'hole_number', 7, 'player_id', jon, 'distance_feet', -1,
    'client_updated_at_raw', now(), 'client_id', client_a)),
  'distance_negative', 'a negative distance is refused') from t_ids;

select is(pg_temp.ctp_err(jsonb_build_object(
    'round_id', r3, 'hole_number', 7, 'distance_feet', null,
    'client_updated_at_raw', now(), 'client_id', client_a)),
  null, 'a null player_id is accepted — "no winner yet", or a carry') from t_ids;

-- Bone Valley's holes have null par, so nothing there is a par 3 yet.
select is(pg_temp.ctp_err(jsonb_build_object(
    'round_id', r4, 'hole_number', 5, 'player_id', jon, 'distance_feet', 10,
    'client_updated_at_raw', now(), 'client_id', client_a)),
  'hole_is_not_a_par_3', 'a placeholder card has no par 3s, so CTP is refused there')
from t_ids;

-- ── 7. round_players: the server owns the handicap math ──────────────────────
-- The client sends INPUTS. If the client could send outputs, two devices could disagree
-- about how many strokes a player gets and neither would be wrong.
select is(
  (select public.rpc_upsert_round_player('good-token', jsonb_build_array(
     jsonb_build_object(
       'round_id', r3, 'player_id', jon,
       'tee_id', (select rp.tee_id from public.round_players rp
                   where rp.round_id = r3 and rp.player_id = jon),
       'index_used', 12.4, 'allowance_used', 1.0, 'cap_used', 18, 'status', 'playing',
       'course_handicap', 999, 'playing_handicap', 999, 'strokes_received', 999,
       'client_updated_at_raw', now(), 'client_id', client_a)))
     -> 0 -> 'row' ->> 'strokes_received'),
  '17', 'the server recomputes strokes_received from inputs and ignores client-sent outputs')
from t_ids;

-- Blue/Green is 74.0/134 par 72: 12.4 x (134/113) = 14.70 + 2.0 = 16.70 -> 17.
-- The same worked example as handicap.test.ts, so the SQL and the TS engine agree.
select is(
  (select round(course_handicap, 2) from public.round_players rp, t_ids
    where rp.round_id = r3 and rp.player_id = jon),
  16.70, 'course_handicap matches the hand-verified Blue/Green worked example');

select is(
  (select public.rpc_upsert_round_player('good-token', jsonb_build_array(
     jsonb_build_object(
       'round_id', r3, 'player_id', jon,
       'tee_id', (select rp.tee_id from public.round_players rp
                   where rp.round_id = r3 and rp.player_id = jon),
       'index_used', 30.0, 'allowance_used', 1.0, 'cap_used', 18, 'status', 'playing',
       'client_updated_at_raw', now() + interval '1 minute', 'client_id', client_a)))
     -> 0 -> 'row' ->> 'strokes_received'),
  '18', 'the cap is applied last: an index of 30 lands on 18, never above') from t_ids;

select is(
  (select public.rpc_upsert_round_player('good-token', jsonb_build_array(
     jsonb_build_object(
       'round_id', r3, 'player_id', jon,
       'tee_id', (select id from public.tees
                   where course_id = (select course_id from public.rounds where round_number = 1)
                   limit 1),
       'index_used', 12.4, 'allowance_used', 1.0, 'cap_used', 18,
       'client_updated_at_raw', now(), 'client_id', client_a))) -> 0 ->> 'error'),
  'tee_not_on_round_course', 'a tee belonging to another course is refused') from t_ids;

-- ── 8. PIN throttling ────────────────────────────────────────────────────────
-- Layered on purpose: per-IP first, a short global brake only at a high threshold.
select is((public.rpc_pin_gate('203.0.113.5') ->> 'allowed'), 'true',
  'a clean IP is allowed through');

insert into public.pin_attempts (ip, success)
select '203.0.113.5', false from generate_series(1, 5);

select is((public.rpc_pin_gate('203.0.113.5') ->> 'allowed'), 'false',
  'five failures from one IP trips the per-IP backoff');
select is((public.rpc_pin_gate('203.0.113.5') ->> 'scope'), 'ip',
  'and the backoff is scoped to that IP');
select ok((public.rpc_pin_gate('203.0.113.5') ->> 'retry_after')::int between 1 and 300,
  'the per-IP backoff is finite — never an indefinite lockout');

-- The heart of it: one person fat-fingering the PIN must not lock out the other three.
select is((public.rpc_pin_gate('198.51.100.9') ->> 'allowed'), 'true',
  'a different device is unaffected by another IP''s failures');

-- ...and a device that already unlocked keeps working no matter what anyone types.
select is(
  (select count(*)::int from public.sessions
    where token_hash = public.fn_token_hash('good-token') and expires_at > now()),
  1, 'failed PIN attempts never invalidate an already-issued session');
select lives_ok(
  $$ select public.rpc_upsert_round_player('good-token', '[]'::jsonb) $$,
  'and that session can still write while another IP is locked out');

-- A success wipes the slate for that IP.
insert into public.pin_attempts (ip, success) values ('203.0.113.5', true);
select is((public.rpc_pin_gate('203.0.113.5') ->> 'allowed'), 'true',
  'a successful unlock clears that IP''s failure count');

-- The global brake, and its short leash.
insert into public.pin_attempts (ip, success)
select ('198.51.100.' || (i % 200))::inet, false from generate_series(1, 25) i;

select is((public.rpc_pin_gate('192.0.2.77') ->> 'scope'), 'global',
  'a high volume of failures across many IPs trips the global brake');
select ok((public.rpc_pin_gate('192.0.2.77') ->> 'retry_after')::int between 1 and 60,
  'the global brake lasts at most 60 seconds');

-- ── 9. Revoking sessions ─────────────────────────────────────────────────────
select ok(public.rpc_revoke_all_sessions('good-token') >= 1,
  'a valid session can revoke all sessions (changing the PIN must invalidate tokens)');
select throws_ok(
  $$ select public.rpc_upsert_round_player('good-token', '[]'::jsonb) $$,
  '28000', null, 'and the revoking session is itself revoked');
select throws_ok(
  $$ select public.rpc_revoke_all_sessions('wrong-token') $$,
  '28000', null, 'revoke-all itself requires a valid session');

select * from finish();

rollback;
