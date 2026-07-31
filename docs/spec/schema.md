# Schema, RLS, and RPC signatures

Canonical reference. If this file disagrees with `brief.md`, the brief wins and this file is stale — fix it.

## Enums

```sql
create type round_status as enum ('upcoming', 'in_progress', 'final', 'abandoned');
create type rp_status as enum ('playing', 'did_not_play');
create type itin_category as enum ('travel', 'golf', 'meal', 'lodging', 'other');
```

## Tables

### `players`

```sql
create table public.players (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  title              text null,
  handicap_index     numeric(4,1) not null,
  index_is_assigned  boolean not null default false,
  index_updated_at   timestamptz not null,
  photo_url          text null,
  sort_order         int not null
);
```

### `courses`

```sql
create table public.courses (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  architect             text not null,
  year_opened           int not null,
  description           text not null,
  data_is_placeholder   boolean not null default false
);
```

### `tees`

```sql
create table public.tees (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses on delete restrict,
  name            text not null,
  rating          numeric(4,1) null,
  slope           int null,
  par             int not null,
  total_yardage   int null,
  unique (course_id, name)
);
```

### `holes` (stroke index once per course)

```sql
create table public.holes (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.courses on delete restrict,
  hole_number    int not null check (hole_number between 1 and 18),
  par            int null,
  stroke_index   int null,
  unique (course_id, hole_number)
);
```

### `hole_yardages`

```sql
create table public.hole_yardages (
  hole_id   uuid not null references public.holes on delete cascade,
  tee_id    uuid not null references public.tees on delete cascade,
  yardage   int null,
  primary key (hole_id, tee_id)
);
```

### `rounds`

```sql
create table public.rounds (
  id              uuid primary key default gen_random_uuid(),
  round_number    int not null unique check (round_number between 1 and 4),
  date            date not null,
  course_id       uuid not null references public.courses on delete restrict,
  tee_time        timestamptz null,
  status          public.round_status not null default 'upcoming',
  holes_counted   int null check (holes_counted between 0 and 18)
);
```

### `round_players`

Note the client-timestamp columns — they exist because day-of tee changes are the one admin write in the offline outbox (decision (a) in Phase 0).

```sql
create table public.round_players (
  round_id                     uuid not null references public.rounds on delete cascade,
  player_id                    uuid not null references public.players on delete restrict,
  tee_id                       uuid not null references public.tees on delete restrict,
  index_used                   numeric(4,1) not null,
  allowance_used               numeric(4,3) not null,
  cap_used                     int not null,
  course_handicap              numeric(6,2) not null,
  playing_handicap             int not null,
  cap_applied                  boolean not null,
  strokes_received             int not null,
  manual_override              int null,
  status                       public.rp_status not null default 'playing',
  client_updated_at_raw        timestamptz null,
  client_updated_at_effective  timestamptz null,
  client_id                    uuid null,
  primary key (round_id, player_id)
);
```

### `scores`

```sql
create table public.scores (
  id                           uuid primary key default gen_random_uuid(),
  round_id                     uuid not null references public.rounds on delete cascade,
  player_id                    uuid not null references public.players on delete restrict,
  hole_number                  int not null check (hole_number between 1 and 18),
  gross_strokes                int null check (gross_strokes between 1 and 25),
  picked_up                    boolean not null default false,
  client_updated_at_raw        timestamptz not null,
  client_updated_at_effective  timestamptz not null,
  client_id                    uuid not null,
  updated_at                   timestamptz not null default now(),
  unique (round_id, player_id, hole_number),
  check ( (picked_up = true and gross_strokes is null)
       or (picked_up = false) )
);
```

### `ctp_results`

```sql
create table public.ctp_results (
  id                           uuid primary key default gen_random_uuid(),
  round_id                     uuid not null references public.rounds on delete cascade,
  hole_number                  int not null check (hole_number between 1 and 18),
  player_id                    uuid null references public.players on delete restrict,
  distance_feet                numeric(6,1) null,
  client_updated_at_raw        timestamptz not null,
  client_updated_at_effective  timestamptz not null,
  client_id                    uuid not null,
  unique (round_id, hole_number)
);
```

### `round_money`

```sql
create table public.round_money (
  round_id                    uuid primary key references public.rounds on delete cascade,
  championship_share_cents    int not null,
  round_purse_cents           int not null,
  ctp_pot_cents               int not null,
  par_3_count                 int not null,
  frozen_at                   timestamptz not null default now()
);
```

### `itinerary_items`

