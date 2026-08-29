-- Phase 2 — pgTAP RLS smoke test.
-- Proves the security posture the whole app depends on:
--   1. anon can SELECT every public table (reads are public).
--   2. anon cannot INSERT / UPDATE / DELETE anywhere (all writes go through
--      SECURITY DEFINER RPCs, added in Phase 5).
--   3. anon cannot even SELECT the locked tables (sessions, pin_attempts).
-- Run with:  supabase test db
--
-- A denied write/read surfaces as SQLSTATE 42501 (insufficient_privilege) — the
-- blanket REVOKE strips anon's insert/update/delete grant, so the privilege check
-- fires before RLS or any constraint. `insert ... default values` is enough to trip
-- it (permission is checked before NOT NULL), so these tests need no valid payload.

begin;

select plan(32);

-- pgTAP lives in the extensions schema on Supabase local.
create extension if not exists pgtap with schema extensions;

-- ── 1. anon can read every public table ──────────────────────────────────────
set local role anon;

select lives_ok($$ select 1 from public.players             limit 1 $$, 'anon SELECT players');
select lives_ok($$ select 1 from public.courses             limit 1 $$, 'anon SELECT courses');
select lives_ok($$ select 1 from public.tees                limit 1 $$, 'anon SELECT tees');
select lives_ok($$ select 1 from public.holes               limit 1 $$, 'anon SELECT holes');
select lives_ok($$ select 1 from public.hole_yardages       limit 1 $$, 'anon SELECT hole_yardages');
select lives_ok($$ select 1 from public.rounds              limit 1 $$, 'anon SELECT rounds');
select lives_ok($$ select 1 from public.round_players       limit 1 $$, 'anon SELECT round_players');
select lives_ok($$ select 1 from public.scores              limit 1 $$, 'anon SELECT scores');
select lives_ok($$ select 1 from public.ctp_results         limit 1 $$, 'anon SELECT ctp_results');
select lives_ok($$ select 1 from public.round_money         limit 1 $$, 'anon SELECT round_money');
select lives_ok($$ select 1 from public.itinerary_items     limit 1 $$, 'anon SELECT itinerary_items');
select lives_ok($$ select 1 from public.lodging             limit 1 $$, 'anon SELECT lodging');
select lives_ok($$ select 1 from public.lodging_assignments limit 1 $$, 'anon SELECT lodging_assignments');
select lives_ok($$ select 1 from public.settings            limit 1 $$, 'anon SELECT settings');

-- ── 2. anon cannot write any public table ────────────────────────────────────
select throws_ok($$ insert into public.players             default values $$, '42501', null, 'anon INSERT players denied');
select throws_ok($$ insert into public.courses             default values $$, '42501', null, 'anon INSERT courses denied');
select throws_ok($$ insert into public.tees                default values $$, '42501', null, 'anon INSERT tees denied');
select throws_ok($$ insert into public.holes               default values $$, '42501', null, 'anon INSERT holes denied');
select throws_ok($$ insert into public.hole_yardages       default values $$, '42501', null, 'anon INSERT hole_yardages denied');
select throws_ok($$ insert into public.rounds              default values $$, '42501', null, 'anon INSERT rounds denied');
select throws_ok($$ insert into public.round_players       default values $$, '42501', null, 'anon INSERT round_players denied');
select throws_ok($$ insert into public.ctp_results         default values $$, '42501', null, 'anon INSERT ctp_results denied');
select throws_ok($$ insert into public.round_money         default values $$, '42501', null, 'anon INSERT round_money denied');
select throws_ok($$ insert into public.itinerary_items     default values $$, '42501', null, 'anon INSERT itinerary_items denied');
select throws_ok($$ insert into public.lodging             default values $$, '42501', null, 'anon INSERT lodging denied');
select throws_ok($$ insert into public.lodging_assignments default values $$, '42501', null, 'anon INSERT lodging_assignments denied');
select throws_ok($$ insert into public.settings            default values $$, '42501', null, 'anon INSERT settings denied');

-- scores is the hot path: prove all three verbs are denied.
select throws_ok($$ insert into public.scores default values $$,          '42501', null, 'anon INSERT scores denied');
select throws_ok($$ update public.scores set picked_up = false $$,        '42501', null, 'anon UPDATE scores denied');
select throws_ok($$ delete from public.scores $$,                         '42501', null, 'anon DELETE scores denied');

-- ── 3. anon cannot read the locked tables ────────────────────────────────────
select throws_ok($$ select 1 from public.sessions     $$, '42501', null, 'anon SELECT sessions denied');
select throws_ok($$ select 1 from public.pin_attempts $$, '42501', null, 'anon SELECT pin_attempts denied');

reset role;

select * from finish();

rollback;
