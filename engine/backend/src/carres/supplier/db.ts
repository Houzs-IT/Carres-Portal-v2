// Carres only (not part of Houzs's code): the Supplier Platform's one door to the database.
//
// Every statement the platform runs goes through `query(text, params)`: the text is a constant written in this
// folder and every value a person typed travels as a parameter, never inside the text. That is the whole defence
// against SQL injection here, so nothing in this folder may build SQL from request input.
//
// Dates and times are read as TEXT (to_char / ::text in the statements) and counts as integer, so a row means the
// same thing whichever driver ran it (postgres.js in the Worker, the test database in tests-pg).
import type { Sql } from "postgres";
import { getSql, resolveDatabaseUrl } from "../../db/pg";

export type Row = Record<string, unknown>;

export interface Db {
  query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Run `work` in ONE transaction: all of it lands, or none of it. */
  tx<T>(work: (db: Db) => Promise<T>): Promise<T>;
}

export function dbOver(sql: Sql): Db {
  const over = (s: Sql): Db => ({
    query: <T = Row>(text: string, params: readonly unknown[] = []) =>
      s.unsafe(text, params as never[]) as unknown as Promise<T[]>,
    tx: <T>(work: (db: Db) => Promise<T>) =>
      (s as Sql).begin((t) => work(over(t as unknown as Sql))) as unknown as Promise<T>,
  });
  return over(sql);
}

type DbEnv = { HYPERDRIVE?: { connectionString: string }; DATABASE_URL?: string };

let factory: (env: DbEnv) => Db = (env) => dbOver(getSql(resolveDatabaseUrl(env)));

/** The request's database: the engine's own Postgres, as the engine's own role (Hyperdrive in production). */
export function dbFor(env: DbEnv): Db {
  return factory(env);
}

/** Tests only: answer every `dbFor` with this database (tests-pg runs the routes against a disposable one).
 *  Returns the undo. */
export function useDbForTests(db: Db): () => void {
  const before = factory;
  factory = () => db;
  return () => { factory = before; };
}

/**
 * A list as one JSON parameter, read with `IN (SELECT jsonb_array_elements_text($n::text::jsonb))`.
 *
 * ALWAYS `$n::text::jsonb`, never `$n::jsonb`. postgres.js asks the server for each parameter's type before it binds,
 * and a parameter the server calls jsonb is JSON-encoded by the driver AGAIN: a string that is already JSON lands as
 * a jsonb string, not a list (docs/jsonb-double-encoding-coe.md). `::text` makes the server type the parameter as
 * text, so the one cast after it decodes exactly once. The same holds for every JSON this folder binds.
 */
export const jsonList = (values: readonly string[]): string => JSON.stringify(values);

/** The first row, or undefined when there is none. Reading `rows[0]` types a row that may not be there as if it
 *  always were; this says what a read really returns, so the "not found" branch is checked by the compiler. */
export const first = <T>(rows: readonly T[]): T | undefined => rows[0];

export const str = (v: unknown): string => (v == null ? "" : String(v));
export const strOrNull = (v: unknown): string | null => (v == null || String(v) === "" ? null : String(v));
export const int = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
export const bool = (v: unknown): boolean => v === true || v === "t" || v === "true" || v === 1 || v === "1";