```sql
create table public.itinerary_items (
  id           uuid primary key default gen_random_uuid(),
  day          date not null,
  sort_order   int not null,
  start_time   timestamptz null,
  category     public.itin_category not null,
  title        text not null,
  detail       text null,
  location     text null
);
```

### `lodging`

```sql
create table public.lodging (
  id             uuid primary key default gen_random_uuid(),
  property       text not null,
  check_in       date not null,
  check_out      date not null,
  confirmation   text null,
  notes          text null
);
```

### `lodging_assignments` (separate join table — decided in Phase 0)

```sql
create table public.lodging_assignments (
  id           uuid primary key default gen_random_uuid(),
  lodging_id   uuid not null references public.lodging on delete cascade,
  player_id    uuid not null references public.players on delete restrict,
  room_label   text null,
  unique (lodging_id, player_id)
);
```

### `sessions`

```sql
create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
```

### `pin_attempts`

```sql
create table public.pin_attempts (
  id             uuid primary key default gen_random_uuid(),
  ip             inet null,
  attempted_at   timestamptz not null default now(),
  success        boolean not null
);
```

### `settings` (key/value)

```sql
create table public.settings (
  key          text primary key,
  value        jsonb not null,
  updated_at   timestamptz not null default now()
);
```

Keys used: `points_table`, `allowance`, `handicap_cap`, `purse_mode`, `purse_weights`, `purse_amounts`, `ctp_carry_mode`, `hero_image_url`, `assigned_index_footnote`.

## RLS

```sql
-- Blanket revoke
revoke insert, update, delete on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon, authenticated;

-- Enable RLS everywhere
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

-- Public SELECT for anon on public tables
create policy p_read on public.players             for select to anon using (true);
create policy p_read on public.courses             for select to anon using (true);
create policy p_read on public.tees                for select to anon using (true);
create policy p_read on public.holes               for select to anon using (true);
create policy p_read on public.hole_yardages       for select to anon using (true);
create policy p_read on public.rounds              for select to anon using (true);
create policy p_read on public.round_players       for select to anon using (true);
create policy p_read on public.scores              for select to anon using (true);
create policy p_read on public.ctp_results         for select to anon using (true);
create policy p_read on public.round_money         for select to anon using (true);
create policy p_read on public.itinerary_items     for select to anon using (true);
create policy p_read on public.lodging             for select to anon using (true);
create policy p_read on public.lodging_assignments for select to anon using (true);
create policy p_read on public.settings            for select to anon using (true);

-- Locked tables: no policies, revoke SELECT
revoke select on public.sessions, public.pin_attempts from anon, authenticated;
```

## Realtime publication

```sql
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'scores') then
    alter publication supabase_realtime add table public.scores;
  end if;
  -- repeat for: ctp_results, rounds, settings, players, round_players
end $$;

alter table public.scores          replica identity full;
alter table public.ctp_results     replica identity full;
alter table public.rounds          replica identity full;
alter table public.settings        replica identity full;
alter table public.players         replica identity full;
alter table public.round_players   replica identity full;
```

## RPC signatures

All are `SECURITY DEFINER`, `SET search_path = ''`, fully schema-qualified, and after creation:

```sql
revoke execute on function public.<name>(...) from public;
grant  execute on function public.<name>(...) to anon;
```

### Auth (called by the Edge Function only)

```
rpc_create_session(token_hash text, expires_at timestamptz) → uuid
rpc_revoke_all_sessions(admin_token text) → int
```

### Score outbox (the hot path)

```
rpc_upsert_scores(
  session_token text,
  cells jsonb  -- [{ round_id, player_id, hole_number,
               --   gross_strokes, picked_up,
               --   client_updated_at_raw, client_id }, ...]
) → jsonb
-- Returns [{ key: {round_id, player_id, hole_number}, applied: bool, row: {...} }].
-- Server computes client_updated_at_effective = least(raw, now() + interval '5 min').
-- Guard: ((incoming_effective, incoming_client_id) > (existing_effective, existing_client_id)).
-- Ties broken by client_id lexicographic. Ties on both = incoming loses (idempotency).
-- Whole-tuple replacement: overwrites gross_strokes AND picked_up together. No COALESCE.
-- If guard fails, returns applied=false with the current winner row.
```

### CTP outbox

```
rpc_upsert_ctp(
  session_token text,
  results jsonb  -- [{ round_id, hole_number, player_id, distance_feet,
                 --   client_updated_at_raw, client_id }, ...]
) → jsonb
-- Same comparator + return shape as rpc_upsert_scores.
```

