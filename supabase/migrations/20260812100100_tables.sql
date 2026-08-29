-- Phase 2 — Tables
-- Canonical reference: docs/spec/schema.md §Tables. If this disagrees with the brief,
-- the brief wins. `create table if not exists` keeps re-application idempotent.

create table if not exists public.players (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  title              text null,
  handicap_index     numeric(4,1) not null,
  index_is_assigned  boolean not null default false,
  index_updated_at   timestamptz not null,
  photo_url          text null,
  sort_order         int not null
);

create table if not exists public.courses (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  architect             text not null,
  year_opened           int not null,
  description           text not null,
  data_is_placeholder   boolean not null default false
);

create table if not exists public.tees (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses on delete restrict,
  name            text not null,
  rating          numeric(4,1) null,
  slope           int null,
  par             int not null,
  total_yardage   int null,
  unique (course_id, name)
);

-- Stroke index lives once per course (holes.stroke_index), never per tee. Decided; not open.
create table if not exists public.holes (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.courses on delete restrict,
  hole_number    int not null check (hole_number between 1 and 18),
  par            int null,
  stroke_index   int null,
  unique (course_id, hole_number)
);

create table if not exists public.hole_yardages (
  hole_id   uuid not null references public.holes on delete cascade,
  tee_id    uuid not null references public.tees on delete cascade,
  yardage   int null,
  primary key (hole_id, tee_id)
);

create table if not exists public.rounds (
  id              uuid primary key default gen_random_uuid(),
  round_number    int not null unique check (round_number between 1 and 4),
  date            date not null,
  course_id       uuid not null references public.courses on delete restrict,
  tee_time        timestamptz null,
  status          public.round_status not null default 'upcoming',
  holes_counted   int null check (holes_counted between 0 and 18)
);

-- client_updated_at_* + client_id exist because day-of tee changes are the one
-- admin write carried in the offline outbox (decision (a), Phase 0). Nullable so
-- online-admin writes don't have to fill them.
create table if not exists public.round_players (
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

create table if not exists public.scores (
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

create table if not exists public.ctp_results (
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

create table if not exists public.round_money (
  round_id                    uuid primary key references public.rounds on delete cascade,
  championship_share_cents    int not null,
  round_purse_cents           int not null,
  ctp_pot_cents               int not null,
  par_3_count                 int not null,
  frozen_at                   timestamptz not null default now()
);

create table if not exists public.itinerary_items (
  id           uuid primary key default gen_random_uuid(),
  day          date not null,
  sort_order   int not null,
  start_time   timestamptz null,
  category     public.itin_category not null,
  title        text not null,
  detail       text null,
  location     text null
);

create table if not exists public.lodging (
  id             uuid primary key default gen_random_uuid(),
  property       text not null,
  check_in       date not null,
  check_out      date not null,
  confirmation   text null,
  notes          text null
);

create table if not exists public.lodging_assignments (
  id           uuid primary key default gen_random_uuid(),
  lodging_id   uuid not null references public.lodging on delete cascade,
  player_id    uuid not null references public.players on delete restrict,
  room_label   text null,
  unique (lodging_id, player_id)
);

create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);

create table if not exists public.pin_attempts (
  id             uuid primary key default gen_random_uuid(),
  ip             inet null,
  attempted_at   timestamptz not null default now(),
  success        boolean not null
);

create table if not exists public.settings (
  key          text primary key,
  value        jsonb not null,
  updated_at   timestamptz not null default now()
);
