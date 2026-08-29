-- Phase 2 — Realtime publication
-- Only tables whose derived state must reach four phones live are published:
-- scores, ctp_results, rounds, settings, players, round_players.
-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry the full old row (the
-- comparator and the DELETE-survival path in the Realtime handler both need it).
-- Canonical reference: docs/spec/schema.md §Realtime publication.
-- Guarded add so `db reset` and re-application are both idempotent.

do $$
declare
  t text;
begin
  foreach t in array array['scores', 'ctp_results', 'rounds', 'settings', 'players', 'round_players']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.scores          replica identity full;
alter table public.ctp_results     replica identity full;
alter table public.rounds          replica identity full;
alter table public.settings        replica identity full;
alter table public.players         replica identity full;
alter table public.round_players   replica identity full;
