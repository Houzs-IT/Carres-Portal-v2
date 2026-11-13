// Loads Carres's master data into the Carres engine database in ONE transaction (owner decision 13 Nov 2026):
//
//   D  CLEAN-UP   removes the hand-made test rows: supplier 400-T001 (only while it is NOT the AutoCount supplier
//                 of that code, see below), SKU / model TEST-PILLOW, warehouse TKL, and the rows that only point at
//                 them (supplier bindings, binding / selling / master price history, state → warehouse rows, the
//                 test model's own settings). If anything else points at them (an order, a PO, a GRN, stock, ...)
//                 it STOPS and names it; nothing is changed.
//   A  FROM HOUZS  categories, Products › Maintenance and Sales Orders › SO Maintenance reference data, copied from
//                 Houzs's masked local database (seed-houzs-core.mjs, groups categories, product-maintenance,
//                 so-maintenance). NO Houzs suppliers, SKUs, models, bindings, combo pricing, warehouses, customers,
//                 staff, Finance, delivery rates or venues.
//   C  WAREHOUSES  Carres's own three: KLG-WH01 Klang Warehouse (stock warehouse, the default), PJ-HQ PJ Showroom
//                 (a showroom: it is offered in the Sales Order Showroom picker) and KLG-SVC Klang Service (goods
//                 returned to a supplier for service, type service, like Houzs's KL SERVICE); Selangor, Kuala Lumpur and
//                 Putrajaya are delivered from KLG-WH01 (the SO needs a state → warehouse row to save).
//   B  SUPPLIERS   Carres's AutoCount creditor list (the "Supplier List" export): one engine supplier per Code.
//   E  CATALOGUE  Carres's own product models, SKUs, supplier bindings and sofa combos, plus the maintenance
//                 entries Carres needs that Houzs's copied maintenance lacks, from the owner-reviewed restructure
//                 workbook (Carres-SKU-Restructure-Review.xlsx, approved 13 Nov 2026; see carres-catalog.mjs for
//                 sheets and shapes). Bindings to a supplier code that is not in the supplier list (405-S002) or with
//                 no supplier are left out and listed; their SKUs are still loaded. No selling prices; stock
//                 balances are never loaded as stock. `--no-skus` skips this step.
//
// RUN (from engine/backend, on the machine that holds Houzs's local database houzs_local):
//
//   node scripts/carres-db/load-carres-master-data.mjs
//   node scripts/carres-db/load-carres-master-data.mjs --suppliers "C:\path\Carres - Supplier List.xlsx" --skus "C:\path\Carres-SKU-Restructure-Review.xlsx"
//   node scripts/carres-db/load-carres-master-data.mjs --dry-run      show the summary and stop
//
// It asks once for the engine database connection string (the `postgres` admin one of the ENGINE's own Supabase
// project; nothing shows and it is not written anywhere). It refuses the Carres portal's own database. It runs
// everything once inside a transaction that is rolled back and shows what WOULD change (rows per table, item
// groups / skipped rows with reasons), then asks you to type the project ref to apply it for real.
// RE-RUN: safe. Suppliers and warehouses are matched by code and only changed where the file differs; Houzs rows
// are copied only when missing; the clean-up finds nothing the second time. A second run changes nothing.
//
// Default files: %USERPROFILE%\Downloads\Carres - Supplier List.xlsx and, for --skus, Carres-SKU-Restructure-Review.xlsx
// in %USERPROFILE%\Downloads, else in Desktop\Carres-Portal-v2-worktrees\handoff.
// Local test only: SEED_TARGET_URL=<localhost connection string> instead of the question; the "type the ref"
// answer can then be piped on stdin. SEED_SOURCE_URL overrides the Houzs source (see seed-houzs-core.mjs).
//
// AS A MIGRATION (no connection string at all; the engine deploy applies it with its own secret):
//
//   node scripts/carres-db/load-carres-master-data.mjs --emit-sql scripts/carres-db/migrations/NNNN_carres_master_data.sql
//
// writes the same load as one idempotent SQL file and touches no engine database: it reads the same files and
// houzs_local, and builds a throwaway local engine schema on the same local server to read columns from (see
// emit-sql.mjs). Commit the file as the next migration; the next engine deploy applies it.
//
// SUPPLIER COLUMNS (AutoCount "Supplier List" export, header row 1) → engine supplier (same fields the New Supplier
// form writes): Code → code (the AutoCount creditor code) · Company Name → name · Currency Code → currency ·
// Registration No. → registration_no · Address 1-4 → address1-4 (and address = the lines joined, which GRN / PO
// screens print) · Post/Zip Code → postcode · Attention → attention and contact_person · Credit Term →
// payment_terms · Nature Of Business → nature_of_business · Phone 1 → phone (E.164, like the form) · Email
// Address → email. Derived: supplier_type (Logistic → TRANSPORT, control account 405-0000 → OTHERS, otherwise
// SUPPLIER) and the supply category from Nature Of Business (NATURE_TO_CATEGORY below; unknown natures are listed,
// never guessed). Control Account is not stored (the engine has no field for it).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { askHidden, askLine } from "./ask.mjs";
import { loadCatalog, readCatalog } from "./carres-catalog.mjs";
import { emitMasterDataSql } from "./emit-sql.mjs";
import { CARRES_GROUPS, connect, copyFromHouzs, dbName, isLocal, printCopyReport, refOf, safe, sourceUrl, tablesOfGroups } from "./seed-houzs-core.mjs";

