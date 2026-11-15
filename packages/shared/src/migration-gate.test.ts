import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
/* Repository tooling, deliberately plain `.mjs` with no declaration file — it
   is run by CI with node, not compiled. Typed at the boundary here. */
// @ts-expect-error -- untyped .mjs tooling module
import * as collisions from "../../../scripts/migration-collisions.mjs";
// @ts-expect-error -- untyped .mjs tooling module
import * as destructive from "../../../scripts/migration-destructive.mjs";

// @ts-expect-error -- untyped .mjs tooling module
import * as openPolicy from "../../../scripts/migration-open-policy.mjs";

const { isDestructiveSql } = destructive as { isDestructiveSql: (sql: string) => boolean };

interface OpenPolicy { policy: string; table: string; clause: string; expression: string }
const { findOpenPolicies, openPolicyMessage, normaliseExpression } = openPolicy as {
  findOpenPolicies: (sql: string) => OpenPolicy[];
  openPolicyMessage: (file: string, found: OpenPolicy[]) => string;
  normaliseExpression: (expression: string) => string;
};

const { findCollisions, staleBaselineEntries, collisionMessage, groupByNumber } =
  collisions as {
    findCollisions: (
      files: string[],
      baseline?: Set<string>,
    ) => Array<{ number: string; files: string[] }>;
    staleBaselineEntries: (files: string[], baseline?: Set<string>) => string[];
    collisionMessage: (c: Array<{ number: string; files: string[] }>) => string;
    groupByNumber: (files: string[]) => Map<string, string[]>;
  };

