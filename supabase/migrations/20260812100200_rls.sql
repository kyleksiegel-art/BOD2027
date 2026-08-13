-- Phase 2 — Row Level Security
-- Reads are public (anon SELECT on public tables). No anon INSERT/UPDATE/DELETE
-- anywhere: writes go exclusively through SECURITY DEFINER RPCs (Phase 5).
-- `sessions` and `pin_attempts` are fully locked — not even SELECT for anon.
-- Canonical reference: docs/spec/schema.md §RLS.
-- `drop policy if exists` before each `create policy` keeps re-application idempotent.

-- Blanket revoke of write grants (belt-and-braces alongside RLS having no write policies).
revoke insert, update, delete on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon, authenticated;

-- Enable RLS everywhere.
alter table public.players             enable row level security;
alter table public.courses             enable row level security;
alter table public.tees                enable row level security;
alter table public.holes               enable row level security;
alter table public.hole_yardages       enable row level security;
alter table public.rounds              enable row level security;
alter table public.round_players       enable row level security;
alter table public.scores              enable row level security;
alter table public.ctp_results         enable row level security;
alter table public.round_money         enable row level security;
alter table public.itinerary_items     enable row level security;
alter table public.lodging             enable row level security;
alter table public.lodging_assignments enable row level security;
alter table public.settings            enable row level security;
alter table public.sessions            enable row level security;
alter table public.pin_attempts        enable row level security;

-- Grant the underlying SELECT privilege to anon on the public-readable tables. An
-- RLS SELECT policy does nothing without the table-level grant, and this Supabase
-- setup does not auto-grant anon on user tables (schema.md omitted this — corrected
-- here). sessions and pin_attempts are deliberately excluded and stay unreadable.
grant select on
  public.players, public.courses, public.tees, public.holes, public.hole_yardages,
  public.rounds, public.round_players, public.scores, public.ctp_results,
  public.round_money, public.itinerary_items, public.lodging,
  public.lodging_assignments, public.settings
to anon;

-- Public SELECT for anon on public tables.
drop policy if exists p_read on public.players;             create policy p_read on public.players             for select to anon using (true);
drop policy if exists p_read on public.courses;             create policy p_read on public.courses             for select to anon using (true);
drop policy if exists p_read on public.tees;                create policy p_read on public.tees                for select to anon using (true);
drop policy if exists p_read on public.holes;               create policy p_read on public.holes               for select to anon using (true);
drop policy if exists p_read on public.hole_yardages;       create policy p_read on public.hole_yardages       for select to anon using (true);
drop policy if exists p_read on public.rounds;              create policy p_read on public.rounds              for select to anon using (true);
drop policy if exists p_read on public.round_players;       create policy p_read on public.round_players       for select to anon using (true);
drop policy if exists p_read on public.scores;              create policy p_read on public.scores              for select to anon using (true);
drop policy if exists p_read on public.ctp_results;         create policy p_read on public.ctp_results         for select to anon using (true);
drop policy if exists p_read on public.round_money;         create policy p_read on public.round_money         for select to anon using (true);
drop policy if exists p_read on public.itinerary_items;     create policy p_read on public.itinerary_items     for select to anon using (true);
drop policy if exists p_read on public.lodging;             create policy p_read on public.lodging             for select to anon using (true);
drop policy if exists p_read on public.lodging_assignments; create policy p_read on public.lodging_assignments for select to anon using (true);
drop policy if exists p_read on public.settings;            create policy p_read on public.settings            for select to anon using (true);

-- Locked tables: no policies at all, and SELECT revoked so anon cannot read them.
revoke select on public.sessions, public.pin_attempts from anon, authenticated;