const require = createRequire(import.meta.url);
const ENGINE_REF = "pxdnkoduwwsmzrgbfsqq"; // the engine's own Supabase project
const REFUSED_REFS = ["kfprgpjpaffedghytstl"]; // Carres-Portal-v2, the portal's own database
const DOWNLOADS = join(homedir(), "Downloads");

const argv = process.argv.slice(2);
const argOf = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; return v && !v.startsWith("--") ? v : ""; };
const DRY = argv.includes("--dry-run");
const SUPPLIERS_FILE = argOf("--suppliers") || join(DOWNLOADS, "Carres - Supplier List.xlsx");
const NO_SKUS = argv.includes("--no-skus");
const EMIT_SQL = argOf("--emit-sql");
const SKUS_FILE = argOf("--skus") || [join(DOWNLOADS, "Carres-SKU-Restructure-Review.xlsx"),
  join(homedir(), "Desktop", "Carres-Portal-v2-worktrees", "handoff", "Carres-SKU-Restructure-Review.xlsx")].find((f) => existsSync(f))
  || join(DOWNLOADS, "Carres-SKU-Restructure-Review.xlsx");

// ── C · Carres's own warehouses (owner, 13 Nov 2026) ──────────────────────────────────────────────────────────────
// The engine warehouse has no contact fields: the contact goes in `location` after the street address.
const WAREHOUSES = [
  { code: "KLG-WH01", name: "Klang Warehouse", type: "warehouse", is_showroom: false, is_default: true, venue_name: null,
    location: "Lot 6515, Batu 5 1/2, Jalan Kapar · Contact: Chan 012-4749881",
    city: "Klang", postcode: "42100", state: "Selangor", country: "Malaysia" },
  { code: "PJ-HQ", name: "PJ Showroom", type: "showroom", is_showroom: true, is_default: false, venue_name: "PJ Showroom",
    location: "109, Jalan SS 25/2, Taman Mayang · Contact: Kris 012-6008198",
    city: "Petaling Jaya", postcode: "47301", state: "Selangor", country: "Malaysia" },
  // Goods returned to a supplier for service, like Houzs's "KL SERVICE" (type service): not default, no state maps to it.
  { code: "KLG-SVC", name: "Klang Service (returned to supplier for service)", type: "service", is_showroom: false, is_default: false,
    venue_name: null, location: "Lot 6515, Batu 5 1/2, Jalan Kapar · Contact: Chan 012-4749881",
    city: "Klang", postcode: "42100", state: "Selangor", country: "Malaysia" },
];
const STATE_TO_WAREHOUSE = { Selangor: "KLG-WH01", "Kuala Lumpur": "KLG-WH01", Putrajaya: "KLG-WH01" };

// ── D · the hand-made test rows ───────────────────────────────────────────────────────────────────────────────────
const TEST_SUPPLIER_CODE = "400-T001"; // AutoCount also has a real 400-T001 (THE CONTS SDN BHD): see cleanUp()
const TEST_ITEM_CODE = "TEST-PILLOW";
const TEST_WAREHOUSE_CODE = "TKL";

