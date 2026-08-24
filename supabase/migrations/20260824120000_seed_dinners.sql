-- Phase 8 — Real dinner reservations (supplied by Kyle, 2026-08-24, from the resort's
-- confirmation email). Idempotent: stable UUIDs + on-conflict guard, so a re-run (local
-- reset or `supabase db push`) never duplicates. These are the only itinerary rows seeded;
-- everything else on the timeline is entered through the admin Itinerary editor.
--
-- All start_time values are Eastern (UTC−5 — February is EST year in, year out), matching
-- how the whole app renders times. 07:30 PM ET dinners for the group of four. Sunday Feb 7
-- has no dinner (departure day). Category 'meal'; sort_order 100 so any daytime activity
-- added later sorts ahead of the evening meal within a day.

insert into public.itinerary_items
  (id, day, sort_order, start_time, category, title, detail, location) values
  ('d1000000-0000-4000-8000-000000000001', '2027-02-04', 100,
   '2027-02-04T19:30:00-05:00', 'meal', 'Dinner at Bone Valley Tavern', 'Reservation for 4', null),
  ('d1000000-0000-4000-8000-000000000002', '2027-02-05', 100,
   '2027-02-05T19:30:00-05:00', 'meal', 'Dinner at Canyon Lake Steakhouse & Pub59', 'Reservation for 4', null),
  ('d1000000-0000-4000-8000-000000000003', '2027-02-06', 100,
   '2027-02-06T19:30:00-05:00', 'meal', 'Dinner at Canyon Lake Steakhouse & Pub59', 'Reservation for 4', null)
on conflict (id) do nothing;
