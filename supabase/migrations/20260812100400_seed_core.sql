-- Phase 2 — Core seed: courses, players, rounds, settings, holes.
--
-- Idempotent: stable hard-coded UUIDs + `on conflict do nothing`. NEVER a fresh
-- gen_random_uuid() at seed time — a phone that cached a row would orphan against
-- a re-seeded DB (CLAUDE.md §Conventions).
--
-- Stable-UUID scheme:
--   courses  c0000000-0000-4000-8000-00000000000C   (C = 1 Red, 2 Blue, 3 Black, 4 Bone Valley)
--   players  d0000000-0000-4000-8000-00000000000P   (P = sort order 1..4)
--   rounds   e0000000-0000-4000-8000-00000000000R   (R = round number 1..4)
--   holes    aaaa000C-0000-4000-8000-0000000000HH   (C = course, HH = hole 01..18)
--   tees     (see 20260812100500_seed_tees.sql)
--
-- Course scorecard sources (par, stroke index, rating, slope): the resort's official
-- 2021 printed scorecards, cross-checked against BlueGolf/ProVisualizer detailed cards.
-- The same par + stroke-index numbers are transcribed in
-- src/lib/scoring/__fixtures__/streamsong.ts and verified by the Phase 3 scoring tests.
-- Per-tee rating/slope/yardage live in the tees seed. See that file's citations.

-- ─── Courses ────────────────────────────────────────────────────────────────
-- Streamsong's Red/Blue opened 2012; Black opened 2017. Bone Valley (David McLay
-- Kidd) is seeded as a PLACEHOLDER — data_is_placeholder = true — with a working
-- year_opened that is NOT yet confirmed (year_opened is NOT NULL, so a value is
-- required); the real card is entered on wifi before Sunday R4 and published via
-- rpc_validate_and_publish_course (Phase 5), which is the only thing allowed to
-- clear the placeholder flag.
insert into public.courses (id, name, architect, year_opened, description, data_is_placeholder) values
  ('c0000000-0000-4000-8000-000000000001', 'Streamsong Red',   'Coore & Crenshaw',        2012,
   'A Bill Coore & Ben Crenshaw links laid over the reclaimed phosphate-mine dunes of central Florida.', false),
  ('c0000000-0000-4000-8000-000000000002', 'Streamsong Blue',  'Tom Doak',                2012,
   'Tom Doak''s rugged dunescape routing across the same reclaimed mining terrain.', false),
  ('c0000000-0000-4000-8000-000000000003', 'Streamsong Black', 'Gil Hanse & Jim Wagner',  2017,
   'Gil Hanse and Jim Wagner''s big-scale course of vast greens and sweeping sandy waste, par 73.', false),
  ('c0000000-0000-4000-8000-000000000004', 'Bone Valley',      'David McLay Kidd',        2025,
   'A David McLay Kidd design at Streamsong. Scorecard data to be entered and validated before Round 4.', true)
on conflict (id) do nothing;

-- ─── Players ─────────────────────────────────────────────────────────────────
-- WORKING PLACEHOLDER INDEXES. The brief lists all four indexes (and each player's
-- tee) as TODO; working values are acceptable until 2027-02-01, when the final
-- indexes are entered and the four rounds are re-snapshotted (decisions.md §Index
-- locking). index_is_assigned is left false for everyone until Kyle confirms who
-- plays off an agreed (non-GHIN) index. index_updated_at is set to the seed date.
insert into public.players (id, name, title, handicap_index, index_is_assigned, index_updated_at, photo_url, sort_order) values
  ('d0000000-0000-4000-8000-000000000001', 'Jon Aronson',  null,  9.2, false, '2026-08-01T00:00:00Z', null, 1),
  ('d0000000-0000-4000-8000-000000000002', 'Kyle Siegel',  null, 12.4, false, '2026-08-01T00:00:00Z', null, 2),
  ('d0000000-0000-4000-8000-000000000003', 'Adam Hersh',   null, 14.0, false, '2026-08-01T00:00:00Z', null, 3),
  ('d0000000-0000-4000-8000-000000000004', 'Chris Denove', null, 16.8, false, '2026-08-01T00:00:00Z', null, 4)
on conflict (id) do nothing;