### Round-player outbox (offline admin carve-out — decision (a))

```
rpc_upsert_round_player(
  session_token text,
  entries jsonb  -- [{ round_id, player_id, tee_id,
                 --   index_used, allowance_used, cap_used, status,
                 --   manual_override,
                 --   client_updated_at_raw, client_id }, ...]
) → jsonb
-- Server recomputes course_handicap, playing_handicap, cap_applied, strokes_received
-- from (index_used, allowance_used, cap_used, tee_id + course rating/slope/par).
-- The client sends INPUTS, not outputs. Server owns the math.
-- Same comparator + return shape as scoring RPCs.
```

### Admin (online-only)

```
rpc_upsert_player(session_token, id?, name, title, handicap_index, index_is_assigned, photo_url, sort_order) → jsonb
  -- Bumps index_updated_at server-side when handicap_index changes.

rpc_upsert_course(session_token, id?, name, architect, year_opened, description) → jsonb
  -- Cannot set data_is_placeholder directly.

rpc_upsert_tee(session_token, id?, course_id, name, rating, slope, par, total_yardage) → jsonb
rpc_upsert_hole(session_token, id?, course_id, hole_number, par, stroke_index) → jsonb
rpc_upsert_hole_yardage(session_token, hole_id, tee_id, yardage) → jsonb

rpc_validate_and_publish_course(session_token, course_id uuid) → jsonb
  -- Checks:
  --   * every hole has non-null par
  --   * every hole has non-null stroke_index
  --   * stroke indexes form a complete permutation of 1..18
  --   * every tee for the course has yardages for every hole
  -- If all pass: atomically sets data_is_placeholder = false and returns {published: true}.
  -- Otherwise returns {published: false, errors: [...]}.

rpc_upsert_round(session_token, id?, round_number, date, course_id, tee_time) → jsonb
  -- Cannot mutate status or holes_counted directly.

rpc_upsert_round_player_admin(session_token, entries jsonb) → jsonb
  -- Same table as the outbox variant, but online-only and without the comparator.
  -- Used for pre-trip setup and the "Set tees and confirm handicaps" pre-flight screen.

rpc_resnapshot_round_handicaps(session_token, round_id uuid) → jsonb
  -- Re-derives every round_players row for the round from current players + tees + settings.

rpc_finalize_round(session_token, round_id uuid, holes_counted int null) → jsonb
  -- Requires: every hole either scored or picked_up for every playing participant.
  -- On success: sets status='final', writes a round_money row with frozen figures
  -- derived from current settings + par-3 count.

rpc_abandon_round(session_token, round_id uuid) → jsonb
  -- Status transitions to 'abandoned'. No round_money row.

rpc_set_manual_override(session_token, round_id uuid, player_id uuid, override int null) → jsonb
rpc_upsert_itinerary(session_token, entries jsonb) → jsonb
rpc_upsert_lodging(session_token, id?, property, check_in, check_out, confirmation, notes) → jsonb
rpc_upsert_lodging_assignment(session_token, id?, lodging_id, player_id, room_label) → jsonb
rpc_upsert_settings(session_token, key text, value jsonb) → jsonb
```

### Diagnostics

```
rpc_export_all_scores(session_token) → jsonb
  -- Full trip: every score row, every round_players row (with computed derivations),
  -- every ctp_result, every round_money, every settings key.
  -- Reproducible after the fact.
```

## Server-side validation (enforced in `rpc_upsert_scores`)

- The `session_token` hashes to an unexpired row in `sessions`. Reject otherwise.
- For each cell:
  - The round exists and its status is not `upcoming`.
  - The round's course has `data_is_placeholder = false`. (Belt-and-braces for the R4 Bone Valley hard block.)
  - The player has a `round_players` row for that round with `status = 'playing'`.
  - The hole exists for that round's course.
  - `gross_strokes` between 1 and 25 when non-null.
  - `(picked_up = true and gross_strokes is null)` or `(picked_up = false)`.
- Any failing cell is reported specifically enough for Diagnostics; other cells in the batch continue.

## Server-side validation (enforced in `rpc_upsert_ctp`)

- Session valid.
- The hole exists for that round's course and its par = 3.
- If `player_id` is non-null: the player has `round_players.status = 'playing'` for that round.
- `distance_feet` >= 0 when non-null.

## Storage

Bucket `player-photos`, public-read, no anon write policy. Uploads via `POST /upload-photo` Edge Function, service-role key. Max 2 MB, `image/*`.
