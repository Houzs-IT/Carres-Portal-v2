// Copies Houzs's MASTER and CONFIGURATION data (catalogue, suppliers, warehouses, customers, delivery rates, lead
// times, Finance chart of accounts and its settings, lookup lists) from Houzs's masked LOCAL database into the Carres
// engine database, so the whole engine flow (Sales Order > MRP > PO > GRN > PI > DO > Sales Invoice > payment) can be
// test-run on real master data. It copies NO transactions: no orders, purchase orders, GRNs, DOs, invoices, payments,
// journals, stock, rack contents, history, audit, backups, tokens, sessions and no users.
//
//   node scripts/carres-db/seed-from-houzs.mjs --dry-run   ask for the engine connection string, show the target and
//                                                           how many rows each table WOULD copy (done inside one
//                                                           transaction that is rolled back: nothing stays)
//   node scripts/carres-db/seed-from-houzs.mjs             the same, then copies after the project ref is typed back
//   node scripts/carres-db/seed-from-houzs.mjs --classify  list every non-empty Houzs table: copied or skipped + why
//
// Run from engine/backend. SOURCE: Houzs's local database houzs_local (built by houzs-erp-local/.local-dev/
// import-snapshot.sh) as postgres@localhost:5432, password read from ~/.houzs-local-pg-pass; SEED_SOURCE_URL overrides.
// TARGET: the `postgres` admin connection string of the ENGINE's own Supabase project, typed or pasted on the terminal
// (nothing shows, it is not written anywhere), the same as apply.mjs. Never Carres-Portal-v2 (refused) and never a
// Houzs database. For local testing only, SEED_TARGET_URL may name a localhost database instead.
// The target must already be built by apply.mjs.
//
// What it does: copies only the columns both sides have, keeps every id so references line up, takes only rows of
// Houzs's main company (code HOUZS) and rows with no company, and gives them the engine's own company id. A reference
// to something not copied (a user, a 2990 row) becomes empty when the column allows it; otherwise the row is left out
// and reported. Everything goes in ONE transaction, in reference order, each insert `on conflict do nothing`, so a
// re-run copies only what is missing and never changes or deletes a row already there. Id counters are moved past the
// copied ids afterwards.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { askHidden, askLine } from "./ask.mjs";

const DRY = process.argv.includes("--dry-run");
const CLASSIFY = process.argv.includes("--classify");
const REFUSED_REFS = ["kfprgpjpaffedghytstl"]; // Carres-Portal-v2, the portal's own database
const SOURCE_COMPANY_CODE = "HOUZS"; // Houzs's main company; 2990's Home rows are not copied

