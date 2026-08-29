-- One-off: prep the HOSTED DB for a live "start Round 1" test.
--
-- Round 1 (Streamsong Red): cleared and reset to UPCOMING so the full start flow can be
--   tested from scratch — pick tees, Start round, enter every score by hand.
-- Rounds 2 & 3 (Black, Blue): emptied and reset to UPCOMING (scores/CTP/money/tees removed).
-- Round 4 (Bone Valley) and everything else: untouched.
--
-- The round ROWS are kept (never deleted) — stable UUIDs back cached data on phones and the
-- standings columns; we only clear their child data and reset status. Re-running is harmless.
--
-- NOT a migration — do not put in supabase/migrations. Run it ONCE against the hosted DB from
-- the Supabase dashboard SQL editor (Project → SQL Editor → paste → Run).

do $$
declare
  r record;
begin
  for r in
    select id, round_number
    from public.rounds
    where round_number in (1, 2, 3)
  loop
    delete from public.scores        where round_id = r.id;
    delete from public.ctp_results   where round_id = r.id;
    delete from public.round_money   where round_id = r.id;
    delete from public.round_players where round_id = r.id;

    update public.rounds
      set status = 'upcoming', holes_counted = null
      where id = r.id;

    raise notice 'Round % cleared and set upcoming', r.round_number;
  end loop;
end $$;

-- Verify: all three should read 'upcoming' with 0 scores and 0 tee assignments.
select
  rd.round_number,
  rd.status,
  rd.holes_counted,
  (select count(*) from public.scores        s  where s.round_id  = rd.id) as scores,
  (select count(*) from public.round_players rp where rp.round_id = rd.id) as tees,
  (select count(*) from public.ctp_results   c  where c.round_id  = rd.id) as ctp
from public.rounds rd
order by rd.round_number;
