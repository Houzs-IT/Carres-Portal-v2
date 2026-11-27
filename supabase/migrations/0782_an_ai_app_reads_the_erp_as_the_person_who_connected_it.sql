-- =============================================================================
-- 0782 · An AI app reads the ERP as the person who connected it
--
-- Owner: 25 Nov 2026 — every company system gets the same AI Connector that
-- Hookka ERP and Houzs ERP have. Staff connect Claude or ChatGPT to the ERP
-- with THEIR OWN login. It is READ-ONLY and sees only what that person's own
-- login sees. The principal approves each person, sees every lookup, and can
-- disconnect anyone (apps/api/src/routes/mcp.ts, routes/mcp-admin.ts).
--
-- WHAT THIS ADDS (seven tables, no data, no change to any existing object)
--   mcp_access           who may connect (approved by the principal).
--   mcp_access_requests  "Request access" from the AI Connector page.
--   mcp_oauth_clients    OAuth dynamic client registration (one row per AI app).
--   mcp_auth_requests    a pending "Allow?" screen, 10 minutes, between the AI
--                        app's authorize redirect and the person's click.
--   mcp_oauth_codes      one-time authorization codes (PKCE S256), 10 minutes.
--   mcp_tokens           connector access + refresh tokens: SHA-256 HASHES ONLY.
--   mcp_calls            one row per AI lookup: who, which app, what, result.
--
-- WHO READS THEM: only the Carres API, with the service key. Row-level security
-- is ON with NO policy, and the two public roles hold no privilege, so a direct
-- data-API read by any signed-in account finds nothing (ENGINEERING §3: "a
-- signed-in account is not yet a Carres account"). No function, no view.
--
-- READ-ONLY BY CONSTRUCTION is not in this file. It is in the API: a tool call
-- re-enters the API as a GET with a Supabase session minted for that person,
-- so every route's own role guard and every table's RLS decide what comes back
-- (routes/mcp.ts header comment). A connector token is never accepted by the
-- API's auth middleware.
--
-- Additive and idempotent. RE-CHECK THE NUMBER AT MERGE (red line 7).
--
-- REVERSAL (owner confirmation required, red line 1):
--   drop table if exists public.mcp_calls, public.mcp_tokens, public.mcp_oauth_codes,
--     public.mcp_auth_requests, public.mcp_oauth_clients, public.mcp_access_requests,
--     public.mcp_access;
--   Revert the API first (routes/mcp.ts reads every table).
-- =============================================================================

create table if not exists public.mcp_access (
  user_id     uuid        primary key references public.app_users(id) on delete cascade,
  approved_by uuid        references public.app_users(id) on delete set null,
  approved_at timestamptz not null default now()
);

create table if not exists public.mcp_access_requests (
  id         text        primary key,
  user_id    uuid        not null references public.app_users(id) on delete cascade,
  reason     text,
  status     text        not null check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_by uuid        references public.app_users(id) on delete set null,
  decided_at timestamptz
);
create index if not exists mcp_access_requests_status_idx on public.mcp_access_requests (status, created_at);
create index if not exists mcp_access_requests_user_idx on public.mcp_access_requests (user_id);

create table if not exists public.mcp_oauth_clients (
  client_id     text        primary key,
  client_name   text,
  redirect_uris jsonb       not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.mcp_auth_requests (
  id             text        primary key,
  client_id      text        not null references public.mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri   text        not null,
  state          text,
  code_challenge text        not null,
  expires_at     timestamptz not null
);

create table if not exists public.mcp_oauth_codes (
  code_hash      text        primary key,
  client_id      text        not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id        uuid        not null references public.app_users(id) on delete cascade,
  redirect_uri   text        not null,
  code_challenge text        not null,
  expires_at     timestamptz not null,
  used           boolean     not null default false
);

create table if not exists public.mcp_tokens (
  id                 text        primary key,
  user_id            uuid        not null references public.app_users(id) on delete cascade,
  client_id          text        not null references public.mcp_oauth_clients(client_id) on delete cascade,
  access_hash        text        not null,
  access_expires_at  timestamptz not null,
  refresh_hash       text        not null,
  refresh_expires_at timestamptz not null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz
);
create unique index if not exists mcp_tokens_access_idx on public.mcp_tokens (access_hash);
create unique index if not exists mcp_tokens_refresh_idx on public.mcp_tokens (refresh_hash);
create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id);

create table if not exists public.mcp_calls (
  id         text        primary key,
  token_id   text,
  user_id    uuid        not null references public.app_users(id) on delete cascade,
  client_id  text,
  tool       text        not null,
  target     text,
  status     integer,
  ok         boolean     not null,
  note       text,
  ms         integer,
  created_at timestamptz not null default now()
);
create index if not exists mcp_calls_created_idx on public.mcp_calls (created_at desc);
create index if not exists mcp_calls_user_idx on public.mcp_calls (user_id, created_at desc);

-- Server-side only: RLS on, no policy, no privilege for the public roles.
alter table public.mcp_access          enable row level security;
alter table public.mcp_access_requests enable row level security;
alter table public.mcp_oauth_clients   enable row level security;
alter table public.mcp_auth_requests   enable row level security;
alter table public.mcp_oauth_codes     enable row level security;
alter table public.mcp_tokens          enable row level security;
alter table public.mcp_calls           enable row level security;

revoke all on table
  public.mcp_access, public.mcp_access_requests, public.mcp_oauth_clients,
  public.mcp_auth_requests, public.mcp_oauth_codes, public.mcp_tokens, public.mcp_calls
from public, anon, authenticated;

comment on table public.mcp_tokens is
  'AI Connector tokens (0782). SHA-256 hashes only; the plain token exists only in the AI app. Read and written by the Carres API with the service key; no policy, no grant to the public roles.';
comment on table public.mcp_calls is
  'AI Connector lookups (0782): one row per tool call, shown to the principal on the AI Connector page. Written by the Carres API with the service key.';
