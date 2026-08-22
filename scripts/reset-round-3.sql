-- One-off: clear Round 3 (Streamsong Blue) for a fresh live test.
-- Removes the Phase 4 fake scores, any CTP entries, the frozen money snapshot (if any),
-- and the tee/handicap snapshots — so Round 3 comes up as "No tee set" and you can choose
-- tees and enter every score by hand. Scoped hard to round 3's id; touches nothing else.
--
-- NOT a migration — do not put in supabase/migrations. Run it against the hosted DB once,
-- from the Supabase dashboard SQL editor (or psql). Re-running is harmless (idempotent).

do $$
declare r3 uuid;
begin
  select id into r3 from public.rounds where round_number = 3;
  if r3 is null then raise exception 'round 3 not found'; end if;

  delete from public.scores        where round_id = r3;
  delete from public.ctp_results   where round_id = r3;
  delete from public.round_money   where round_id = r3;
  delete from public.round_players where round_id = r3;

  -- Make sure it is open for entry (not finalized). Leaves holes_counted null = full 18.
  update public.rounds set status = 'in_progress', holes_counted = null where id = r3;

  raise notice 'Round 3 (%) cleared: scores=% ctp=% round_players=%',
    r3,
    (select count(*) from public.scores where round_id = r3),
    (select count(*) from public.ctp_results where round_id = r3),
    (select count(*) from public.round_players where round_id = r3);
end $$;
