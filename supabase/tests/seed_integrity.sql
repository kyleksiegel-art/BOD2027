-- Phase 2 — pgTAP seed-integrity test.
-- Guards the seeded scorecard data against transcription error at the DB level
-- (the brief makes "strokes-received matches the printed card" a definition-of-done
-- item) and confirms the placeholder / realtime posture. Runs as the migration role
-- (superuser) — no RLS role switching here.

begin;

select plan(23);

create extension if not exists pgtap with schema extensions;

-- Course UUIDs (see 20260812100400_seed_core.sql for the scheme).
--   Red c..1, Blue c..2, Black c..3, Bone Valley c..4.

-- ── Par totals per real course ───────────────────────────────────────────────
select is((select sum(par)::int from public.holes where course_id = 'c0000000-0000-4000-8000-000000000001'), 72, 'Red par total = 72');
select is((select sum(par)::int from public.holes where course_id = 'c0000000-0000-4000-8000-000000000002'), 72, 'Blue par total = 72');
select is((select sum(par)::int from public.holes where course_id = 'c0000000-0000-4000-8000-000000000003'), 73, 'Black par total = 73');

-- ── Stroke index is a complete 1..18 permutation per real course ──────────────
select is(
  (select array_agg(stroke_index order by stroke_index) from public.holes where course_id = 'c0000000-0000-4000-8000-000000000001'),
  (select array_agg(g order by g) from generate_series(1,18) g),
  'Red stroke index is a complete 1..18 permutation');
select is(
  (select array_agg(stroke_index order by stroke_index) from public.holes where course_id = 'c0000000-0000-4000-8000-000000000002'),
  (select array_agg(g order by g) from generate_series(1,18) g),
  'Blue stroke index is a complete 1..18 permutation');
select is(
  (select array_agg(stroke_index order by stroke_index) from public.holes where course_id = 'c0000000-0000-4000-8000-000000000003'),
  (select array_agg(g order by g) from generate_series(1,18) g),
  'Black stroke index is a complete 1..18 permutation');

-- ── Black 17/18 stroke index matches the printed card (13 then 5) ─────────────
select is((select stroke_index from public.holes where course_id = 'c0000000-0000-4000-8000-000000000003' and hole_number = 17), 13, 'Black hole 17 SI = 13 (printed card)');
select is((select stroke_index from public.holes where course_id = 'c0000000-0000-4000-8000-000000000003' and hole_number = 18), 5,  'Black hole 18 SI = 5 (printed card)');

-- ── Bone Valley placeholder posture ──────────────────────────────────────────
select is((select count(*)::int from public.holes where course_id = 'c0000000-0000-4000-8000-000000000004' and par is null), 18, 'Bone Valley: all 18 hole pars null');
select is((select count(*)::int from public.holes where course_id = 'c0000000-0000-4000-8000-000000000004' and stroke_index is null), 18, 'Bone Valley: all 18 stroke indexes null');
select ok((select data_is_placeholder from public.courses where id = 'c0000000-0000-4000-8000-000000000004'), 'Bone Valley data_is_placeholder = true');
select ok((select not data_is_placeholder from public.courses where id = 'c0000000-0000-4000-8000-000000000001'), 'Red data_is_placeholder = false');

-- ── Row counts ───────────────────────────────────────────────────────────────
select is((select count(*)::int from public.courses), 4, 'four courses seeded');
select is((select count(*)::int from public.players), 4, 'four players seeded');
select is((select count(*)::int from public.rounds),  4, 'four rounds seeded');
select is((select count(*)::int from public.holes),  72, '72 holes seeded (18 x 4 courses)');

-- ── Round -> course mapping is the actual booked tee sheet ────────────────────
select is((select course_id from public.rounds where round_number = 1), 'c0000000-0000-4000-8000-000000000001'::uuid, 'R1 = Red');
select is((select course_id from public.rounds where round_number = 2), 'c0000000-0000-4000-8000-000000000003'::uuid, 'R2 = Black (swapped vs brief)');
select is((select course_id from public.rounds where round_number = 3), 'c0000000-0000-4000-8000-000000000002'::uuid, 'R3 = Blue (swapped vs brief)');
select is((select course_id from public.rounds where round_number = 4), 'c0000000-0000-4000-8000-000000000004'::uuid, 'R4 = Bone Valley');

-- ── Every base tee's hole yardages sum to its printed total ──────────────────
select is(
  (select count(*)::int from (
     select t.id
     from public.tees t
     join public.hole_yardages hy on hy.tee_id = t.id
     where t.total_yardage is not null
     group by t.id, t.total_yardage
     having sum(hy.yardage) is distinct from t.total_yardage
   ) bad),
  0,
  'every base tee hole-yardage sum equals its total_yardage');

-- ── Realtime publication + replica identity ──────────────────────────────────
select is(
  (select count(*)::int from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('scores','ctp_results','rounds','settings','players','round_players')),
  6,
  'all six intended tables are in the supabase_realtime publication');
select is(
  (select count(*)::int from pg_class
   where relnamespace = 'public'::regnamespace
     and relname in ('scores','ctp_results','rounds','settings','players','round_players')
     and relreplident = 'f'),
  6,
  'the six published tables have REPLICA IDENTITY FULL');

select * from finish();

rollback;
