-- Phase 2 — Enums
-- Canonical reference: docs/spec/schema.md §Enums
-- Idempotent: guarded so `supabase db reset` and re-application both succeed.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'round_status') then
    create type public.round_status as enum ('upcoming', 'in_progress', 'final', 'abandoned');
  end if;
  if not exists (select 1 from pg_type where typname = 'rp_status') then
    create type public.rp_status as enum ('playing', 'did_not_play');
  end if;
  if not exists (select 1 from pg_type where typname = 'itin_category') then
    create type public.itin_category as enum ('travel', 'golf', 'meal', 'lodging', 'other');
  end if;
end $$;