// ── What is copied ────────────────────────────────────────────────────────────────────────────────────────────────
// Each entry: optional `where` (extra SQL filter on the source rows), `orderBy` (which duplicate wins when the engine
// has a uniqueness rule Houzs lacks), `strip` (columns emptied: credentials, live bank account numbers, logins),
// `naturalKey` (a list the engine's own migrations already started: a Houzs row whose key is already there is left
// out, and one whose id is taken gets the next free id), `note` (why it is master/config). Order does not matter:
// it is computed from the target's foreign keys.
const COPY = {
  // Catalogue
  "scm.categories": { note: "product categories" },
  "scm.series": {}, "scm.products": {}, "scm.product_models": {}, "scm.product_size_variants": {},
  "scm.product_compartments": {}, "scm.product_bedframe_colours": {}, "scm.product_dept_configs": {},
  "scm.size_library": {}, "scm.compartment_library": {}, "scm.bundle_library": {}, "scm.addons": {},
  "scm.special_addons": {}, "scm.bedframe_colours": {}, "scm.bedframe_options": {}, "scm.mfg_products": {},
  "scm.fabrics": {}, "scm.fabric_library": {}, "scm.fabric_colours": {}, "scm.fabric_trackings": {},
  "scm.fabric_tier_addon_config": {}, "public.fabric_tier_addon_config": {}, "scm.compartment_fabric_tier_overrides": {},
  "scm.sofa_combo_pricing": {}, "scm.pos_sofa_combos": {}, "scm.sofa_quick_picks": {},
  "scm.model_default_free_gifts": {}, "scm.model_special_delivery_fees": {}, "scm.free_item_campaigns": {},
  "scm.pwp_rules": {}, "scm.currencies": {},
  // Parties
  "scm.suppliers": {},
  "scm.supplier_material_bindings": { orderBy: "is_main_supplier desc, updated_at desc nulls last" }, "public.suppliers": {}, "public.creditors": {},
  "scm.customers": { note: "masked in the snapshot" }, "scm.acc_debtors": {}, "scm.threepl_companies": {},
  "public.project_contractors": {}, "public.project_organizers": {},
  // People who appear on documents (no logins: user links and POS PINs are emptied)
  "scm.staff": { strip: ["pin_hash", "user_id"] }, "scm.drivers": { strip: ["user_id"] },
  "scm.helpers": { strip: ["user_id"] }, "scm.hr_salesperson_profiles": {}, "public.sales_reps": { strip: ["user_id"] },
  "public.sales_positions": {}, "public.departments": {}, "public.roles": {}, "public.positions": {},
  "public.position_capabilities": {}, "public.position_policy": {},
  // Places and logistics
  "scm.warehouses": {}, "scm.warehouse_racks": {}, "scm.state_warehouse_mappings": {}, "scm.showrooms": {},
  "scm.venues": {}, "scm.workshops": {}, "scm.lorries": {}, "public.warehouses": {}, "public.mfg_warehouses": {},
  "public.state_warehouse_map": {}, "scm.my_localities": {}, "scm.delivery_planning_regions": {},
  "scm.state_delivery_regions": {}, "scm.delivery_rate_cards": {}, "scm.delivery_rate_rules": {},
  "scm.delivery_residence_rules": {}, "scm.delivery_fee_config": {}, "scm.special_delivery_fee_rules": {},
  // Planning
  "scm.mrp_category_lead_times": {}, "scm.mrp_supplier_category_lead_times": {}, "public.mrp_category_lead_times": {},
  // Sales Order settings and lists
  "scm.so_dropdown_options": {}, "scm.so_settings": {}, "scm.so_scan_rules": {}, "scm.scan_field_aliases": {},
  "scm.hr_commission_config": {}, "scm.hr_item_kpi": {}, "public.sales_commission_tiers": {},
  "scm.analysis_customer_targets": {}, "public.udf_fields": {},
  // Finance
  "scm.accounts": { note: "chart of accounts" }, "scm.acc_account_roles": {}, "scm.acc_item_groups": {},
  "scm.acc_item_group_accounts": {}, "scm.acc_acquirer_config": {}, "scm.acc_company_acquirers": {},
  "scm.acc_bank_recognition_rules": {}, "scm.acc_bank_statement_config": { strip: ["account_no"] },
  "scm.acc_company_settings": {}, "scm.acc_report_layouts": {}, "scm.acc_vendor_memory": {},
  // Service cases and projects
  "public.assr_issue_categories": {}, "public.assr_ncr_categories": {},
  "public.assr_product_categories": {}, "public.assr_priorities": {}, "public.assr_priority_stage_targets": {},
  "public.assr_stage_targets": {}, "public.assr_lead_time_profiles": {}, "public.assr_resolution_methods": {},
  "public.document_types": {}, "public.project_brands": { strip: ["logo_r2_key"] }, "public.project_cost_rates": {},
  "public.project_venues": {}, "public.project_event_types": { naturalKey: "slug" }, "public.project_checklist_templates": {},
  "public.project_checklist_template_sections": {}, "public.project_checklist_template_items": {},
  // Settings, filtered to the generic switches (Houzs branding, counters, checkpoints, secrets and backups stay)
  "public.app_settings": { where: `key not like 'branding%'` },
  "public.system_settings": { where: `key in ('inspection_checklist', 'logistics_budget_pct', 'fatigue_max_hours')` },
  "scm.app_config": { where: `key not like '%backup%' and key not like '%before%' and key not like '%last_run%'
                              and key not in ('owner_email', 'scm.venture_portal_feed', 'connect.company_profile')` },
  "public.agent_controls": { note: "AI assistants' on/off switches; copied so they stay paused as in Houzs" },
};

