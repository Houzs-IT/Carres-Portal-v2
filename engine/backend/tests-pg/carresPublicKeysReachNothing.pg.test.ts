import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { assertDisposableTestDatabase } from './lib/doc-no-fixture';

/* Carres only: what scripts/carres-db/engine-owns-all.sql leaves behind, against real Postgres.
 *
 * The engine's Supabase project serves `public` through its data API, and a table made there by the admin arrives
 * readable AND writable with the project's public key (the Supabase default). The engine never uses that key: it
 * reads `public` as the tables' owner. So the script that runs after every apply closes every table in `public` to
 * the two public roles, and stops the next table being handed to them.
 *
 * The fixture first reproduces the open state (a table with no row-level security, granted to both roles, and the
 * default that grants the next one) and PROVES it is open, so a script that did nothing could not pass.
 *
 * Needs a disposable database: TEST_DATABASE_URL=postgres://...@127.0.0.1/houzs_test. SKIPPED without it. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const SCRIPT = fileURLToPath(new URL('../scripts/carres-db/engine-owns-all.sql', import.meta.url));
const PUBLIC_ROLES = ['anon', 'authenticated'] as const;
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

let sql: Sql;

/** What one role can do to one table, tried for real rather than read off the catalogue. */
async function attempt(role: string, statement: string): Promise<'done' | 'refused'> {
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx.unsafe(statement);
      throw new Error('ROLL_BACK');
    });
  } catch (e) {
    const err = e as { message?: string; code?: string };
    if (err.message === 'ROLL_BACK') return 'done';
    if (err.code === '42501') return 'refused';
    throw e;
  }
  return 'done';
}

/** Every table in public a public role still holds any privilege on. */
async function reachable(): Promise<string[]> {
  const rows = await sql<{ t: string }[]>`
    select distinct c.relname as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(${sql.array([...PUBLIC_ROLES])}::text[]) as r(role)
     cross join unnest(${sql.array([...PRIVILEGES])}::text[]) as p(priv)
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege(r.role, c.oid, p.priv)
     order by 1`;
  return rows.map((r) => r.t);
}

describePg('Carres engine: the data API\'s public keys reach no table in public', () => {
  beforeAll(async () => {
    assertDisposableTestDatabase(url);
    sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    await sql.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'scm_engine') then create role scm_engine nologin; end if;
      end $$;
      create schema if not exists scm;
      grant usage on schema public to anon, authenticated, service_role, scm_engine;
      drop table if exists public.zzt_open_table, public.zzt_later_table;
      -- The open state, as a Houzs step leaves it on Supabase: no row-level security, both public roles granted,
      -- and the default that hands them the next table too.
      alter default privileges in schema public grant all on tables to anon, authenticated;
      create table public.zzt_open_table (id int primary key, note text);
      insert into public.zzt_open_table values (1, 'ZZT-ENGINE-ROW');`);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe('drop table if exists public.zzt_open_table, public.zzt_later_table');
    await sql.end();
  });

  test('before the script the fixture really is open (or this suite proves nothing)', async () => {
    expect(await reachable()).toContain('zzt_open_table');
    for (const role of PUBLIC_ROLES) {
      expect(await attempt(role, 'select * from public.zzt_open_table')).toBe('done');
      expect(await attempt(role, "insert into public.zzt_open_table values (2, 'x')")).toBe('done');
    }
  });

  test('after it, row-level security is on for every table and neither public role holds a privilege', async () => {
    await sql.unsafe(await readFile(SCRIPT, 'utf8'));

    const off = await sql<{ t: string }[]>`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
    expect(off.map((r) => r.t)).toEqual([]);
    expect(await reachable()).toEqual([]);

    for (const role of PUBLIC_ROLES) {
      expect(await attempt(role, 'select * from public.zzt_open_table')).toBe('refused');
      expect(await attempt(role, "insert into public.zzt_open_table values (2, 'x')")).toBe('refused');
      expect(await attempt(role, "update public.zzt_open_table set note = 'x'")).toBe('refused');
      expect(await attempt(role, 'delete from public.zzt_open_table')).toBe('refused');
    }
  });

  test('the engine still reads and writes its own tables: it is their owner', async () => {
    const owner = await sql<{ o: string }[]>`
      select pg_get_userbyid(relowner) as o from pg_class where oid = 'public.zzt_open_table'::regclass`;
    expect(owner[0]?.o).toBe('scm_engine');

    const seen = await sql.begin(async (tx) => {
      await tx.unsafe('set local role scm_engine');
      await tx.unsafe("insert into public.zzt_open_table values (3, 'ZZT-ENGINE-WRITE')");
      return tx<{ note: string }[]>`select note from public.zzt_open_table order by id`;
    });
    expect(seen.map((r) => r.note)).toEqual(['ZZT-ENGINE-ROW', 'ZZT-ENGINE-WRITE']);
  });

  test('a table the admin makes afterwards is not handed to the public roles', async () => {
    await sql.unsafe('create table public.zzt_later_table (id int primary key)');
    expect(await reachable()).toEqual([]);
    for (const role of PUBLIC_ROLES) {
      expect(await attempt(role, 'select * from public.zzt_later_table')).toBe('refused');
    }
  });

  test('running it again changes nothing and still closes a table made in between', async () => {
    // zzt_later_table was made with no row-level security: the next run turns it on.
    await sql.unsafe(await readFile(SCRIPT, 'utf8'));
    const off = await sql<{ t: string }[]>`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
    expect(off.map((r) => r.t)).toEqual([]);
    expect(await reachable()).toEqual([]);
  });
});
