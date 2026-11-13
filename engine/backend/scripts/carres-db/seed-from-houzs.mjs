// Copies MASTER and CONFIGURATION data from Houzs's masked LOCAL database into the Carres engine database.
// It copies NO transactions: no orders, purchase orders, GRNs, DOs, invoices, payments, journals, stock, rack
// contents, history, audit, backups, tokens, sessions and no users.
//
// FOR CARRES, use load-carres-master-data.mjs: it runs this copy (Carres groups only) together with Carres's own
// suppliers and warehouses in one transaction. This script is the copy on its own.
//
// WHAT IS COPIED (owner decision 13 Nov 2026):
//   default                 only the groups Carres takes from Houzs: categories, product-maintenance, so-maintenance
//                           (see GROUPS in seed-houzs-core.mjs for the exact tables and why)
//   --only=<g1,g2,...>      only these groups
//   --full                  the old test mode: the whole Houzs catalogue, suppliers and bindings, warehouses and
//                           racks, customers, staff, delivery rates, lead times, Finance chart of accounts, lookup
//                           lists. NOT for Carres's real engine database.
//
//   node scripts/carres-db/seed-from-houzs.mjs --dry-run   ask for the engine connection string, show the target and
//                                                           how many rows each table WOULD copy (done inside one
//                                                           transaction that is rolled back: nothing stays)
//   node scripts/carres-db/seed-from-houzs.mjs             the same, then copies after the project ref is typed back
//   node scripts/carres-db/seed-from-houzs.mjs --classify  list every non-empty Houzs table: copied (full mode) or
//                                                           skipped + why
//
// Run from engine/backend. SOURCE: Houzs's local database houzs_local (built by houzs-erp-local/.local-dev/
// import-snapshot.sh) as postgres@localhost:5432, password read from ~/.houzs-local-pg-pass; SEED_SOURCE_URL overrides.
// TARGET: the `postgres` admin connection string of the ENGINE's own Supabase project, typed or pasted on the terminal
// (nothing shows, it is not written anywhere), the same as apply.mjs. Never Carres-Portal-v2 (refused) and never a
// Houzs database. For local testing only, SEED_TARGET_URL may name a localhost database instead.
// The target must already be built by apply.mjs. Everything goes in ONE transaction; a re-run copies only what is
// missing and never changes or deletes a row already there.
import { askHidden, askLine } from "./ask.mjs";
import {
  COPY, CARRES_GROUPS, classify, connect, copyFromHouzs, dbName, isLocal, printCopyReport, refOf, safe, sourceUrl,
  srcTables, tablesOfGroups,
} from "./seed-houzs-core.mjs";

const DRY = process.argv.includes("--dry-run");
const CLASSIFY = process.argv.includes("--classify");
const FULL = process.argv.includes("--full");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const REFUSED_REFS = ["kfprgpjpaffedghytstl"]; // Carres-Portal-v2, the portal's own database

let tableNames;
try {
  if (FULL && onlyArg) throw new Error("Use --full or --only, not both.");
  tableNames = FULL ? Object.keys(COPY) : tablesOfGroups(onlyArg ? onlyArg.slice(7).split(",").map((s) => s.trim()).filter(Boolean) : CARRES_GROUPS);
} catch (e) { console.error(`${e.message} Nothing was copied.`); process.exit(1); }

let src;
try { src = connect(sourceUrl()); }
catch { console.error("Cannot read the Houzs local database password (~/.houzs-local-pg-pass). Nothing was copied."); process.exit(1); }
if (!src) { console.error("SEED_SOURCE_URL is not a valid connection string. Nothing was copied."); process.exit(1); }

if (CLASSIFY) {
  try {
    for (const { t } of await srcTables(src)) {
      const [{ n }] = await src.unsafe(`select count(*)::int as n from ${t}`);
      if (n === 0) continue;
      const [kind, why] = classify(t);
      console.log(`${kind.padEnd(4)}  ${t.padEnd(52)} ${String(n).padStart(6)}  ${why}`);
    }
  } finally { await src.end(); }
  process.exit(0);
}

let url = (process.env.SEED_TARGET_URL ?? "").trim();
if (url) {
  if (!isLocal(url)) { console.error("SEED_TARGET_URL is for a local test database only. Nothing was copied."); process.exit(1); }
} else {
  try { url = (await askHidden("Paste the engine database connection string (nothing will show), then press Enter: ")).trim(); }
  catch (e) { console.error(e.message); process.exit(1); }
}
if (!url) { console.error("Nothing was entered. Nothing was copied."); process.exit(1); }
if (isLocal(url) && dbName(url) === "houzs_local") { console.error("That is the Houzs source database itself. Nothing was copied."); process.exit(1); }
const ref = refOf(url);
if (ref && REFUSED_REFS.includes(ref)) { console.error("That is the Carres portal's own database. Use the engine's project. Nothing was copied."); process.exit(1); }
const target = ref ?? url.replace(/\/\/[^@]*@/, "//***@");
console.log(`Source: Houzs local database (masked snapshot)`);
console.log(`Copying: ${FULL ? "EVERYTHING in the full copy list (--full)" : `groups ${onlyArg ? onlyArg.slice(7) : CARRES_GROUPS.join(",")}`}`);
console.log(`Target database: ${target}${DRY ? "  (dry run: everything is rolled back)" : ""}`);
if (!DRY) {
  const typed = await askLine(`Type the project ref (${ref ?? "the host name shown above"}) to copy into it, or anything else to stop: `);
  if (typed !== (ref ?? target)) { console.error("That does not match. Nothing was copied."); process.exit(1); }
}
const dst = connect(url);
if (!dst) { console.error("That is not a valid connection string. Nothing was copied."); process.exit(1); }

const ROLLBACK = Symbol("dry run");
try {
  let report;
  try {
    await dst.begin(async (tx) => {
      report = await copyFromHouzs({ src, tx, tableNames, log: console.log });
      if (DRY) throw ROLLBACK;
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }
  console.log("");
  printCopyReport(report, DRY);
  if (DRY) console.log("Nothing was kept.");
} catch (e) {
  console.error(`STOPPED, nothing was copied: ${safe(e)}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([src.end(), dst.end()]);
}