// ── B · supply category from AutoCount "Nature Of Business" (engine pool: Products › Maintenance › Supplier
// Categories, copied from Houzs: Sofa, Bedframe, Mattress, Accessory, Service, Sofa Accessory). Lower-case keys;
// a nature may list several, comma separated. `null` = a known nature with no supply category.
const NATURE_TO_CATEGORY = {
  "bed frame": "Bedframe", bedframe: "Bedframe", mattress: "Mattress", "mattress protector": "Accessory",
  pillow: "Accessory", sofa: "Sofa", accessory: "Accessory", logistic: null, logistics: null,
};
const CURRENCIES = new Set(["MYR", "RMB", "CNY", "USD", "SGD"]); // the engine supplier form's list

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
const text = (v) => { if (v == null) return null; const t = String(v).replace(/\s+/g, " ").trim(); return t === "" || t === "-1" ? null : t; };
/** The engine's phone rule (backend src/scm/shared/phone.ts normalizePhone): E.164, Malaysian local by default. */
function normalizePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim(); const hadPlus = s.startsWith("+"); const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  let n;
  if (hadPlus || digits.startsWith("60")) n = digits;
  else if (digits.startsWith("0")) n = "60" + digits.slice(1);
  else if (digits.length >= 8) n = "60" + digits;
  else return s; // too short to normalise: kept as typed, like the form
  if (n.startsWith("60")) {
    const national = n.slice(2); const stripped = national.replace(/^(?:60|0)+/, "");
    const plausible = stripped.startsWith("1") ? [9, 10].includes(stripped.length) : [8, 9].includes(stripped.length);
    if (stripped !== national && plausible) n = "60" + stripped;
  }
  return n.length < 7 ? s : "+" + n;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readSheet(file) {
  if (!existsSync(file)) throw new Error(`File not found: ${file}`);
  let XLSX;
  try { XLSX = require("xlsx"); } catch { throw new Error("The xlsx reader is missing: run `npm ci` in engine/backend first."); }
  const wb = XLSX.read(readFileSync(file));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
  const header = (rows[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  return { header, rows: rows.slice(1).filter((r) => r.some((c) => text(c) != null)) };
}

// ── B · suppliers from the AutoCount export ───────────────────────────────────────────────────────────────────────
function readSuppliers(file) {
  const { header, rows } = readSheet(file);
  const need = ["control account", "code", "currency code", "company name", "registration no.", "address 1", "address 2",
    "address 3", "address 4", "post/zip code", "attention", "credit term", "nature of business", "phone 1", "email address"];
  const missing = need.filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`${file}: missing column(s) ${missing.join(", ")}`);
  const col = (r, h) => text(r[header.indexOf(h)]);
  const out = []; const skipped = []; const natures = new Map(); const seen = new Set();
  rows.forEach((r, i) => {
    const line = i + 2;
    const code = col(r, "code"); const name = col(r, "company name");
    if (!code || !name) { skipped.push(`row ${line}: no ${!code ? "Code" : "Company Name"}`); return; }
    if (seen.has(code.toUpperCase())) { skipped.push(`row ${line}: ${code} appears twice; the first is kept`); return; }
    seen.add(code.toUpperCase());
    const nature = col(r, "nature of business");
    const cats = []; let logistic = false;
    for (const part of (nature ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
      const k = part.toLowerCase();
      if (/^logistics?$/.test(k)) logistic = true;
      if (!(k in NATURE_TO_CATEGORY)) { natures.set(part, "(not mapped)"); continue; }
      natures.set(part, NATURE_TO_CATEGORY[k] ?? "(none)");
      if (NATURE_TO_CATEGORY[k] && !cats.includes(NATURE_TO_CATEGORY[k])) cats.push(NATURE_TO_CATEGORY[k]);
    }
    const email = col(r, "email address");
    if (email && !EMAIL.test(email)) skipped.push(`row ${line}: ${code} email "${email}" is not an email; left empty`);
    const currency = (col(r, "currency code") ?? "MYR").toUpperCase();
    const lines = ["address 1", "address 2", "address 3", "address 4"].map((h) => col(r, h)?.replace(/,\s*$/, "") ?? null);
    const attention = col(r, "attention");
    out.push({
      code, name,
      currency: CURRENCIES.has(currency) ? currency : "MYR",
      registration_no: col(r, "registration no."),
      address1: lines[0], address2: lines[1], address3: lines[2], address4: lines[3],
      address: lines.filter(Boolean).join(", ") || null,
      postcode: col(r, "post/zip code"),
      attention, contact_person: attention,
      payment_terms: col(r, "credit term"),
      nature_of_business: nature,
      phone: normalizePhone(col(r, "phone 1")),
      email: email && EMAIL.test(email) ? email : null,
      supplier_type: logistic ? "TRANSPORT" : col(r, "control account") === "405-0000" ? "OTHERS" : "SUPPLIER",
      category: cats.length ? cats.join(", ") : null,
    });
  });
  return { suppliers: out, skipped, natures };
}
const SUPPLIER_COLS = ["name", "currency", "registration_no", "address1", "address2", "address3", "address4", "address",
  "postcode", "attention", "contact_person", "payment_terms", "nature_of_business", "phone", "email", "supplier_type", "category"];

// ── The steps, all through one transaction ────────────────────────────────────────────────────────────────────────
async function companyId(tx) {
  const cos = await tx`select id, code, name from public.companies order by id`;
  if (cos.length !== 1) throw new Error(`The target has ${cos.length} companies; expected exactly the one Carres company`);
  return cos[0].id;
}

/** D: delete the test rows and what only points at them; stop if anything else does. */
async function cleanUp(tx, co, realT001Name) {
  const ids = async (q) => (await q).map((r) => r.id);
  // 400-T001 is a test row only while its name is not the AutoCount supplier of that code: after the first load the
  // real one (THE CONTS SDN BHD) holds the code and must never be deleted by a re-run.
  const S = await ids(tx`select id from scm.suppliers where company_id = ${co} and code = ${TEST_SUPPLIER_CODE}
                          and upper(trim(name)) is distinct from upper(trim(${realT001Name ?? ""}))`);
  const P = await ids(tx`select id from scm.mfg_products where company_id = ${co} and code = ${TEST_ITEM_CODE}`);
  const M = await ids(tx`select id from scm.product_models where company_id = ${co} and model_code = ${TEST_ITEM_CODE}`);
  const W = await ids(tx`select id from scm.warehouses where company_id = ${co} and code = ${TEST_WAREHOUSE_CODE}`);
  const found = { [`supplier ${TEST_SUPPLIER_CODE} (test)`]: S.length, [`SKU ${TEST_ITEM_CODE}`]: P.length, [`model ${TEST_ITEM_CODE}`]: M.length, [`warehouse ${TEST_WAREHOUSE_CODE}`]: W.length };
  const report = [];
  if (!S.length && !P.length && !M.length && !W.length) return { report: [["test rows", 0, "none found"]], found };

  // 1. Every foreign key pointing at those rows. Allowed: rows that only describe the test rows themselves.
  const ALLOWED = new Set([
    "scm.supplier_material_bindings", "scm.supplier_scan_codes", "scm.mrp_supplier_category_lead_times",
    "scm.state_warehouse_mappings", "scm.my_localities", "scm.mfg_products",
    "scm.model_special_delivery_fees", "scm.model_fabric_tier_overrides", "scm.model_default_free_gifts", "scm.product_model_photos",
  ]);
  const targets = [["scm.suppliers", S], ["scm.mfg_products", P], ["scm.product_models", M], ["scm.warehouses", W]];
  const fks = await tx`
    select (c.conrelid::regclass)::text as t, (c.confrelid::regclass)::text as ref,
           (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col
    from pg_constraint c where c.contype = 'f' and array_length(c.conkey, 1) = 1
      and c.confrelid in ('scm.suppliers'::regclass, 'scm.mfg_products'::regclass, 'scm.product_models'::regclass, 'scm.warehouses'::regclass)`;
  const blockers = [];
  const quote = (t) => t.split(".").map((p) => `"${p}"`).join(".");
  for (const f of fks) {
    const t = f.t.includes(".") ? f.t : `public.${f.t}`;
    const set = targets.find(([name]) => name === (f.ref.includes(".") ? f.ref : `public.${f.ref}`))[1];
    if (!set.length) continue;
    const ownRows = t === "scm.mfg_products" && P.length ? ` and not (id::text = any($2::text[]))` : "";
    const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${quote(t)} where "${f.col}"::text = any($1::text[])${ownRows}`,
      ownRows ? [set.map(String), P.map(String)] : [set.map(String)]);
    if (!n) continue;
    if (ALLOWED.has(t) && t !== "scm.mfg_products") continue;
    blockers.push(`${t}.${f.col}: ${n} row(s)`);
  }
  // 2. Tables that name an item by its code (no foreign key): only price history and bindings may.
  const CODE_ALLOWED = new Set(["scm.supplier_material_bindings", "scm.supplier_binding_price_history",
    "scm.mfg_product_price_history", "scm.master_price_history", "scm.mfg_products"]);
  if (P.length || M.length) {
    const coded = await tx`select table_schema || '.' || table_name as t, column_name as col from information_schema.columns
      where table_schema = 'scm' and column_name in ('item_code', 'product_code', 'sku_code', 'model_code')
        and table_name in (select table_name from information_schema.tables where table_schema = 'scm' and table_type = 'BASE TABLE')`;
    for (const { t, col } of coded) {
      if (CODE_ALLOWED.has(t) || t === "scm.product_models") continue;
      const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${quote(t)} where "${col}" = $1`, [TEST_ITEM_CODE]);
      if (n) blockers.push(`${t}.${col} = ${TEST_ITEM_CODE}: ${n} row(s)`);
    }
  }
  if (blockers.length) throw new Error(`the test rows are still used elsewhere:\n  ${blockers.join("\n  ")}`);

  // 3. Delete, children first.
  const del = async (label, q) => { const r = await q; report.push([label, r.count, ""]); };
  const sIds = S.map(String);
  await del("scm.supplier_binding_price_history", tx`delete from scm.supplier_binding_price_history where company_id = ${co} and (supplier_id::text = any(${sIds}) or item_code = ${TEST_ITEM_CODE})`);
  await del("scm.mfg_product_price_history", tx`delete from scm.mfg_product_price_history where company_id = ${co} and item_code = ${TEST_ITEM_CODE}`);
  await del("scm.master_price_history", tx`delete from scm.master_price_history where company_id = ${co} and item_code = ${TEST_ITEM_CODE}`);
  await del("scm.supplier_material_bindings", tx`delete from scm.supplier_material_bindings where company_id = ${co} and (supplier_id::text = any(${sIds}) or item_code = ${TEST_ITEM_CODE})`);
  await del("scm.state_warehouse_mappings (to TKL)", tx`delete from scm.state_warehouse_mappings where warehouse_id::text = any(${W.map(String)})`);
  await del("scm.mfg_products", tx`delete from scm.mfg_products where id::text = any(${P.map(String)})`);
  await del("scm.product_models", tx`delete from scm.product_models where id::text = any(${M.map(String)})`);
  await del("scm.suppliers", tx`delete from scm.suppliers where id::text = any(${sIds})`);
  await del("scm.warehouses", tx`delete from scm.warehouses where id::text = any(${W.map(String)})`);
  return { report, found };
}

