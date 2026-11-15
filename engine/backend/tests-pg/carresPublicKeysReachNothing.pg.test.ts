import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres, { type ReservedSql, type Sql } from 'postgres';
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
 * LEAVES NOTHING BEHIND. The script changes the owner of every table and the privileges of two roles, which is
 * exactly what it is for and exactly what the next test file must not inherit. So the whole file runs inside ONE
 * transaction on one connection and rolls it back at the end: roles, owners, privileges and the fixture all go.
 * Each attempt as another role is a savepoint, so `set local role` and a refused statement are both undone.
 *
 * Needs a disposable database: TEST_DATABASE_URL=postgres://...@127.0.0.1/houzs_test. SKIPPED without it. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const SCRIPT = fileURLToPath(new URL('../scripts/carres-db/engine-owns-all.sql', import.meta.url));
const PUBLIC_ROLES = ['anon', 'authenticated'] as const;
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

let sql: Sql;
let db: ReservedSql;

/** Runs `work` as `role` inside a savepoint and undoes it: the role, and whatever the statements did. */
async function as<T>(role: string, work: () => Promise<T>): Promise<T | 'refused'> {
  await db.unsafe('savepoint as_role');
  try {
    await db.unsafe(`set local role ${role}`);
    return await work();
  } catch (e) {
    if ((e as { code?: string }).code === '42501') return 'refused';
    throw e;
  } finally {
    await db.unsafe('rollback to savepoint as_role');
  }
}

/** What one role can do to one table, tried for real rather than read off the catalogue. */
const attempt = (role: string, statement: string) =>
  as(role, async () => {
    await db.unsafe(statement);
    return 'done' as const;
  });

/** Every table or view in public a public role still holds any privilege on. */
async function reachable(): Promise<string[]> {
  const rows = await db.unsafe<{ t: string }[]>(`
    select distinct c.relname as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array[${PUBLIC_ROLES.map((r) => `'${r}'`).join(', ')}]) as r(role)
     cross join unnest(array[${PRIVILEGES.map((p) => `'${p}'`).join(', ')}]) as p(priv)
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege(r.role, c.oid, p.priv)
     order by 1`);
  return rows.map((r) => r.t);
}

async function withoutRowSecurity(): Promise<string[]> {
  const rows = await db.unsafe<{ t: string }[]>(`
    select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
  return rows.map((r) => r.t);
}

describePg('Carres engine: the data API\'s public keys reach no table in public', () => {
  beforeAll(async () => {
    assertDisposableTestDatabase(url);
    sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    db = await sql.reserve();
    await db.unsafe('begin');
    await db.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'scm_engine') then create role scm_engine nologin; end if;
      end $$;
      create schema if not exists scm;
      grant usage on schema public to anon, authenticated, service_role, scm_engine;
      -- The open state, as a Houzs step leaves it on Supabase: no row-level security, both public roles granted,
      -- and the default that hands them the next table too.
      alter default privileges in schema public grant all on tables to anon, authenticated;
      create table public.zzt_open_table (id int primary key, note text);
      insert into public.zzt_open_table values (1, 'ZZT-ENGINE-ROW');`);
  });

  afterAll(async () => {
    if (db) {
      await db.unsafe('rollback');
      db.release();
    }
    if (sql) await sql.end();
  });

  test('before the script the fixture really is open (or this suite proves nothing)', async () => {
    expect(await reachable()).toContain('zzt_open_table');
    expect(await withoutRowSecurity()).toContain('zzt_open_table');
    for (const role of PUBLIC_ROLES) {
      expect(await attempt(role, 'select * from public.zzt_open_table')).toBe('done');
      expect(await attempt(role, "insert into public.zzt_open_table values (2, 'x')")).toBe('done');
    }
  });

  test('after it, row-level security is on for every table and neither public role holds a privilege', async () => {
    await db.unsafe(await readFile(SCRIPT, 'utf8'));

    expect(await withoutRowSecurity()).toEqual([]);
    expect(await reachable()).toEqual([]);

    for (const role of PUBLIC_ROLES) {
      expect(await attempt(role, 'select * from public.zzt_open_table')).toBe('refused');
      expect(await attempt(role, "insert into public.zzt_open_table values (2, 'x')")).toBe('refused');
      expect(await attempt(role, "update public.zzt_open_table set note = 'x'")).toBe('refused');
      expect(await attempt(role, 'delete from public.zzt_open_table')).toBe('refused');
    }
  });

  test('the engine still reads and writes its own tables: it is their owner', async () => {
    const owner = await db.unsafe<{ o: string }[]>(
      `select pg_get_userbyid(relowner) as o from pg_class where oid = 'public.zzt_open_table'::regclass`);
    expect(owner[0]?.o).toBe('scm_engine');

    const seen = await as('scm_engine', async () => {
      await db.unsafe("insert into public.zzt_open_table values (3, 'ZZT-ENGINE-WRITE')");
      const rows = await db.unsafe<{ note: string }[]>('select note from public.zzt_open_table order by id');
      return rows.map((r) => r.note);
    });
    expect(seen).toEqual(['ZZT-ENGINE-ROW', 'ZZT-ENGINE-WRITE']);
  });

  test('a table the admin makes afterwards is not handed to the public roles', async () => {
    await db.unsafe('create table public.zzt_later_table (id int primary key)');
    expect(await reachable()).toEqual([]);
    for (const role of PUBLIC_ROLES) {
      expect(await attempt(role, 'select * from public.zzt_later_table')).toBe('refused');
    }
  });

  test('running it again changes nothing and still closes a table made in between', async () => {
    // zzt_later_table was made with no row-level security: the next run turns it on.
    expect(await withoutRowSecurity()).toEqual(['zzt_later_table']);
    await db.unsafe(await readFile(SCRIPT, 'utf8'));
    expect(await withoutRowSecurity()).toEqual([]);
    expect(await reachable()).toEqual([]);
  });
});