-- ─── Rounds ──────────────────────────────────────────────────────────────────
-- Course-per-round order and tee times are the ACTUAL booked tee sheet Kyle
-- supplied 2025-07-31 (decisions.md §Actual tee sheet). Note Fri/Sat courses are
-- swapped vs the brief: R2 = Black, R3 = Blue. Times are EST (Feb = standard time),
-- stored with an explicit -05 offset. status defaults 'upcoming'; holes_counted null.
insert into public.rounds (id, round_number, date, course_id, tee_time, status) values
  ('e0000000-0000-4000-8000-000000000001', 1, '2027-02-04', 'c0000000-0000-4000-8000-000000000001', '2027-02-04T13:10:00-05', 'upcoming'),
  ('e0000000-0000-4000-8000-000000000002', 2, '2027-02-05', 'c0000000-0000-4000-8000-000000000003', '2027-02-05T10:33:00-05', 'upcoming'),
  ('e0000000-0000-4000-8000-000000000003', 3, '2027-02-06', 'c0000000-0000-4000-8000-000000000002', '2027-02-06T10:35:00-05', 'upcoming'),
  ('e0000000-0000-4000-8000-000000000004', 4, '2027-02-07', 'c0000000-0000-4000-8000-000000000004', '2027-02-07T08:28:00-05', 'upcoming')
on conflict (id) do nothing;

-- ─── Settings (key/value) ────────────────────────────────────────────────────
-- Shapes match the pure scoring engine (src/lib/scoring): points_table -> PointsTable,
-- purse_weights -> PurseWeights. Editing points_table/allowance/handicap_cap is
-- retroactive at compute time; handicaps themselves are snapshotted per round.
-- purse_amounts is a WORKING placeholder ($100/player buy-in); real purse config
-- (mode + amounts) is TODO in the brief and set in the Phase 7 admin editor.
insert into public.settings (key, value) values
  ('points_table', '{"threeOrMoreUnder":5,"twoUnder":4,"oneUnder":3,"level":2,"oneOver":1,"twoOrMoreOver":0}'::jsonb),
  ('allowance', '1.0'::jsonb),
  ('handicap_cap', '18'::jsonb),
  ('purse_mode', '"buyin"'::jsonb),
  ('purse_weights', '{"championship":0.4,"roundWinners":0.3,"ctp":0.3}'::jsonb),
  ('purse_amounts', '{"buy_in_per_player_cents":10000,"fixed_cents":{"championship":0,"roundWinners":0,"ctp":0}}'::jsonb),
  ('ctp_carry_mode', '"carry"'::jsonb),
  ('assigned_index_footnote', '"Players without an established GHIN index play off an agreed index, marked with an asterisk."'::jsonb)
on conflict (key) do nothing;

-- ─── Holes (par + stroke index once per course) ──────────────────────────────
-- Generated from the verified scoring fixtures; see this file's header for the
-- source. Bone Valley gets 18 numbered rows with null par/stroke_index so the
-- publish-validation rule is simply "every hole non-null" (decisions.md).

