-- WHTBX owner portal · schema v1 (Sep 2026)
-- Run once in the Supabase SQL editor.
-- RLS is enabled with NO policies on purpose: nothing is readable with the anon key.
-- Only the service key (held in Netlify env, server side) can touch these tables.

create extension if not exists pgcrypto;

create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  phone text,
  role text not null default 'owner',        -- 'owner' | 'admin'
  sms_2fa boolean not null default false,    -- second step by text message (needs a WHTBX Twilio)
  created_at timestamptz not null default now()
);

create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists ownership (
  entity_id uuid not null references entities(id) on delete cascade,
  owner_id uuid not null references owners(id) on delete cascade,
  pct numeric not null check (pct > 0 and pct <= 100),
  primary key (entity_id, owner_id)
);

create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  address text,
  purchase_price numeric,
  purchase_date date,
  current_value numeric,
  mortgage_amount numeric,
  lender text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists leases (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  tenant text,
  start_date date not null,
  end_date date,
  base_rent numeric not null,
  escalator_pct numeric not null default 0,  -- annual escalator, applied on lease anniversaries
  actual_rent numeric,                       -- what is actually being billed today; checked against the agreement
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  entity_id uuid references entities(id) on delete cascade,
  kind text not null,                        -- Deed | Title | Mortgage | Rental Agreement | Insurance | Tax | K-1 | Other
  name text not null,
  storage_path text,                         -- private bucket path; served only via server side signed URLs
  uploaded_at timestamptz not null default now()
);

create table if not exists work_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  work_date date not null,
  vendor text,
  description text not null,
  cost numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists statements (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  period text not null,                      -- e.g. '2026 Q2' or '2026-08'
  name text not null,
  storage_path text,
  posted_at timestamptz not null default now()
);

-- auth
create table if not exists auth_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0
);

create table if not exists sessions (
  token_hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- lock everything: RLS on, no policies -> anon/authenticated see nothing.
alter table owners enable row level security;
alter table entities enable row level security;
alter table ownership enable row level security;
alter table properties enable row level security;
alter table leases enable row level security;
alter table documents enable row level security;
alter table work_log enable row level security;
alter table statements enable row level security;
alter table auth_codes enable row level security;
alter table sessions enable row level security;

-- first admin
insert into owners (email, name, role) values ('dgermann@main.inc', 'Derek Germann', 'admin')
on conflict (email) do update set role = 'admin';

-- Storage: create a PRIVATE bucket named whtbx-docs in the dashboard (no public access).
-- Files are uploaded and read only through the Netlify functions with signed URLs.
