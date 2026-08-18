-- Phase 5B — pgTAP for the admin RPCs.
--
-- The brief's definition of done requires that every server-side validation rule is
-- enforced against a direct API call. These tests are that enforcement proved at the SQL
-- layer, where it lives; scripts/verify-admin-path.sh proves the same rules survive the
-- PostgREST hop with a real token.
--
-- Two things here are load bearing and worth stating up front:
--   * EVERY admin RPC is session-gated. Score entry lost its PIN on 2026-08-17; these did
--     not. Each one is asserted individually, because "which writes are gated" is exactly
--     the kind of invariant that drifts silently.
--   * fn_allocate_even_cents / fn_allocate_proportional_cents must agree to the cent with
--     allocateEvenCents / allocateProportionalCents in src/lib/scoring/money.ts. The same
--     cases are asserted in both languages.
-- Run with:  supabase test db

begin;

select plan(106);

create extension if not exists pgtap with schema extensions;

insert into public.sessions (token_hash, expires_at)
values (public.fn_token_hash('admin-token'), now() + interval '1 day');

create temporary table t as
select
  (select id from public.courses where name = 'Streamsong Red')   as red,
  (select id from public.courses where name = 'Streamsong Black') as black,
  (select id from public.courses where data_is_placeholder)       as bone,
  (select id from public.rounds  where round_number = 1)          as r1,
  (select id from public.rounds  where round_number = 3)          as r3,
  (select id from public.rounds  where round_number = 4)          as r4,
  (select id from public.players where name = 'Jon Aronson')      as jon,
  (select id from public.players where name = 'Chris Denove')     as chris;

