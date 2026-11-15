-- Run by apply.mjs after every run (not a numbered step): the engine's role, scm_engine, owns every table, view
-- and sequence in scm and public, including ones a later step created as the admin. Without this the engine
-- cannot read those tables (6 Nov 2026: sign-in failed on role_page_access, made by a Houzs step after 0003).
-- Safe to repeat: changing the owner to the one it already has does nothing.
do $$ declare r record; begin
  -- Tables: every one in scm, and every one in public except this project's own migration ledger.
  for r in select schemaname, tablename from pg_tables
           where schemaname = 'scm' or (schemaname = 'public' and tablename <> 'engine_migrations') loop
    execute format('alter table %I.%I owner to scm_engine', r.schemaname, r.tablename);
  end loop;
  for r in select schemaname, viewname as name from pg_views where schemaname in ('scm', 'public')
           union all select schemaname, matviewname from pg_matviews where schemaname in ('scm', 'public') loop
    execute format('alter table %I.%I owner to scm_engine', r.schemaname, r.name);
  end loop;
  -- Sequences not tied to a column (those follow their table).
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind = 'S' and n.nspname in ('scm', 'public')
             and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i')) loop
    execute format('alter sequence %I.%I owner to scm_engine', r.nspname, r.relname);
  end loop;
end $$;

grant execute on all functions in schema scm to scm_engine;
grant execute on all functions in schema public to scm_engine;

-- The data API's two public keys (anon, authenticated) reach no table in public: row-level security is on for
-- every one, neither role holds a privilege on any, and a table the admin makes later is not handed to them.
-- A table a step creates in public otherwise arrives readable AND writable with the project's public key (the
-- Supabase default); 15 Nov 2026: 21 had, all empty. The engine is not affected: it reads public as the tables'
-- owner (scm_engine, through Hyperdrive) and scm with the service key, and neither is subject to row-level
-- security. Run after every apply, so a table from a later Houzs step is closed by the same deploy that makes it.
do $$ declare r record; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- The engine's server reads scm through Supabase's data API with the service key (as Houzs and The Conts do):
-- that key gets every scm table, including ones made after step 0001, and never anon or authenticated.
grant usage on schema scm to service_role;
grant all on all tables in schema scm to service_role;
grant usage, select, update on all sequences in schema scm to service_role;
grant execute on all functions in schema scm to service_role;
alter default privileges in schema scm grant all on tables to service_role;
alter default privileges in schema scm grant usage, select, update on sequences to service_role;

-- And the data API serves scm next to public (6 Nov 2026: "Invalid schema: scm" on the Sales Orders list).
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, scm';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