/** Insert-or-update by (company_id, code); counts inserted / updated / unchanged. */
async function upsertByCode(tx, table, co, row, cols) {
  const values = cols.map((c) => row[c]);
  const set = cols.map((c) => `"${c}" = excluded."${c}"`).join(", ");
  const distinct = `(${cols.map((c) => `t."${c}"`).join(", ")}) is distinct from (${cols.map((c) => `excluded."${c}"`).join(", ")})`;
  const r = await tx.unsafe(
    `insert into ${table} as t (company_id, code, ${cols.map((c) => `"${c}"`).join(", ")})
     values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")})
     on conflict (company_id, code) do update set ${set}, updated_at = now() where ${distinct}
     returning id, (xmax = 0) as inserted`, [co, row.code, ...values]);
  return r.length === 0 ? "unchanged" : r[0].inserted ? "inserted" : "updated";
}
const tally = () => ({ inserted: 0, updated: 0, unchanged: 0 });

/** C: the three warehouses, the one default, and the state → warehouse rows. */
const WAREHOUSE_COLS = ["name", "type", "is_showroom", "is_default", "venue_name", "location", "city", "postcode", "state", "country", "is_active"];
async function loadWarehouses(tx, co) {
  const t = tally();
  const cols = WAREHOUSE_COLS;
  for (const w of WAREHOUSES) t[await upsertByCode(tx, "scm.warehouses", co, { ...w, is_active: true }, cols)]++;
  const undefaulted = (await tx`update scm.warehouses set is_default = false, updated_at = now()
    where company_id = ${co} and is_default and code <> ${WAREHOUSES.find((w) => w.is_default).code} returning code`).map((r) => r.code);
  const m = tally();
  for (const [state, code] of Object.entries(STATE_TO_WAREHOUSE)) {
    const r = await tx`
      insert into scm.state_warehouse_mappings as m (company_id, state, warehouse_id, notes)
      select ${co}, ${state}, w.id, 'Carres master data' from scm.warehouses w where w.company_id = ${co} and w.code = ${code}
      on conflict (company_id, state) do update set warehouse_id = excluded.warehouse_id, updated_at = now()
        where m.warehouse_id is distinct from excluded.warehouse_id
      returning (xmax = 0) as inserted`;
    m[r.length === 0 ? "unchanged" : r[0].inserted ? "inserted" : "updated"]++;
  }
  // The engine still carries Houzs's venue alias (scm.canonicalize_venue / canonical-venue.ts): "PJ Showroom" is
  // stored as "2990s PJ" on warehouses AND on orders. Say so instead of hiding it; fixing the alias is engine work.
  const rewritten = [];
  for (const w of WAREHOUSES.filter((x) => x.venue_name)) {
    const [row] = await tx`select venue_name from scm.warehouses where company_id = ${co} and code = ${w.code}`;
    if (row && row.venue_name !== w.venue_name) rewritten.push(`${w.code}: "${w.venue_name}" is stored as "${row.venue_name}"`);
  }
  return { warehouses: t, mappings: m, undefaulted, rewritten };
}