-- ── 1. Hardening ─────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not coalesce(p.proconfig, '{}') @> array['search_path=""']),
  0,
  'every SECURITY DEFINER function in public still pins search_path = ''''');

-- The cent-allocation helpers are internal arithmetic. They are not SECURITY DEFINER and
-- must not be reachable by anon: nothing outside a definer function should call them.
select ok(not has_function_privilege('anon', 'public.fn_allocate_even_cents(int,int)', 'execute'),
  'anon may NOT execute fn_allocate_even_cents');
select ok(not has_function_privilege('anon', 'public.fn_allocate_proportional_cents(int,numeric[])', 'execute'),
  'anon may NOT execute fn_allocate_proportional_cents');

-- ── 2. Grants ────────────────────────────────────────────────────────────────
select ok(has_function_privilege('anon', 'public.' || fn, 'execute'), 'anon may execute ' || fn)
  from unnest(array[
    'rpc_upsert_player(text,uuid,text,text,numeric,boolean,text,int)',
    'rpc_upsert_course(text,uuid,text,text,int,text)',
    'rpc_upsert_tee(text,uuid,uuid,text,numeric,int,int,int)',
    'rpc_upsert_hole(text,uuid,uuid,int,int,int)',
    'rpc_upsert_hole_yardage(text,uuid,uuid,int)',
    'rpc_validate_and_publish_course(text,uuid)',
    'rpc_upsert_round(text,uuid,int,date,uuid,timestamptz)',
    'rpc_upsert_round_player_admin(text,jsonb)',
    'rpc_resnapshot_round_handicaps(text,uuid)',
    'rpc_start_round(text,uuid)',
    'rpc_finalize_round(text,uuid,int)',
    'rpc_abandon_round(text,uuid)',
    'rpc_set_manual_override(text,uuid,uuid,int)',
    'rpc_upsert_settings(text,text,jsonb)',
    'rpc_upsert_itinerary(text,jsonb)',
    'rpc_upsert_lodging(text,uuid,text,date,date,text,text)',
    'rpc_upsert_lodging_assignment(text,uuid,uuid,uuid,text)',
    'rpc_export_all_scores(text)'
  ]) as fn;

-- ── 3. Every admin RPC is session-gated ──────────────────────────────────────
-- 28000 is what fn_require_session raises; PostgREST answers it with 403. A forged token
-- is refused before any
-- argument is even looked at, so these all pass deliberately-invalid arguments.
select throws_ok($$ select public.rpc_upsert_player('nope', null, 'X', null, 1.0, false, null, 9) $$,
  '28000', null, 'rpc_upsert_player requires a session');
select throws_ok($$ select public.rpc_upsert_course('nope', null, 'X', 'A', 2000, 'd') $$,
  '28000', null, 'rpc_upsert_course requires a session');
select throws_ok($$ select public.rpc_upsert_tee('nope', null, null, 'X', null, null, 72, null) $$,
  '28000', null, 'rpc_upsert_tee requires a session');
select throws_ok($$ select public.rpc_upsert_hole('nope', null, null, 1, 4, 1) $$,
  '28000', null, 'rpc_upsert_hole requires a session');
select throws_ok($$ select public.rpc_upsert_hole_yardage('nope', null, null, 400) $$,
  '28000', null, 'rpc_upsert_hole_yardage requires a session');
select throws_ok($$ select public.rpc_validate_and_publish_course('nope', null) $$,
  '28000', null, 'rpc_validate_and_publish_course requires a session');
select throws_ok($$ select public.rpc_upsert_round('nope', null, 1, '2027-02-04', null, null) $$,
  '28000', null, 'rpc_upsert_round requires a session');
select throws_ok($$ select public.rpc_upsert_round_player_admin('nope', '[]'::jsonb) $$,
  '28000', null, 'rpc_upsert_round_player_admin requires a session');
select throws_ok($$ select public.rpc_resnapshot_round_handicaps('nope', null) $$,
  '28000', null, 'rpc_resnapshot_round_handicaps requires a session');
select throws_ok($$ select public.rpc_start_round('nope', null) $$,
  '28000', null, 'rpc_start_round requires a session');
select throws_ok($$ select public.rpc_finalize_round('nope', null, null) $$,
  '28000', null, 'rpc_finalize_round requires a session');
select throws_ok($$ select public.rpc_abandon_round('nope', null) $$,
  '28000', null, 'rpc_abandon_round requires a session');
select throws_ok($$ select public.rpc_set_manual_override('nope', null, null, 1) $$,
  '28000', null, 'rpc_set_manual_override requires a session');
select throws_ok($$ select public.rpc_upsert_settings('nope', 'allowance', '1'::jsonb) $$,
  '28000', null, 'rpc_upsert_settings requires a session');
select throws_ok($$ select public.rpc_upsert_itinerary('nope', '[]'::jsonb) $$,
  '28000', null, 'rpc_upsert_itinerary requires a session');
select throws_ok($$ select public.rpc_upsert_lodging('nope', null, 'X', '2027-02-04', '2027-02-07', null, null) $$,
  '28000', null, 'rpc_upsert_lodging requires a session');
select throws_ok($$ select public.rpc_upsert_lodging_assignment('nope', null, null, null, null) $$,
  '28000', null, 'rpc_upsert_lodging_assignment requires a session');
select throws_ok($$ select public.rpc_export_all_scores('nope') $$,
  '28000', null, 'rpc_export_all_scores requires a session');

-- An EXPIRED session is refused too, not merely recorded as expired.
insert into public.sessions (token_hash, expires_at)
values (public.fn_token_hash('stale-token'), now() - interval '1 second');
select throws_ok($$ select public.rpc_export_all_scores('stale-token') $$,
  '28000', null, 'an expired session is refused');

-- ── 4. Cent allocation mirrors src/lib/scoring/money.ts ──────────────────────
select is(public.fn_allocate_even_cents(1000, 3), array[334,333,333],
  'allocateEvenCents sends the remainder cent to the EARLIEST part');
select is(public.fn_allocate_even_cents(1200, 4), array[300,300,300,300],
  'an even split has no remainder to place');
select is(public.fn_allocate_even_cents(100, 0), '{}'::int[],
  'no counting rounds allocates nothing rather than dividing by zero');
select is(public.fn_allocate_proportional_cents(40000, array[0.4,0.3,0.3]::numeric[]),
  array[16000,12000,12000],
  'the 40/30/30 purse split of a $400 buy-in pool');
-- The CTP rule the brief exists to protect: pots proportional to par-3 count, so every
-- par 3 on the trip is worth the same. 4/4/5/0 is Red/Blue/Black/Bone Valley as specced.
select is(public.fn_allocate_proportional_cents(12000, array[4,4,5,0]::numeric[]),
  array[3692,3692,4616,0],
  'CTP splits proportional to par-3 count and sums back to the pot exactly');
select is((select sum(x) from unnest(public.fn_allocate_proportional_cents(9999, array[1,1,1]::numeric[])) x),
  9999::bigint,
  'largest-remainder allocation always sums back to the total');
select is(public.fn_allocate_proportional_cents(100, array[0,0]::numeric[]), array[0,0],
  'zero weights allocate zero rather than dividing by zero');

-- ── 5. Players ───────────────────────────────────────────────────────────────
select lives_ok(
  $$ select public.rpc_upsert_player('admin-token', (select jon from t), 'Jon Aronson',
       'Chairman', 9.2, false, null, 1) $$,
  'a player edit that does not move the index succeeds');
select is(
  (select index_updated_at from public.players where id = (select jon from t)),
  '2026-08-01T00:00:00Z'::timestamptz,
  'editing a title does NOT bump index_updated_at (the "index as of" line must not lie)');

select lives_ok(
  $$ select public.rpc_upsert_player('admin-token', (select jon from t), 'Jon Aronson',
       'Chairman', 9.9, false, null, 1) $$,
  'changing the index succeeds');
select ok(
  (select index_updated_at from public.players where id = (select jon from t)) > now() - interval '1 minute',
  'changing the index DOES bump index_updated_at, server-side');

-- Index edits are never retroactive on their own: the round snapshot is untouched.
select is(
  (select index_used from public.round_players
    where round_id = (select r1 from t) and player_id = (select jon from t)),
  9.2::numeric,
  'and the round snapshot still holds the OLD index (edits are not retroactive)');

select throws_ok(
  $$ select public.rpc_upsert_player('admin-token', null, '  ', null, 5.0, false, null, 9) $$,
  '22023', null, 'a blank player name is refused');

-- ── 6. Courses, tees, holes ──────────────────────────────────────────────────
-- A brand-new course has no card, which is precisely what the placeholder flag describes
-- — and it means a new course can never be scored by accident.
select is(
  (public.rpc_upsert_course('admin-token', null, 'Test Links', 'Nobody', 2027, 'x')
   ->> 'data_is_placeholder'),
  'true',
  'a newly created course starts as a placeholder');

select throws_ok(
  $$ select public.rpc_upsert_tee('admin-token', null, (select red from t), 'Typo', 74.1, 1370, 72, 6500) $$,
  '22023', null, 'a slope outside 55–155 is refused (137 typed as 1370 would divide every handicap by twelve)');
select throws_ok(
  $$ select public.rpc_upsert_tee('admin-token', null, (select red from t), 'Typo', 741, 137, 72, 6500) $$,
  '22023', null, 'a course rating outside 50–90 is refused');
select throws_ok(
  $$ select public.rpc_upsert_hole('admin-token', null, (select red from t), 19, 4, 1) $$,
  '22023', null, 'a hole number above 18 is refused');
select throws_ok(
  $$ select public.rpc_upsert_hole('admin-token', null, (select red from t), 1, 4, 19) $$,
  '22023', null, 'a stroke index above 18 is refused');
select throws_ok(
  $$ select public.rpc_upsert_hole_yardage('admin-token',
       (select id from public.holes where course_id = (select red from t) and hole_number = 1),
       (select id from public.tees  where course_id = (select black from t) limit 1), 400) $$,
  '22023', null, 'a yardage joining a hole and a tee from different courses is refused');

-- ── 7. Validate and publish ──────────────────────────────────────────────────
select is(
  (public.rpc_validate_and_publish_course('admin-token', (select bone from t)) ->> 'published'),
  'false',
  'Bone Valley does not publish while its card is empty');
select ok(
  (public.rpc_validate_and_publish_course('admin-token', (select bone from t)) -> 'errors')
    @> '["18 hole(s) have no par"]'::jsonb,
  'and it says exactly what is missing');
select ok(
  (select data_is_placeholder from public.courses where id = (select bone from t)),
  'a failed validation leaves the placeholder flag alone (no partial publish)');

-- Editing a hole on a PUBLISHED card re-opens it. A published course whose par just
-- changed is no longer a validated card, and scoring must stop until it is re-validated.
select lives_ok(
  $$ select public.rpc_upsert_hole('admin-token', null, (select red from t), 6, 3, 18) $$,
  'a hole on a published card can be edited');
select ok(
  (select data_is_placeholder from public.courses where id = (select red from t)),
  'and editing it un-publishes the card until it is validated again');
select is(
  (public.rpc_validate_and_publish_course('admin-token', (select red from t)) ->> 'published'),
  'true',
  'a complete card re-publishes');

-- A duplicate stroke index allocates a stroke to the wrong hole and nothing looks odd.
update public.holes set stroke_index = 7
 where course_id = (select red from t) and hole_number = 1;
select ok(
  (public.rpc_validate_and_publish_course('admin-token', (select red from t)) -> 'errors')
    @> '["stroke indexes are not a complete 1–18 with no repeats"]'::jsonb,
  'a repeated stroke index refuses to publish even though all 18 are non-null');
update public.holes set stroke_index = 4
 where course_id = (select red from t) and hole_number = 1;

-- A null slope would silently fall back to 113 in fn_compute_handicap.
update public.tees set slope = null where course_id = (select red from t) and name = 'Green';
select ok(
  (public.rpc_validate_and_publish_course('admin-token', (select red from t)) -> 'errors')
    @> '["Green tee has no course rating or slope"]'::jsonb,
  'publishing also requires a rating and slope on every tee');
update public.tees set slope = 137 where course_id = (select red from t) and name = 'Green';

-- ── 8. round_players: the server owns the handicap math ──────────────────────
select is(
  (public.rpc_upsert_round_player_admin('admin-token', jsonb_build_array(jsonb_build_object(
     'round_id', (select r3 from t), 'player_id', (select chris from t),
     'tee_id', (select id from public.tees where course_id =
                  (select course_id from public.rounds where id = (select r3 from t)) limit 1),
     'index_used', 16.8, 'allowance_used', 1.0, 'cap_used', 18, 'status', 'playing')))
   -> 0 ->> 'applied'),
  'true',
  'an admin round_player write applies with no comparator');
select ok(
  (select strokes_received from public.round_players
    where round_id = (select r3 from t) and player_id = (select chris from t)) between 1 and 18,
  'and the server, not the client, computed strokes_received');
-- Leaving the comparator columns null would make this deliberate write lose to any older
-- cart write that happened to arrive afterwards.
select ok(
  (select client_updated_at_effective from public.round_players
    where round_id = (select r3 from t) and player_id = (select chris from t)) > now() - interval '1 minute',
  'an admin write stamps the comparator columns so a stale cart write cannot overwrite it');

select is(
  (public.rpc_upsert_round_player_admin('admin-token', jsonb_build_array(jsonb_build_object(
     'round_id', (select r3 from t), 'player_id', (select jon from t),
     'tee_id', (select id from public.tees where course_id = (select black from t) limit 1),
     'index_used', 9.2, 'allowance_used', 1.0, 'cap_used', 18)))
   -> 0 ->> 'error'),
  'tee_not_on_round_course',
  'a tee from another course is refused (it would silently mis-derive every stroke)');

-- Put Chris back to did_not_play: round 3 is the DNP fixture the finalize tests below
-- depend on, and the write above deliberately flipped him to 'playing'.
select is(
  (public.rpc_upsert_round_player_admin('admin-token', jsonb_build_array(jsonb_build_object(
     'round_id', (select r3 from t), 'player_id', (select chris from t),
     'tee_id', (select tee_id from public.round_players
                 where round_id = (select r3 from t) and player_id = (select chris from t)),
     'index_used', 16.8, 'allowance_used', 1.0, 'cap_used', 18, 'status', 'did_not_play')))
   -> 0 -> 'row' ->> 'status'),
  'did_not_play',
  'and a player can be marked did_not_play through the same call');

-- ── 9. Re-snapshotting ───────────────────────────────────────────────────────
-- The one door that makes an index edit retroactive — deliberately, for one named round.
update public.players set handicap_index = 20.0 where id = (select jon from t);
select is(
  (public.rpc_resnapshot_round_handicaps('admin-token', (select r3 from t)) ->> 'resnapshotted')::int,
  (select count(*)::int from public.round_players where round_id = (select r3 from t)),
  're-snapshotting rewrites every round_players row for the round');
select is(
  (select index_used from public.round_players
    where round_id = (select r3 from t) and player_id = (select jon from t)),
  20.0::numeric,
  'and it picks up the current index from public.players');
select is(
  (select index_used from public.round_players
    where round_id = (select r1 from t) and player_id = (select jon from t)),
  9.2::numeric,
  'while every other round keeps its own snapshot');

-- ── 10. Round lifecycle ──────────────────────────────────────────────────────
select is(
  (public.rpc_start_round('admin-token', (select r4 from t)) -> 'errors' ->> 0),
  'the course card is not published yet',
  'a round on a placeholder course cannot be started');
select is(
  (public.rpc_start_round('admin-token', (select r3 from t)) -> 'errors' ->> 0),
  'round is already in_progress',
  'a round already under way is not started twice');

update public.rounds set status = 'upcoming' where id = (select r3 from t);
select is(
  (public.rpc_start_round('admin-token', (select r3 from t)) ->> 'started'),
  'true',
  'a round with a published card and tees assigned starts');
select is(
  (select status::text from public.rounds where id = (select r3 from t)),
  'in_progress',
  'and the status moves to in_progress');

-- Finalize refuses while holes are missing, and names who is short.
select is(
  (public.rpc_finalize_round('admin-token', (select r3 from t), null) ->> 'finalized'),
  'false',
  'a round with unscored holes does not finalize');
select ok(
  (public.rpc_finalize_round('admin-token', (select r3 from t), null) -> 'errors')::text
    like '%Jon Aronson is missing%',
  'and the refusal names each player and how many holes they are short');
-- Chris is did_not_play in round 3 and is excluded from the requirement, exactly as DNP
-- players are excluded from holes-won and the shortened-round cutoff in the engine.
select ok(
  (public.rpc_finalize_round('admin-token', (select r3 from t), null) -> 'errors')::text
    not like '%Chris Denove%',
  'a DNP player is not counted as missing holes');
select is(
  (select status::text from public.rounds where id = (select r3 from t)),
  'in_progress',
  'a refused finalize leaves the round alone');

-- A shortened round names its cutoff and only those holes are required.
select is(
  (public.rpc_finalize_round('admin-token', (select r3 from t), 12) ->> 'finalized'),
  'true',
  'a shortened round finalizes on the holes it actually played');
select is(
  (select holes_counted from public.rounds where id = (select r3 from t)), 12,
  'and holes_counted records the cutoff');

-- The frozen money. $100 × 4 players = $400; 40/30/30; four counting rounds.
select is(
  (select championship_share_cents from public.round_money where round_id = (select r3 from t)),
  4000,
  'round_money freezes this round''s even share of the championship pot');
select is(
  (select round_purse_cents from public.round_money where round_id = (select r3 from t)),
  3000,
  'and its even share of the round-winner pot');
select is(
  (select par_3_count from public.round_money where round_id = (select r3 from t)),
  (select count(*)::int from public.holes h
     join public.rounds r on r.course_id = h.course_id
    where r.id = (select r3 from t) and h.par = 3),
  'and the par-3 count the CTP pot was derived from');

select throws_ok(
  $$ select public.rpc_resnapshot_round_handicaps('admin-token', (select r3 from t)) $$,
  '22023', null, 'a final round refuses to re-snapshot (its money is already frozen)');

-- Abandoning drops the round out of the money entirely, so the frozen figures go too.
select is(
  (public.rpc_abandon_round('admin-token', (select r3 from t)) ->> 'abandoned'), 'true',
  'a round can be abandoned');
select is(
  (select count(*)::int from public.round_money where round_id = (select r3 from t)), 0,
  'and its frozen money row is removed with it');
select is(
  (select count(*)::int from public.scores where round_id = (select r3 from t)) > 0, true,
  'but its scores are kept — an abandoned round still has a scorecard worth reading');
select is(
  (public.rpc_finalize_round('admin-token', (select r3 from t), null) ->> 'finalized'), 'false',
  'an abandoned round cannot be finalized');

-- ── 11. Manual override ──────────────────────────────────────────────────────
select is(
  (public.rpc_set_manual_override('admin-token', (select r1 from t), (select jon from t), 12)
   ->> 'manual_override'), '12',
  'a manual stroke override can be set');
select is(
  (public.rpc_set_manual_override('admin-token', (select r1 from t), (select jon from t), null)
   -> 'manual_override'), 'null'::jsonb,
  'and cleared, handing the computed value back');
select throws_ok(
  $$ select public.rpc_set_manual_override('admin-token', (select r1 from t), (select jon from t), 99) $$,
  '22023', null, 'an implausible override is refused');

-- ── 12. Settings ─────────────────────────────────────────────────────────────
-- Settings are read by the scoring engine at compute time and are RETROACTIVE, so a
-- malformed value silently rewrites every leaderboard on the trip.
select throws_ok(
  $$ select public.rpc_upsert_settings('admin-token', 'points_tabel', '{}'::jsonb) $$,
  '22023', null, 'an unknown settings key is refused (a typo would write a row nothing reads)');
select throws_ok(
  $$ select public.rpc_upsert_settings('admin-token', 'points_table',
       '{"threeOrMoreUnder":5,"twoUnder":4,"oneUnder":3,"level":2,"oneOver":1}'::jsonb) $$,
  '22023', null, 'a points_table missing a band is refused');
select throws_ok(
  $$ select public.rpc_upsert_settings('admin-token', 'points_table',
       '{"threeOrMoreUnder":5,"twoUnder":4,"oneUnder":3,"level":2,"oneOver":1,"twoOrMoreOver":"nil"}'::jsonb) $$,
  '22023', null, 'a non-numeric points_table band is refused');
select throws_ok(
  $$ select public.rpc_upsert_settings('admin-token', 'allowance', '1.5'::jsonb) $$,
  '22023', null, 'an allowance above 100% is refused');
select throws_ok(
  $$ select public.rpc_upsert_settings('admin-token', 'handicap_cap', '18.5'::jsonb) $$,
  '22023', null, 'a fractional handicap cap is refused');
select throws_ok(
  $$ select public.rpc_upsert_settings('admin-token', 'purse_mode', '"split"'::jsonb) $$,
  '22023', null, 'an unrecognised purse mode is refused');
select is(
  (public.rpc_upsert_settings('admin-token', 'allowance', '0.95'::jsonb) ->> 'value'), '0.95',
  'a valid allowance is stored');
select is(
  (select value from public.settings where key = 'allowance'), '0.95'::jsonb,
  'and it is what the scoring engine will read');

-- ── 13. Export ───────────────────────────────────────────────────────────────
-- Everything needed to reproduce any number the app ever showed, from one request.
select ok(
  (select public.rpc_export_all_scores('admin-token')) ?& array[
    'players','courses','tees','holes','rounds','round_players','scores',
    'ctp_results','round_money','settings','exported_at'],
  'the export carries every table needed to reproduce the trip after the fact');
select ok(
  jsonb_array_length(public.rpc_export_all_scores('admin-token') -> 'scores') > 0,
  'and it actually contains the scores');

select * from finish();

rollback;