// ── Why everything else is skipped (first match wins) ─────────────────────────────────────────────────────────────
const SKIP = [
  [/^(public\._migrations|public\._pg_migrations|public\.engine_migrations)$/, "migration ledger"],
  [/^public\.(companies|user_companies|user_brands|user_departments)$/, "companies and user links: the engine has its own company"],
  [/^public\.(users|sessions|invitations|password_resets|table_layouts)$/, "users, logins and per-user screen settings"],
  [/token|^scm\.pos_pins$|^scm\.pos_pin_attempts$|^scm\.sync_config$|^public\.idempotency_keys$/, "tokens, PINs, secrets"],
  [/(^|\.)_local_|(^|\.)bak_|backup/, "one-off backups"],
  [/audit|history|_activity$|_log$|^public\.execution_logs$|^public\.client_errors$|status_changes|deletions|stage_history/, "history, audit and logs"],
  [/agent_(runs|proposals|findings|briefs)|^public\.ai_usage_events$|^public\.assistant_/, "AI assistant runs, proposals and Houzs's own instructions"],
  [/^public\.(email_|announcement)|^scm\.wa_message_log$|share_export_log/, "messages and announcements"],
  [/^public\.app_settings$|^public\.system_settings$/, "settings"],
  [/^public\.stock_items$/, "old AutoCount item mirror; the engine catalogue is scm.mfg_products"],
  [/^scm\.stock_allocation_recompute_lock$/, "engine lock row, already seeded by migration 2002"],
  [/^scm\.(inventory_|stock_|warehouse_rack_items|warehouse_rack_movements|grn_item_racks)/, "stock, stock movements and rack contents"],
  [/^scm\.(journal_|acc_(bank_statement(s|_lines|_matches)|bank_month_|bank_letters|settlement_|official_receipts|receipt|credit_note|debtor_bill|deposit_invoices|payment_request|pv_files|ap_invoice_files|supplier_advances|stock_close_runs|forecast_pnl))/, "Finance transactions and month-end runs"],
  [/^scm\.(mfg_sales_order|mfg_so_|so_amendment|so_revisions|so_payment_backdate|so_reconcile|so_mirror_skips|so_scan_samples|pending_slip_uploads|customer_credits|pwp_codes|pos_carts|quotes|orders|order_)/, "Sales Order transactions (PWP codes are vouchers issued to customers)"],
  [/^scm\.(purchase_|po_|grn|ap_invoice|payment_voucher|pv_allocations|consignment_|product_request|document_cancel_requests|delivery_order|delivery_return|delivery_planning_row_marks|driver_leave|lorry_(positions|work_order|compliance)|sales_invoice|scan_(jobs|files|file_views)|mrp_snapshots|doc_number_counters)/, "purchasing, receiving, delivery and invoice transactions, files and counters"],
  [/^public\.(sales_orders|sales_entries|order_details|purchase_order|autocount_delivery_orders|delivery_tracking|trip_|document_refs|udf_values|idea_comments|ac_snapshot_runs|job_runs)/, "old transactions, document numbers and job runs"],
  [/^public\.(assr_(cases|case_categories|items|attachments|logistics|supplier_returns|activity)|projects|project_(finance|checklist$|checklist_(sections|comments|attachment)|phase_photos|reads|sales_attendees|sales_bills))/, "service case and project transactions"],
  [/^scm\.(autocount_outbox|venture_portal_|sheet_sync_usage|geocode_cache|mv_ar_aging_meta|personal_quick_picks|sofa_personal_quick_picks|maintenance_config_history)/, "sync queues, caches and per-person picks"],
];
function classify(t) {
  if (COPY[t]) return ["COPY", COPY[t].note ?? "master/config"];
  for (const [re, why] of SKIP) if (re.test(t)) return ["skip", why];
  return ["skip", "not classified as master data"];
}