async function loadSuppliers(tx, co, suppliers) {
  const t = tally();
  for (const s of suppliers) t[await upsertByCode(tx, "scm.suppliers", co, s, SUPPLIER_COLS)]++;
  return t;
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────────────────────────
let sup;
try { sup = readSuppliers(SUPPLIERS_FILE); }
catch (e) { console.error(`${e.message}\nNothing was changed.`); process.exit(1); }
console.log(`Suppliers file: ${SUPPLIERS_FILE}  (${sup.suppliers.length} suppliers)`);
let catalog = null;
if (!NO_SKUS) {
  try {
    if (!existsSync(SKUS_FILE)) throw new Error(`File not found: ${SKUS_FILE} (give it with --skus, or skip with --no-skus)`);
    catalog = readCatalog(SKUS_FILE, require("xlsx"), readFileSync);
  } catch (e) { console.error(`${e.message}
Nothing was changed.`); process.exit(1); }
  console.log(`Catalogue file: ${SKUS_FILE}  (${catalog.models.length} models, ${catalog.skus.length} SKUs, ${catalog.bindings.length} binding rows, ${catalog.combos.length} combo rows)`);
}

if (EMIT_SQL !== undefined) {
  if (!EMIT_SQL) { console.error("--emit-sql needs the output file, e.g. scripts/carres-db/migrations/NNNN_carres_master_data.sql"); process.exit(1); }
  let srcUrl, srcDb;
  try { srcUrl = sourceUrl(); srcDb = connect(srcUrl); }
  catch { console.error("Cannot read the Houzs local database password (~/.houzs-local-pg-pass). Nothing was written."); process.exit(1); }
  if (!srcDb || !isLocal(srcUrl)) { console.error("The Houzs source must be a local database. Nothing was written."); process.exit(1); }
  try {
    const { outFile, report } = await emitMasterDataSql({
      outFile: EMIT_SQL, src: srcDb, srcUrl, suppliers: sup.suppliers, supplierCols: SUPPLIER_COLS, catalog,
      warehouses: WAREHOUSES, warehouseCols: WAREHOUSE_COLS, stateToWarehouse: STATE_TO_WAREHOUSE,
      testRows: { supplierCode: TEST_SUPPLIER_CODE, itemCode: TEST_ITEM_CODE, warehouseCode: TEST_WAREHOUSE_CODE,
        realName: sup.suppliers.find((s) => s.code.toUpperCase() === TEST_SUPPLIER_CODE)?.name ?? null },
      sourceFiles: [SUPPLIERS_FILE, ...(catalog ? [SKUS_FILE] : [])],
    });
    console.log(`Local engine schema: built from ${report.built} migrations, then dropped.`);
    console.log(`
── A · from Houzs (groups ${CARRES_GROUPS.join(", ")}), written as on-conflict-do-nothing inserts`);
    printCopyReport(report.houzs, true);
    console.log(`
Suppliers ${sup.suppliers.length} · warehouses ${WAREHOUSES.length} · state → warehouse ${Object.keys(STATE_TO_WAREHOUSE).length}${report.catalog ? ` · models ${report.catalog.models} · SKUs ${report.catalog.skus} · bindings ${report.catalog.bindings} · combo rows ${report.catalog.combos}` : ""}`);
    if (sup.skipped.length) { console.log("Suppliers skipped / adjusted:"); for (const x of sup.skipped) console.log(`  ${x}`); }
    console.log(`
WROTE ${outFile}
No engine database was touched. Commit it as the next migration; the engine deploy applies it.`);
  } catch (e) {
    console.error(`STOPPED, nothing was written: ${safe(e)}`);
    process.exitCode = 1;
  } finally { await srcDb.end(); }
  process.exit(process.exitCode ?? 0);
}

let url = (process.env.SEED_TARGET_URL ?? "").trim();
if (url) {
  if (!isLocal(url)) { console.error("SEED_TARGET_URL is for a local test database only. Nothing was changed."); process.exit(1); }
} else {
  try { url = (await askHidden("Paste the engine database connection string (nothing will show), then press Enter: ")).trim(); }
  catch (e) { console.error(e.message); process.exit(1); }
}
if (!url) { console.error("Nothing was entered. Nothing was changed."); process.exit(1); }
if (isLocal(url) && dbName(url) === "houzs_local") { console.error("That is the Houzs source database itself. Nothing was changed."); process.exit(1); }
const ref = refOf(url);
if (ref && REFUSED_REFS.includes(ref)) { console.error("That is the Carres portal's own database. Use the engine's project. Nothing was changed."); process.exit(1); }
const target = ref ?? url.replace(/\/\/[^@]*@/, "//***@");
console.log(`Target database: ${target}${ref && ref !== ENGINE_REF ? "   NOTE: this is not the engine's usual project (" + ENGINE_REF + ")" : ""}`);

let src;
try { src = connect(sourceUrl()); }
catch { console.error("Cannot read the Houzs local database password (~/.houzs-local-pg-pass). Nothing was changed."); process.exit(1); }
const dst = connect(url);
if (!src || !dst) { console.error("That is not a valid connection string. Nothing was changed."); process.exit(1); }

const realT001 = sup.suppliers.find((s) => s.code.toUpperCase() === TEST_SUPPLIER_CODE)?.name ?? null;
const ROLLBACK = Symbol("rolled back");

async function runAll(tx) {
  const co = await companyId(tx);
  const d = await cleanUp(tx, co, realT001);
  const a = await copyFromHouzs({ src, tx, tableNames: tablesOfGroups(CARRES_GROUPS) });
  const c = await loadWarehouses(tx, co);
  const b = await loadSuppliers(tx, co, sup.suppliers);
  const e = catalog ? await loadCatalog(tx, co, catalog) : null;
  return { d, a, c, b, e };
}

function printSummary({ d, a, c, b, e }, dry) {
  console.log(`\n── D · clean-up of the hand-made test rows`);
  console.log(`   found: ${Object.entries(d.found).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  for (const [t, n, note] of d.report) console.log(`   ${t.padEnd(44)} ${String(n).padStart(5)} deleted ${note}`);
  console.log(`\n── A · from Houzs (groups ${CARRES_GROUPS.join(", ")})`);
  printCopyReport(a, dry);
  console.log(`\n── C · warehouses`);
  console.log(`   scm.warehouses: ${c.warehouses.inserted} new · ${c.warehouses.updated} changed · ${c.warehouses.unchanged} unchanged  (${WAREHOUSES.map((w) => `${w.code} ${w.name}, ${w.type}`).join(" · ")})`);
  if (c.undefaulted.length) console.log(`   no longer the default warehouse: ${c.undefaulted.join(", ")}`);
  for (const r of c.rewritten) console.log(`   NOTE: venue name ${r} by the engine's Houzs venue alias (scm.canonicalize_venue); orders get the same name until that alias is removed`);
  console.log(`   scm.state_warehouse_mappings: ${c.mappings.inserted} new · ${c.mappings.updated} changed · ${c.mappings.unchanged} unchanged  (${Object.entries(STATE_TO_WAREHOUSE).map(([s, w]) => `${s} → ${w}`).join(" · ")})`);
  console.log(`\n── B · suppliers (${SUPPLIERS_FILE})`);
  console.log(`   scm.suppliers: ${b.inserted} new · ${b.updated} changed · ${b.unchanged} unchanged`);
  console.log(`   Nature Of Business → supply category:`);
  for (const [n, cat] of [...sup.natures].sort()) console.log(`     ${n.padEnd(24)} → ${cat}`);
  const unmapped = [...sup.natures].filter(([, cat]) => cat === "(not mapped)").map(([n]) => n);
  if (unmapped.length) console.log(`   NOT MAPPED (left without a supply category): ${unmapped.join(", ")}`);
  if (sup.skipped.length) { console.log(`   skipped / adjusted:`); for (const s of sup.skipped) console.log(`     ${s}`); }
  console.log(`\n── E · catalogue${e ? ` (${SKUS_FILE})` : ""}`);
  if (!e) console.log(`   not loaded (--no-skus).`);
  else {
    const t = (x) => `${x.inserted} new · ${x.updated} changed · ${x.unchanged} unchanged`;
    console.log(`   scm.product_models: ${t(e.models)}  (${catalog.models.length} in the workbook)`);
    console.log(`   scm.mfg_products (SKUs): ${t(e.skus)}  (${catalog.skus.length}; categories ${e.categories.join(", ")})`);
    console.log(`   scm.supplier_material_bindings: ${t(e.bindings)}  (${catalog.bindings.length} workbook rows)`);
    if (e.noSupplier.length) console.log(`     left out, no supplier in the workbook (${new Set(e.noSupplier).size} SKUs): ${[...new Set(e.noSupplier)].join(", ")}`);
    for (const [code, items] of e.missingSupplier) console.log(`     left out, supplier ${code} is not in the supplier list (${items.size} SKUs, loaded without a binding): ${[...items].join(", ")}`);
    console.log(`   scm.sofa_combo_pricing: ${t(e.combos)}  (${e.comboRows} workbook rows → ${e.comboGroups} combos; each = supplier row + company row; Wooden Arm variants fold onto the plain combo)`);
    console.log(`   Carres-only maintenance added (Houzs's copied maintenance lacked these): ${e.added.length ? "" : "none"}`);
    for (const x of e.added) console.log(`     + ${x}`);
    if (e.notAdded.length) { console.log(`   not loaded, kept in the workbook:`); for (const x of e.notAdded) console.log(`     - ${x}`); }
    console.log(`   No selling prices (none set yet). Stock balances are never loaded.`);
  }
  if (dry) console.log(`\nThat was a dry run inside a transaction that was rolled back: nothing was kept.`);
}

try {
  // 1. Everything once, rolled back: what WOULD change.
  let plan;
  try { await dst.begin(async (tx) => { plan = await runAll(tx); throw ROLLBACK; }); }
  catch (e) { if (e !== ROLLBACK) throw e; }
  printSummary(plan, true);
  if (DRY) { process.exitCode = 0; }
  else {
    const typed = await askLine(`\nType the project ref (${ref ?? "the host name shown above"}) to apply all of this to it, or anything else to stop: `);
    if (typed !== (ref ?? target)) { console.error("That does not match. Nothing was changed."); process.exitCode = 1; }
    else {
      // 2. For real, the same steps in one transaction.
      let done;
      await dst.begin(async (tx) => { done = await runAll(tx); });
      console.log(`\nAPPLIED to ${target}:`);
      printSummary(done, false);
    }
  }
} catch (e) {
  console.error(`STOPPED, nothing was changed: ${safe(e)}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([src.end(), dst.end()]);
}
