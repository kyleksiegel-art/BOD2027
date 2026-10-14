-- Bone Valley — align with the official card on streamsong.com (Kyle, 2026-10-14).
--
-- The 2026-09-09 seed came from a printed card photographed in the cart. The website's
-- card agrees on every par, stroke index, base-tee yardage and the four base tees'
-- rating/slope, but differs in two places:
--   Black/Silver   70.6 / 125  →  70.8 / 126   (rating/slope feed the handicap calc)
--   Established    2026        →  2027
--
-- The website also lists Black/Silver at 6360 yds, but its own inside-card ▲/▼ row sums
-- to 6320 (3250 / 3070), and it gives no other routing. The per-hole yardages and the
-- 6320 total are left as they are — display only, they don't touch scoring.
-- Green/Black and Silver/Gold are not on the website card; left in place (no delete path,
-- and a round_players row may reference them).
--
-- Idempotent: plain updates by stable UUID.

update public.tees
   set rating = 70.8, slope = 126
 where id = 'bbbb0004-0000-4000-8000-000000000006';

update public.courses
   set year_opened = 2027,
       description = 'David McLay Kidd''s 2027 course, the resort''s fourth: par 72 across the old Bone Valley phosphate ground, all sandy soil played as waste area.'
 where id = 'c0000000-0000-4000-8000-000000000004';
