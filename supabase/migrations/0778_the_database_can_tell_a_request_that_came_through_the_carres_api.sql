-- =============================================================================
-- 0778 · The database can tell a request that came through the Carres API
--
-- Owner: 16 Nov 2026. What Carres pays for an item and who Carres buys it from
-- are for Carres's internal roles. A store login (dealer, salesperson,
-- showroom) sells; it never sees them.
--
-- WHY THE DATABASE HAS TO KNOW WHERE A REQUEST CAME FROM
--   A store login needs the product tables to sell: the price, the sizes, the
--   options. The same rows also carry the cost and the supplier's item code.
--   Row-level security decides which ROWS an account reads, never which
--   columns. The Carres API can leave those columns out of what it sends a
--   store, but only if the store reads the rows through the API and nowhere
--   else.
--
-- WHAT THIS ADDS (the mechanism only; no policy changes here, see 0779)
--   1. private.carres_api_secret: one row, one random value. The schema is not
--      served by the data API and no role but the owner reads the table.
--   2. is_through_carres_api(): true when the request carries that value in
--      its x-carres-api header, or is the server itself.
--   3. carres_api_secret(): hands the value to the service key, which only
--      the Carres API holds. The API reads it at start-up and sends it on the
--      requests it is willing to answer for an account that is not internal.
--   4. carres_api_door_check(): for the service key only. Says whether the
--      header on THIS request matches, so a deploy can prove the header
--      arrives before any policy depends on it.
--
-- NOTHING READS DIFFERENTLY AFTER THIS FILE. 0779 puts the question into the
-- policies, and is applied only once the deployed API is sending the header.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.carres_api_secret (
  only_row boolean primary key default true check (only_row),
  token    text not null check (length(token) >= 32),
  set_at   timestamptz not null default now()
);

alter table private.carres_api_secret enable row level security;
revoke all on table private.carres_api_secret from public, anon, authenticated, service_role;

comment on table private.carres_api_secret is
  'One row: the value the Carres API sends in x-carres-api so the database can tell its requests from a direct one. Read only through carres_api_secret() (service key) and compared only inside is_through_carres_api(). To replace it: update the row; the API picks the new value up within five minutes (0778).';

-- Two version-4 UUIDs: 244 random bits, from the same generator as every id.
insert into private.carres_api_secret (token)
values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (only_row) do nothing;

-- ── is this request one the Carres API made? ────────────────────────────────
-- The data API puts the request's headers in request.headers for the length of
-- the request. A direct database session has none, and is the server.

create or replace function public.is_through_carres_api()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select public.is_server_call()
      or coalesce(
           (nullif(current_setting('request.headers', true), '')::json ->> 'x-carres-api')
             = (select s.token from private.carres_api_secret s),
           false)
$function$;

comment on function public.is_through_carres_api() is
  'True when the request carries the Carres API''s value in x-carres-api, or is the server (service key, direct session). A policy uses it beside is_carres_or_seller() for a table a store may read only through the API, because the API removes the columns a store must not see (0778, 0779). Answers only true or false.';

revoke all on function public.is_through_carres_api() from public, anon;
grant execute on function public.is_through_carres_api() to authenticated, service_role;

-- ── the value, for the Carres API only ──────────────────────────────────────

create or replace function public.carres_api_secret()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select s.token from private.carres_api_secret s
$function$;

comment on function public.carres_api_secret() is
  'The value the Carres API sends in x-carres-api. Executable by the service key only, which only the API holds (0778).';

revoke all on function public.carres_api_secret() from public, anon, authenticated;
grant execute on function public.carres_api_secret() to service_role;

-- ── does the header on this request match? (deploy check) ───────────────────
-- is_through_carres_api() is always true for the service key, so it cannot
-- show whether the header arrived. This one looks at the header alone.

create or replace function public.carres_api_door_check()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
           (nullif(current_setting('request.headers', true), '')::json ->> 'x-carres-api')
             = (select s.token from private.carres_api_secret s),
           false)
$function$;

comment on function public.carres_api_door_check() is
  'True when x-carres-api on this request matches. For the service key only: the Carres API calls it from GET /health/api-door so a deploy can prove the header reaches the database (0778).';

revoke all on function public.carres_api_door_check() from public, anon, authenticated;
grant execute on function public.carres_api_door_check() to service_role;

-- The mechanism has to exist exactly as described before 0779 leans on it.
do $check$
begin
  if not exists (select 1 from private.carres_api_secret) then
    raise exception 'private.carres_api_secret has no value, so nothing could ever match it';
  end if;

  if has_function_privilege('anon', 'public.carres_api_secret()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.carres_api_secret()', 'EXECUTE')
     or has_function_privilege('anon', 'public.carres_api_door_check()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.carres_api_door_check()', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_through_carres_api()', 'EXECUTE') then
    raise exception 'A signed-in account or the public key can reach a function that is for the server';
  end if;

  if has_table_privilege('anon', 'private.carres_api_secret', 'SELECT')
     or has_table_privilege('authenticated', 'private.carres_api_secret', 'SELECT')
     or has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'The private schema or its table is reachable by a signed-in account';
  end if;
end
$check$;