/**
 * THE MIGRATION NUMBER IS THE APPLY ORDER (red line 7).
 *
 * ── WHY THIS TEST EXISTS, AND WHY IT LIVES HERE ─────────────────────────────
 *
 * On 2026-08-24 two files claimed `0376` — one on `main`, one on a branch —
 * and NOTHING caught it. Git saw no conflict because the filenames differ, and
 * `check-migrations.mjs` passed because it validated the SHAPE of a name and
 * never compared one name to another. It was found by hand.
 *
 * The gate had no test at all, and could not easily have one: the script does
 * its work at import time. So the comparison moved into a pure module, and the
 * script gained a `MIGRATIONS_DIR` override so THE SHIPPED SCRIPT — not a copy
 * of its logic — can be run against a fixture.
 *
 * It lives in `packages/shared` because that is the workspace `pnpm test`
 * already runs; the repository has no root-level vitest project, and inventing
 * one to hold a single file would be a second test runner to keep in step.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "check-migrations.mjs");

/** Run the REAL gate against a throwaway migrations directory. */
function runGate(files: string[]): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "carres-migrations-"));
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), "-- fixture\nselect 1;\n");
  try {
    const out = execFileSync("node", [SCRIPT], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, MIGRATIONS_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the shipped gate refuses two files with one number", () => {
  it("FAILS on the exact collision that shipped past CI on 2026-08-24", () => {
    const res = runGate([
      "0375_a_sku_knows_the_suppliers_own_name_for_it.sql",
      "0376_the_import_carries_the_suppliers_own_code.sql",
      "0376_an_app_that_opened_is_not_a_pdf_that_arrived.sql",
    ]);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("share one number");
    expect(res.output).toContain("0376");
    // It names both files, so the reader knows which to renumber.
    expect(res.output).toContain("the_import_carries_the_suppliers_own_code");
    expect(res.output).toContain("an_app_that_opened_is_not_a_pdf_that_arrived");
  });

  it("PASSES on a unique ordered set", () => {
    const res = runGate([
      "0375_a.sql",
      "0376_b.sql",
      "0377_c.sql",
      "0378_d.sql",
    ]);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("Validated 4 migration filenames");
  });

  it("PASSES on a suffixed follow-up — `0376a` does not take `0376`", () => {
    const res = runGate(["0376_b.sql", "0376a_b_follow_up.sql", "0377_c.sql"]);
    expect(res.ok).toBe(true);
  });

  it("still refuses a malformed filename", () => {
    const res = runGate(["0375_ok.sql", "376_short.sql"]);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("Invalid migration filenames");
  });

  it("still refuses destructive SQL — the older teeth are intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "carres-migrations-"));
    writeFileSync(join(dir, "0375_ok.sql"), "drop table public.orders;\n");
    try {
      // No merge base in a fixture dir, so this proves filename validation and
      // collision detection run even when the diff cannot be computed.
      const res = runGate(["0375_ok.sql", "0375_also.sql"]);
      expect(res.ok).toBe(false);
      expect(res.output).toContain("share one number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the REAL repository passes its own gate", () => {
    const out = execFileSync("node", [SCRIPT], { cwd: REPO, encoding: "utf8" });
    expect(out).toContain("No migration was applied.");
  });
});

describe("what the gate calls destructive SQL", () => {
  const rewrite = (snippet: string) =>
    "select pg_temp.mig0681_rewrite('public.f(uuid)'::regprocedure,\n" +
    `$old$  ${snippet}$old$,\n$new$  ${snippet}\n    -- a comment$new$);\n`;

  it("refuses a bare delete, truncate or drop table at migration level", () => {
    expect(isDestructiveSql("delete from public.orders;\n")).toBe(true);
    expect(isDestructiveSql("truncate public.orders;\n")).toBe(true);
    expect(isDestructiveSql("drop table public.orders;\n")).toBe(true);
  });

  it("refuses one inside a do block, which runs when the migration applies", () => {
    expect(isDestructiveSql("do $$ begin delete from public.orders; end $$;\n")).toBe(true);
  });

  it("sets aside a function body: it runs when a user acts, not on apply", () => {
    expect(isDestructiveSql("create or replace function public.f() returns void language sql as $fn$ delete from public.t $fn$;\n")).toBe(false);
  });

  it("sets aside a function rewrite's snippets: they are text of a function body (0681)", () => {
    expect(isDestructiveSql(rewrite("delete from public.payment_voucher_allocations where voucher_id = v_id;"))).toBe(false);
  });

  it("still refuses a bare delete written after a rewrite call", () => {
    expect(isDestructiveSql(`${rewrite("select 1;")}delete from public.orders;\n`)).toBe(true);
  });

  it("does not read a comment, or a revoke of truncate", () => {
    expect(isDestructiveSql("-- it used to delete from orders\nselect 1;\n")).toBe(false);
    expect(isDestructiveSql("revoke truncate on public.orders from authenticated;\n")).toBe(false);
  });
});

/**
 * A POLICY MUST SAY WHO, NOT ONLY "SOMEBODY SIGNED IN" (0776 / 0777).
 *
 * The control is the repository's own history: the migrations that carried the
 * mistake must be flagged, and the two that replaced it must not. A rule that
 * passed 0002 would have passed all thirty-one.
 */
describe("what the gate calls a policy that admits every signed-in account", () => {
  const migration = (name: string) => readFileSync(join(REPO, "supabase", "migrations", name), "utf8");
  const names = (sql: string) => findOpenPolicies(sql).map((p) => `${p.table}.${p.policy}`);

  it("flags the three shapes the mistake was written in, in the files that wrote them", () => {
    // `(select auth.uid()) is not null` — where it started: six reads and the three history inserts.
    expect(names(migration("0002_rls.sql"))).toEqual(
      expect.arrayContaining([
        "product_models.catalog_read_all",
        "product_skus.skus_read_all",
        "warehouses.warehouses_read_all",
        "order_history.order_history_insert",
        "po_history.po_history_insert",
        "audit_log.audit_self_insert",
      ]),
    );
    // `true`, for the authenticated role.
    expect(names(migration("0722_office_staff_edit_the_state_city_and_postcode_lists.sql"))).toContain(
      "public.address_list_overrides.address_list_overrides_read",
    );
    // `auth.role() = 'authenticated'`.
    expect(names(migration("0303_purchasing_settings.sql"))).toContain(
      "public.purchasing_settings.purchasing_settings_read",
    );
  });

  it("flags a write the same way: with check is a door too", () => {
    const found = findOpenPolicies(
      "create policy order_history_insert on public.order_history\n  for insert with check ((select auth.uid()) is not null);\n",
    );
    expect(found).toEqual([
      { policy: "order_history_insert", table: "public.order_history", clause: "with check", expression: "(select auth.uid()) is not null" },
    ]);
  });

  it("flags an alter policy that opens one", () => {
    expect(names("alter policy t_read on public.t using (true);\n")).toEqual(["public.t.t_read"]);
  });

  it("passes the two migrations that replaced them", () => {
    expect(findOpenPolicies(migration("0776_only_carres_and_seller_logins_read_the_catalogue_and_settings.sql"))).toEqual([]);
    expect(findOpenPolicies(migration("0777_history_rows_and_internal_functions_ask_who_is_calling.sql"))).toEqual([]);
  });

  it("passes a policy that says who", () => {
    const sql = [
      "create policy a_read on public.a for select to authenticated using ((select public.is_carres_or_seller()));",
      "create policy b_read on public.b for select using ((select public.is_internal()));",
      "create policy c_read on public.c for select using (dealer_id = (select public.app_dealer_id()));",
      // Signed in AND something else is a rule about the row, not about being signed in.
      "create policy d_read on public.d for select using (auth.uid() is not null and owner_id = auth.uid());",
    ].join("\n");
    expect(findOpenPolicies(sql)).toEqual([]);
  });

  it("does not report a restrictive policy, a server-only policy, or a comment", () => {
    const sql = [
      "create policy r on public.t as restrictive for select using (true);",
      "create policy s on public.t for all to service_role using (true) with check (true);",
      "-- create policy old on public.t for select using (true);",
      "/* create policy older on public.t using (auth.uid() is not null); */",
    ].join("\n");
    expect(findOpenPolicies(sql)).toEqual([]);
  });

  it("reads through spacing, case, wrapping parentheses and a text cast", () => {
    expect(normaliseExpression("( ( SELECT auth.uid() ) IS NOT NULL )")).toBe("(selectauth.uid())isnotnull");
    expect(normaliseExpression("(auth.role() = 'authenticated'::text)")).toBe("auth.role()='authenticated'");
    expect(names('create policy "Any Member" on public.t\n  FOR SELECT\n  TO authenticated\n  USING ( TRUE );\n')).toEqual([
      "public.t.Any Member",
    ]);
  });

  it("the message names the policy and what to ask instead", () => {
    const msg = openPolicyMessage("supabase/migrations/0999_x.sql", findOpenPolicies("create policy t_read on public.t using (true);"));
    expect(msg).toContain("0999_x.sql");
    expect(msg).toContain("t_read on public.t");
    expect(msg).toContain("is_carres_or_seller");
    expect(msg).toContain("is_internal");
  });

  it("the shipped gate runs it on every migration a branch adds", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain("const openPolicies = findOpenPolicies(sql);");
    expect(src).toContain("if (openPolicies.length) throw new Error(openPolicyMessage(file, openPolicies));");
  });

  it("the four functions 0777 taught to ask who is calling are pinned against a rebuild", () => {
    const src = readFileSync(SCRIPT, "utf8");
    for (const fn of ["dealers_with_stats_list", "dealer_with_stats", "rental_current_agreement_template", "order_stamp_stair_carry"]) {
      expect(src, fn).toContain(`fn: "${fn}"`);
    }
  });
});

describe("the collision rule itself", () => {
  it("groups by the numeric prefix, letter suffix included", () => {
    const g = groupByNumber(["0376_a.sql", "0376_b.sql", "0376a_c.sql"]);
    expect(g.get("0376")).toHaveLength(2);
    expect(g.get("0376a")).toHaveLength(1);
  });

  it("reports every colliding number, newest first", () => {
    const found = findCollisions(["0100_a.sql", "0100_b.sql", "0200_c.sql", "0200_d.sql"]);
    expect(found.map((c) => c.number)).toEqual(["0200", "0100"]);
  });

  it("honours the baseline, and only the baseline", () => {
    const files = ["0165_a.sql", "0165_b.sql", "0376_c.sql", "0376_d.sql"];
    const found = findCollisions(files, new Set(["0165"]));
    expect(found.map((c) => c.number)).toEqual(["0376"]);
  });

  it("a baselined pair that stopped colliding must leave the list", () => {
    expect(staleBaselineEntries(["0165_a.sql"], new Set(["0165"]))).toEqual(["0165"]);
    expect(staleBaselineEntries(["0165_a.sql", "0165_b.sql"], new Set(["0165"]))).toEqual([]);
  });

  it("the message says which file to renumber, and against what", () => {
    const msg = collisionMessage(findCollisions(["0376_a.sql", "0376_b.sql"]));
    expect(msg).toContain("has NOT reached main");
  });
});

describe("the baseline is the measured historical set, and nothing more", () => {
  it("names exactly the thirteen numbers that already collide in this repository", () => {
    const src = readFileSync(SCRIPT, "utf8");
    for (const n of [
      "0165", "0166", "0204", "0206", "0232",
      "0233", "0239", "0241", "0242", "0255", "0267",
      /* 0417 joined 2026-09-03 (the #1065/#1066 merge race) and 0424 joined
         2026-09-04 (the #1091/#1093 race): each pair fully committed, so
         neither half may rename (red line 6); each is baselined with its
         measured applied/unapplied split recorded beside it. */
      "0417", "0424",
    ]) {
      expect(src, n).toContain(`"${n}"`);
    }
    // ...and it records that five of them left a half unapplied.
    expect(src).toContain("NOT APPLIED");
  });
});