// ── Connections ───────────────────────────────────────────────────────────────────────────────────────────────────
function sourceUrl() {
  if (process.env.SEED_SOURCE_URL) return process.env.SEED_SOURCE_URL.trim();
  const pw = readFileSync(join(homedir(), ".houzs-local-pg-pass"), "utf8").trim();
  return `postgresql://postgres:${encodeURIComponent(pw)}@localhost:5432/houzs_local`;
}
const isLocal = (u) => /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(u);
const dbName = (u) => u.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "";
function connect(u) {
  try { return postgres(u, { max: 1, prepare: false, ssl: isLocal(u) ? false : "require", onnotice: () => {} }); }
  catch { console.error("That is not a valid connection string. Nothing was copied."); process.exit(1); }
}
/** Never let a connection error print the raw string (its message can carry the password). */
const safe = (e) => String(e?.message || e?.code || e?.errors?.[0]?.code || "could not connect").replace(/postgres(ql)?:\/\/[^\s'"]*/g, "postgresql://***");

let src;
try { src = connect(sourceUrl()); }
catch { console.error("Cannot read the Houzs local database password (~/.houzs-local-pg-pass). Nothing was copied."); process.exit(1); }

const srcTables = async () => (await src`
  select n.nspname || '.' || c.relname as t, c.reltuples::bigint as est
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'scm') order by 1`);

if (CLASSIFY) {
  try {
    for (const { t } of await srcTables()) {
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
const ref = url.match(/postgres\.([a-z0-9]{20})\b/)?.[1] ?? url.match(/db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ?? null;
if (ref && REFUSED_REFS.includes(ref)) { console.error("That is the Carres portal's own database. Use the engine's project. Nothing was copied."); process.exit(1); }
const target = ref ?? url.replace(/\/\/[^@]*@/, "//***@");
console.log(`Source: Houzs local database (masked snapshot)`);
console.log(`Target database: ${target}${DRY ? "  (dry run: everything is rolled back)" : ""}`);
if (!DRY) {
  const typed = await askLine(`Type the project ref (${ref ?? "the host name shown above"}) to copy into it, or anything else to stop: `);
  if (typed !== (ref ?? target)) { console.error("That does not match. Nothing was copied."); process.exit(1); }
}
const dst = connect(url);

// ── Schema reading ────────────────────────────────────────────────────────────────────────────────────────────────
async function columns(db) {
  const rows = await db`
    select n.nspname || '.' || c.relname as t, a.attname as col, a.attnotnull as notnull,
           a.attgenerated <> '' as generated, a.attidentity <> '' as identity, format_type(a.atttypid, a.atttypmod) as type
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'scm') and a.attnum > 0 and not a.attisdropped`;
  const m = new Map();
  for (const r of rows) { if (!m.has(r.t)) m.set(r.t, new Map()); m.get(r.t).set(r.col, r); }
  return m;
}
async function foreignKeys(db) {
  return db`
    select (c.conrelid::regclass)::text as t, (c.confrelid::regclass)::text as ref,
           array(select a.attname from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i)::text[] as cols,
           array(select a.attname from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i)::text[] as refcols
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname in ('public', 'scm')`;
}
// regclass prints public tables without the schema; use schema-qualified names everywhere.
const qualify = (t) => (t.includes(".") ? t : `public.${t}`);
const quoteIdent = (t) => t.split(".").map((p) => `"${p.replace(/"/g, '""')}"`).join(".");

// Keeps numbers JSON cannot hold exactly (big numerics, bigints) as their original text.
const parseRow = (text) => JSON.parse(text, (k, v, ctx) => (typeof v === "number" && ctx?.source && String(v) !== ctx.source ? ctx.source : v));
const USER_COL = /(^|_)(user_id|created_by|updated_by|deleted_by|approved_by|modified_by)$|_user_id$/;

const report = [];
try {
  const [srcCompany] = await src`select id from public.companies where code = ${SOURCE_COMPANY_CODE}`;
  if (!srcCompany) throw new Error(`Houzs company ${SOURCE_COMPANY_CODE} not found in the source`);
  const dstCompanies = await dst`select id, code, name from public.companies order by id`;
  if (dstCompanies.length !== 1) throw new Error(`The target has ${dstCompanies.length} companies; expected exactly the one Carres company`);
  const CARRES = String(dstCompanies[0].id);
  console.log(`Company: Houzs ${SOURCE_COMPANY_CODE} (id ${srcCompany.id}) rows become ${dstCompanies[0].name} (id ${CARRES}).`);

  const [sCols, dCols, dFks] = await Promise.all([columns(src), columns(dst), foreignKeys(dst)]);
  const fks = dFks.map((f) => ({ ...f, t: qualify(f.t), ref: qualify(f.ref) }));
  const companyCols = new Set(fks.filter((f) => f.ref === "public.companies" && f.cols.length === 1).map((f) => `${f.t}.${f.cols[0]}`));

  const tables = [];
  for (const t of Object.keys(COPY)) {
    if (!sCols.has(t)) { report.push([t, "-", 0, 0, "not in the Houzs database"]); continue; }
    if (!dCols.has(t)) { report.push([t, "-", 0, 0, "not in the engine database"]); continue; }
    tables.push(t);
  }
  const inSet = new Set(tables);

  // Reference order: a table goes after every copied table it points to.
  const deps = new Map(tables.map((t) => [t, new Set(fks.filter((f) => f.t === t && f.ref !== t && inSet.has(f.ref)).map((f) => f.ref))]));
  const order = [];
  const seen = new Set();
  const visit = (t, path = new Set()) => {
    if (seen.has(t)) return;
    if (path.has(t)) throw new Error(`reference loop at ${t}`);
    path.add(t); for (const d of deps.get(t)) visit(d, path); path.delete(t);
    seen.add(t); order.push(t);
  };
  tables.forEach((t) => visit(t));

  // Read the source rows.
  const data = new Map();
  const notes = new Map(tables.map((t) => [t, []]));
  for (const t of order) {
    const sc = sCols.get(t); const dc = dCols.get(t);
    const cols = [...sc.keys()].filter((c) => dc.has(c) && !dc.get(c).generated);
    const filters = [];
    // Company: every company_id column (foreign key to companies, or simply named company_id).
    const compCols = cols.filter((c) => companyCols.has(`${t}.${c}`) || c === "company_id");
    for (const c of compCols) filters.push(`("${c}" is null or "${c}"::text = '${srcCompany.id}')`);
    if (COPY[t].where) filters.push(`(${COPY[t].where})`);
    const rows = (await src.unsafe(`select to_jsonb(x)::text as r from ${quoteIdent(t)} x${filters.length ? " where " + filters.join(" and ") : ""}${COPY[t].orderBy ? ` order by ${COPY[t].orderBy}` : ""}`)).map((r) => parseRow(r.r));
    const [{ n: total }] = await src.unsafe(`select count(*)::int as n from ${quoteIdent(t)}`);
    for (const row of rows) {
      for (const k of Object.keys(row)) if (!cols.includes(k)) delete row[k];
      for (const c of compCols) if (row[c] != null) row[c] = CARRES;
      for (const c of COPY[t].strip ?? []) if (c in row) row[c] = dc.get(c).notnull ? "" : null;
    }
    // Columns pointing at users (no foreign key in Houzs's public tables): emptied when allowed.
    const fkCols = new Set(fks.filter((f) => f.t === t).flatMap((f) => f.cols));
    const userCols = cols.filter((c) => USER_COL.test(c) && !fkCols.has(c) && !dc.get(c).notnull && !(COPY[t].strip ?? []).includes(c));
    let cleared = 0;
    for (const row of rows) for (const c of userCols) if (row[c] != null) { row[c] = null; cleared++; }
    if (cleared) notes.get(t).push(`${userCols.join("/")} emptied on ${cleared}`);
    let kept = rows;
    const nk = COPY[t].naturalKey;
    if (nk) {
      // A list the engine's migrations already started: their rows win; a Houzs id already taken gets a new one.
      const there = await dst.unsafe(`select "${nk}"::text as k, id::text as id from ${quoteIdent(t)}`);
      const keys = new Set(there.map((r) => r.k)); const ids = new Set(there.map((r) => r.id));
      kept = rows.filter((r) => !keys.has(String(r[nk])));
      for (const r of kept) if (ids.has(String(r.id))) r.__newId = true;
      if (rows.length - kept.length) notes.get(t).push(`${rows.length - kept.length} already there by ${nk}`);
      const moved = kept.filter((r) => r.__newId).length;
      if (moved) notes.get(t).push(`${moved} given a new id`);
    }
    data.set(t, { cols, rows: kept, total });
  }

  // References: to a copied row, to a row already in the target, or emptied/left out.
  const existing = new Map();
  async function targetKeys(ref, refcols) {
    const key = `${ref}(${refcols})`;
    if (!existing.has(key)) {
      const rs = await dst.unsafe(`select ${refcols.map((c) => `"${c}"::text`).join(" || '|' || ")} as k from ${quoteIdent(ref)}`);
      existing.set(key, new Set(rs.map((r) => r.k)));
    }
    return existing.get(key);
  }
  const keyOf = (row, cols) => (cols.some((c) => row[c] == null) ? null : cols.map((c) => String(row[c])).join("|"));
  for (let pass = 0, changed = true; changed && pass < 10; pass++) {
    changed = false;
    for (const t of order) {
      const d = data.get(t);
      for (const f of fks.filter((x) => x.t === t && x.cols.every((c) => d.cols.includes(c)))) {
        if (f.ref === "public.companies") continue;
        const have = await targetKeys(f.ref, f.refcols);
        const copied = data.has(f.ref) ? new Set(data.get(f.ref).rows.map((r) => keyOf(r, f.refcols)).filter(Boolean)) : new Set();
        const nullable = f.cols.every((c) => !dCols.get(t).get(c).notnull);
        let nulled = 0, dropped = 0;
        d.rows = d.rows.filter((row) => {
          const k = keyOf(row, f.cols);
          if (k === null || copied.has(k) || have.has(k)) return true;
          if (nullable) { for (const c of f.cols) row[c] = null; nulled++; return true; }
          dropped++; return false;
        });
        if (nulled) notes.get(t).push(`${f.cols.join("/")} -> ${f.ref} emptied on ${nulled}`);
        if (dropped) { notes.get(t).push(`${dropped} left out: ${f.cols.join("/")} -> ${f.ref} not copied`); changed = true; }
      }
    }
  }

  // Copy, one transaction.
  const copiedCount = new Map();
  const ROLLBACK = Symbol("dry run");
  try {
    await dst.begin(async (tx) => {
      for (const t of order) {
        const { cols, rows } = data.get(t);
        let inserted = 0;
        const hasIdentity = cols.some((c) => dCols.get(t).get(c).identity);
        const list = cols.map((c) => `"${c}"`).join(", ");
        const plain = rows.filter((r) => !r.__newId);
        for (let i = 0; i < plain.length; i += 500) {
          const chunk = JSON.stringify(plain.slice(i, i + 500));
          const [{ n }] = await tx.unsafe(
            `with ins as (insert into ${quoteIdent(t)} (${list}) ${hasIdentity ? "overriding system value" : ""}
               select ${list} from jsonb_populate_recordset(null::${quoteIdent(t)}, $1::text::jsonb)
               on conflict do nothing returning 1) select count(*)::int as n from ins`, [chunk]);
          inserted += n;
        }
        const moved = rows.filter((r) => r.__newId).map(({ __newId, ...r }) => r);
        if (moved.length) {
          // Next free ids after everything already in the table (only for naturalKey lists: nothing copied points at them).
          const rest = cols.filter((c) => c !== "id").map((c) => `"${c}"`).join(", ");
          const [{ n }] = await tx.unsafe(
            `with ins as (insert into ${quoteIdent(t)} ("id", ${rest}) ${hasIdentity ? "overriding system value" : ""}
               select (select coalesce(max("id"), 0) from ${quoteIdent(t)}) + row_number() over (), ${rest}
               from jsonb_populate_recordset(null::${quoteIdent(t)}, $1::text::jsonb)
               on conflict do nothing returning 1) select count(*)::int as n from ins`, [JSON.stringify(moved)]);
          inserted += n;
        }
        copiedCount.set(t, inserted);
      }
      if (DRY) throw ROLLBACK;
      // Id counters past the copied ids, so the engine's next new row does not collide.
      for (const t of order) {
        for (const c of data.get(t).cols) {
          const [{ seq }] = await tx`select pg_get_serial_sequence(${quoteIdent(t)}, ${c}) as seq`;
          if (!seq) continue;
          await tx.unsafe(`select setval('${seq}', m) from (select max("${c}")::bigint as m from ${quoteIdent(t)}) x
                           where m is not null and m >= (select coalesce(last_value, 0) from pg_sequences where format('%I.%I', schemaname, sequencename) = '${seq}')`);
        }
      }
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }

  for (const t of order) {
    const d = data.get(t);
    report.push([t, d.total, d.rows.length, copiedCount.get(t) ?? 0, notes.get(t).join("; ")]);
  }
  console.log("");
  console.log(`${"table".padEnd(46)} ${"houzs".padStart(6)} ${"main co".padStart(7)} ${DRY ? "would copy" : "copied".padStart(10)}  notes`);
  for (const [t, total, eligible, copied, note] of report) console.log(`${t.padEnd(46)} ${String(total).padStart(6)} ${String(eligible).padStart(7)} ${String(copied).padStart(10)}  ${note}`);
  const sum = report.reduce((s, r) => s + r[3], 0);
  console.log(`\n${DRY ? "Would copy" : "Copied"} ${sum} rows into ${report.filter((r) => r[3] > 0).length} tables.${DRY ? " Nothing was kept." : ""}`);
} catch (e) {
  console.error(`STOPPED, nothing was copied: ${safe(e)}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([src.end(), dst.end()]);
}