-- Streamsong Red — par + stroke index per hole (par 72)
insert into public.holes (id, course_id, hole_number, par, stroke_index) values
  ('aaaa0001-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 1, 4, 4),
  ('aaaa0001-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 2, 5, 2),
  ('aaaa0001-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 3, 4, 14),
  ('aaaa0001-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 4, 4, 16),
  ('aaaa0001-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 5, 4, 6),
  ('aaaa0001-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 6, 3, 18),
  ('aaaa0001-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 7, 5, 12),
  ('aaaa0001-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001', 8, 3, 10),
  ('aaaa0001-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 9, 4, 8),
  ('aaaa0001-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000001', 10, 4, 9),
  ('aaaa0001-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001', 11, 4, 5),
  ('aaaa0001-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000001', 12, 4, 3),
  ('aaaa0001-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000001', 13, 5, 15),
  ('aaaa0001-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000001', 14, 3, 11),
  ('aaaa0001-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000001', 15, 4, 1),
  ('aaaa0001-0000-4000-8000-000000000016', 'c0000000-0000-4000-8000-000000000001', 16, 3, 7),
  ('aaaa0001-0000-4000-8000-000000000017', 'c0000000-0000-4000-8000-000000000001', 17, 4, 13),
  ('aaaa0001-0000-4000-8000-000000000018', 'c0000000-0000-4000-8000-000000000001', 18, 5, 17)
on conflict (id) do nothing;

-- Streamsong Blue — par + stroke index per hole (par 72)
insert into public.holes (id, course_id, hole_number, par, stroke_index) values
  ('aaaa0002-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 4, 14),
  ('aaaa0002-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 2, 5, 10),
  ('aaaa0002-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 3, 4, 8),
  ('aaaa0002-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002', 4, 4, 4),
  ('aaaa0002-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 5, 3, 16),
  ('aaaa0002-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002', 6, 4, 18),
  ('aaaa0002-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000002', 7, 3, 12),
  ('aaaa0002-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000002', 8, 4, 2),
  ('aaaa0002-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000002', 9, 5, 6),
  ('aaaa0002-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000002', 10, 3, 15),
  ('aaaa0002-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000002', 11, 4, 1),
  ('aaaa0002-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000002', 12, 4, 11),
  ('aaaa0002-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000002', 13, 4, 17),
  ('aaaa0002-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000002', 14, 5, 9),
  ('aaaa0002-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000002', 15, 4, 7),
  ('aaaa0002-0000-4000-8000-000000000016', 'c0000000-0000-4000-8000-000000000002', 16, 3, 13),
  ('aaaa0002-0000-4000-8000-000000000017', 'c0000000-0000-4000-8000-000000000002', 17, 5, 5),
  ('aaaa0002-0000-4000-8000-000000000018', 'c0000000-0000-4000-8000-000000000002', 18, 4, 3)
on conflict (id) do nothing;

-- Streamsong Black — par + stroke index per hole (par 73)
insert into public.holes (id, course_id, hole_number, par, stroke_index) values
  ('aaaa0003-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 1, 5, 12),
  ('aaaa0003-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', 2, 4, 16),
  ('aaaa0003-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 3, 4, 4),
  ('aaaa0003-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000003', 4, 5, 2),
  ('aaaa0003-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000003', 5, 3, 6),
  ('aaaa0003-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000003', 6, 4, 18),
  ('aaaa0003-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000003', 7, 3, 14),
  ('aaaa0003-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000003', 8, 4, 8),
  ('aaaa0003-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000003', 9, 4, 10),
  ('aaaa0003-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000003', 10, 5, 11),
  ('aaaa0003-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000003', 11, 4, 3),
  ('aaaa0003-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000003', 12, 5, 7),
  ('aaaa0003-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000003', 13, 4, 9),
  ('aaaa0003-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000003', 14, 4, 15),
  ('aaaa0003-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000003', 15, 3, 17),
  ('aaaa0003-0000-4000-8000-000000000016', 'c0000000-0000-4000-8000-000000000003', 16, 4, 1),
  ('aaaa0003-0000-4000-8000-000000000017', 'c0000000-0000-4000-8000-000000000003', 17, 3, 13),
  ('aaaa0003-0000-4000-8000-000000000018', 'c0000000-0000-4000-8000-000000000003', 18, 5, 5)
on conflict (id) do nothing;
-- ^ Black holes 17/18 stroke index = 13 and 5, hand-verified from the printed 2021
--   card (Handicap (M) row). This CORRECTS a transcription slip in the Phase 3 test
--   fixtures (src/lib/scoring/__fixtures__/streamsong.ts), which have them swapped
--   as 5/13. Flagged to Kyle for a one-line fixtures fix + Phase 3 re-verify.

-- Bone Valley — placeholder card: 18 numbered holes, par + stroke_index null
insert into public.holes (id, course_id, hole_number, par, stroke_index) values
  ('aaaa0004-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004', 1, null, null),
  ('aaaa0004-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000004', 2, null, null),
  ('aaaa0004-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004', 3, null, null),
  ('aaaa0004-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000004', 4, null, null),
  ('aaaa0004-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000004', 5, null, null),
  ('aaaa0004-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000004', 6, null, null),
  ('aaaa0004-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000004', 7, null, null),
  ('aaaa0004-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000004', 8, null, null),
  ('aaaa0004-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000004', 9, null, null),
  ('aaaa0004-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000004', 10, null, null),
  ('aaaa0004-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000004', 11, null, null),
  ('aaaa0004-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000004', 12, null, null),
  ('aaaa0004-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000004', 13, null, null),
  ('aaaa0004-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000004', 14, null, null),
  ('aaaa0004-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000004', 15, null, null),
  ('aaaa0004-0000-4000-8000-000000000016', 'c0000000-0000-4000-8000-000000000004', 16, null, null),
  ('aaaa0004-0000-4000-8000-000000000017', 'c0000000-0000-4000-8000-000000000004', 17, null, null),
  ('aaaa0004-0000-4000-8000-000000000018', 'c0000000-0000-4000-8000-000000000004', 18, null, null)
on conflict (id) do nothing;
