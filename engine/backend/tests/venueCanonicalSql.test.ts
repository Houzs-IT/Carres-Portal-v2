import { describe, expect, test } from "vitest";
import { VENUE_CANONICAL_MAP } from "../src/scm/lib/canonical-venue";

/* WHY THIS TEST EXISTS.
   One venue rule lives in three places: the TS front door (canonical-venue.ts), the
   Carres database function scm.canonicalize_venue() behind four BEFORE triggers, and
   the D1 test mirror's triggers. Two copies disagreeing is the failure this guards.

   Carres: the engine runs for Carres, which has NO venue aliases. Houzs's map folded
   "PJ Showroom" into "2990s PJ", a 2990 name that must never appear in Carres (its
   real showroom is named "PJ Showroom"). So the Carres contract is: the TS map is
   empty, the LATEST carres-db definition of scm.canonicalize_venue() has no alias
   branch, and the D1 alias triggers from migration 141 are dropped again. The Houzs
   history (migrations-pg/*_venue_canonicalize.sql) is not applied to Carres and is
   not checked here. */

const carresMigrations = import.meta.glob("../scripts/carres-db/migrations/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const d1Migrations = import.meta.glob("../src/db/migrations/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** The last CREATE OR REPLACE of scm.canonicalize_venue, in apply order. */
function latestCarresFunction(): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of Object.keys(carresMigrations).sort()) {
    const sql = carresMigrations[file].replace(/\r\n/g, "\n");
    const re = /CREATE OR REPLACE FUNCTION scm\.canonicalize_venue\(input text\)[\s\S]*?END \$function\$;/g;
    for (const m of sql.matchAll(re)) found = { file, body: m[0] };
  }
  if (!found) throw new Error("no carres-db migration defines scm.canonicalize_venue(text)");
  return found;
}

describe("Carres venue canonicalization: no Houzs/2990 aliases anywhere", () => {
  test("the TS map is empty", () => {
    expect(VENUE_CANONICAL_MAP).toEqual({});
  });

  test("the latest Carres scm.canonicalize_venue() has no alias branch", () => {
    const { file, body } = latestCarresFunction();
    expect(file).toMatch(/2007_carres_no_venue_aliases\.sql$/);
    expect(body).not.toMatch(/\bWHEN\b/);
    expect(body).not.toContain("2990");
    // Blank handling is unchanged: NULL stays NULL, blank returns its input.
    expect(body).toContain("IF input IS NULL THEN RETURN NULL; END IF;");
    expect(body).toContain("IF trimmed = '' THEN RETURN input; END IF;");
    expect(body).toContain("RETURN trimmed;");
  });

  test("every D1 alias trigger created by 141 is dropped again", () => {
    const files = Object.keys(d1Migrations).sort();
    const created = files
      .flatMap((f) => [...d1Migrations[f].matchAll(/CREATE TRIGGER IF NOT EXISTS (trg_\w*canonicalize\w*)/g)])
      .map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0); // guards against a vacuous pass
    const dropFile = files.find((f) => f.endsWith("_carres_drop_venue_aliases.sql"));
    expect(dropFile, "the Carres D1 drop migration is missing").toBeTruthy();
    for (const name of created) {
      expect(d1Migrations[dropFile!]).toContain(`DROP TRIGGER IF EXISTS ${name};`);
    }
  });
});
