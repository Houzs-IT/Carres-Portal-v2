// load-carres-master-data.mjs --emit-sql <file>: writes the SAME master data load as ONE idempotent SQL file, a
// migration the engine deploy applies with its own secret (apply.mjs --ci), so nobody pastes a connection string.
//
// It never connects to the engine database. It needs two LOCAL databases on the machine that holds Houzs's masked
// copy: houzs_local (the source, as for the loader) and a throwaway engine schema it builds itself on the same local
// server (carres_emit_<pid>, from every migration that sorts before the output file; dropped afterwards). The schema
// is used only to read the engine's columns, foreign keys and categories, so the Houzs copy goes through exactly the
// loader's filters, stripping and reference checks (seed-houzs-core.mjs copyFromHouzs, emit mode).
//
// THE FILE, in the loader's order, all in apply.mjs's one transaction:
//   guard   the Carres company (code HOUZS) exists; every company_id is (select id from public.companies where code = 'HOUZS')
//   D       clean-up of the hand-made test rows, a DO block: supplier 400-T001 only while its name is not the AutoCount
//           supplier of that code and contains TEST (any other name stops the run), SKU / model TEST-PILLOW, warehouse
//           TKL and the rows that only describe them. Anything else pointing at them stops the run, nothing changes.
//   A       Houzs rows, `on conflict do nothing` with their Houzs ids kept (as the loader), then the id counters.
//   C B E   warehouses, suppliers, models, SKUs, bindings, combos: upserts by natural key (code); a parent is found by
//           its code in a subselect, never by an id from the generating machine. Carres-only maintenance entries are
//           checked when the file RUNS against what the database then has (a DO block / where not exists).
// RE-RUN: applying the file again changes nothing (every write is on conflict do nothing, an upsert that only
// writes when a value differs, or a where-not-exists add). No row count of the target is asserted anywhere.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { comboId, bindingShape, planCatalog, planMaintenance, sen } from "./carres-catalog.mjs";
import { CARRES_GROUPS, connect, copyFromHouzs, quoteIdent, tablesOfGroups } from "./seed-houzs-core.mjs";

const CO = "(select id from public.companies where code = 'HOUZS')";
const KEY = (e) => `lower(btrim(regexp_replace(${e}, '\\s+', ' ', 'g')))`; // carres-catalog.mjs key()
const NORM = (e) => `regexp_replace(upper(coalesce(${e}, '')), '[^A-Z0-9]', '', 'g')`; // carres-catalog.mjs norm()

/** A SQL literal. Strings are standard-conforming ('' doubles a quote); objects become jsonb. */
export function lit(v) {
  if (v == null) return "null";
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`); return String(v); }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return `array[${v.map(lit).join(", ")}]::text[]`;
  if (typeof v === "object") return `${lit(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
const jsonLit = (v) => (v == null ? "null" : `${lit(JSON.stringify(v))}::jsonb`);
/** A dollar-quoted block whose tag does not occur in the body. */
function dollar(body, base = "j") {
  let tag = `$${base}$`;
  for (let i = 0; body.includes(tag); i++) tag = `$${base}${i}$`;
  return `${tag}${body}${tag}`;
}
const ident = (c) => `"${c.replace(/"/g, '""')}"`;
const supplierRef = (code) => `(select id from scm.suppliers where company_id = ${CO} and code = ${lit(code)})`;

/** Insert-or-update by (company_id, code), writing only when a value differs (the loader's upsertByCode). */
function upsertByCode(table, row, cols) {
  return `insert into ${table} as t (company_id, code, ${cols.map(ident).join(", ")})
values (${CO}, ${lit(row.code)}, ${cols.map((c) => lit(row[c])).join(", ")})
on conflict (company_id, code) do update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}, updated_at = now()
  where (${cols.map((c) => `t.${ident(c)}`).join(", ")}) is distinct from (${cols.map((c) => `excluded.${ident(c)}`).join(", ")});`;
}

// ── D · clean-up (cleanUp() in the loader, as one DO block) ─────────────────────────────────────────────────────────
function cleanUpSql({ supplierCode, itemCode, warehouseCode, realName }) {
  return `do $cleanup$
declare
  co bigint := ${CO};
  s_ids text[]; p_ids text[]; m_ids text[]; w_ids text[];
  odd text; f record; tq text; refq text; ids text[]; n int; blockers text[] := '{}';
  allowed text[] := array['scm.supplier_material_bindings', 'scm.supplier_scan_codes', 'scm.mrp_supplier_category_lead_times',
    'scm.state_warehouse_mappings', 'scm.my_localities', 'scm.mfg_products', 'scm.model_special_delivery_fees',
    'scm.model_fabric_tier_overrides', 'scm.model_default_free_gifts', 'scm.product_model_photos'];
  code_allowed text[] := array['scm.supplier_material_bindings', 'scm.supplier_binding_price_history',
    'scm.mfg_product_price_history', 'scm.master_price_history', 'scm.mfg_products', 'scm.product_models'];
begin
  -- ${supplierCode} is also a real AutoCount supplier (${realName ?? "none in the list"}): that one is kept. A test row's
  -- name contains TEST; any other name is neither, so stop instead of guessing.
  select string_agg(name, ', ') into odd from scm.suppliers
   where company_id = co and code = ${lit(supplierCode)} and upper(btrim(name)) is distinct from upper(btrim(${lit(realName ?? "")}))
     and name !~* 'test';
  if odd is not null then
    raise exception 'Carres master data: supplier ${supplierCode} is named "%", neither the AutoCount supplier nor a test row; nothing was changed', odd;
  end if;
  select coalesce(array_agg(id::text), '{}') into s_ids from scm.suppliers
   where company_id = co and code = ${lit(supplierCode)} and upper(btrim(name)) is distinct from upper(btrim(${lit(realName ?? "")}));
  select coalesce(array_agg(id::text), '{}') into p_ids from scm.mfg_products where company_id = co and code = ${lit(itemCode)};
  select coalesce(array_agg(id::text), '{}') into m_ids from scm.product_models where company_id = co and model_code = ${lit(itemCode)};
  select coalesce(array_agg(id::text), '{}') into w_ids from scm.warehouses where company_id = co and code = ${lit(warehouseCode)};
  if cardinality(s_ids) + cardinality(p_ids) + cardinality(m_ids) + cardinality(w_ids) = 0 then
    raise notice 'Carres master data: no test rows found';
    return;
  end if;

  -- 1. Every single-column foreign key pointing at those rows. Allowed: rows that only describe the test rows.
  for f in
    select (c.conrelid::regclass)::text as t, (c.confrelid::regclass)::text as ref, a.attname::text as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1
       and c.confrelid in ('scm.suppliers'::regclass, 'scm.mfg_products'::regclass, 'scm.product_models'::regclass, 'scm.warehouses'::regclass)
  loop
    tq := case when position('.' in f.t) > 0 then f.t else 'public.' || f.t end;
    refq := case when position('.' in f.ref) > 0 then f.ref else 'public.' || f.ref end;
    ids := case refq when 'scm.suppliers' then s_ids when 'scm.mfg_products' then p_ids
                     when 'scm.product_models' then m_ids else w_ids end;
    continue when cardinality(ids) = 0;
    if tq = 'scm.mfg_products' and cardinality(p_ids) > 0 then
      execute format('select count(*) from %s where %I::text = any($1) and not (id::text = any($2))', f.t, f.col) into n using ids, p_ids;
    else
      execute format('select count(*) from %s where %I::text = any($1)', f.t, f.col) into n using ids;
    end if;
    continue when n = 0;
    continue when tq = any(allowed) and tq <> 'scm.mfg_products';
    blockers := blockers || format('%s.%s: %s row(s)', tq, f.col, n);
  end loop;
  -- 2. Tables that name an item by its code (no foreign key): only price history and bindings may.
  if cardinality(p_ids) + cardinality(m_ids) > 0 then
    for f in
      select c.table_schema || '.' || c.table_name as t, c.column_name::text as col from information_schema.columns c
       where c.table_schema = 'scm' and c.column_name in ('item_code', 'product_code', 'sku_code', 'model_code')
         and c.table_name in (select table_name from information_schema.tables where table_schema = 'scm' and table_type = 'BASE TABLE')
    loop
      continue when f.t = any(code_allowed);
      execute format('select count(*) from %s where %I = $1', f.t, f.col) into n using ${lit(itemCode)}::text;
      if n > 0 then blockers := blockers || format('%s.%s = ${itemCode}: %s row(s)', f.t, f.col, n); end if;
    end loop;
  end if;
  if cardinality(blockers) > 0 then
    raise exception 'Carres master data: the test rows are still used elsewhere, nothing was changed: %', array_to_string(blockers, '; ');
  end if;

  -- 3. Delete, children first.
  delete from scm.supplier_binding_price_history where company_id = co and (supplier_id::text = any(s_ids) or item_code = ${lit(itemCode)});
  delete from scm.mfg_product_price_history where company_id = co and item_code = ${lit(itemCode)};
  delete from scm.master_price_history where company_id = co and item_code = ${lit(itemCode)};
  delete from scm.supplier_material_bindings where company_id = co and (supplier_id::text = any(s_ids) or item_code = ${lit(itemCode)});
  delete from scm.state_warehouse_mappings where warehouse_id::text = any(w_ids);
  delete from scm.mfg_products where id::text = any(p_ids);
  delete from scm.product_models where id::text = any(m_ids);
  delete from scm.suppliers where id::text = any(s_ids);
  delete from scm.warehouses where id::text = any(w_ids);
  raise notice 'Carres master data: removed test rows (suppliers %, SKUs %, models %, warehouses %)',
    cardinality(s_ids), cardinality(p_ids), cardinality(m_ids), cardinality(w_ids);
end $cleanup$;`;
}

// ── A · one Houzs table ─────────────────────────────────────────────────────────────────────────────────────────────
function houzsTableSql({ table, cols, rows, companyCols, hasIdentity, seqCols }) {
  if (!rows.length) return `-- ${table}: nothing to copy`;
  const t = quoteIdent(table);
  const select = cols.map((c) => (companyCols.includes(c) ? `case when r.${ident(c)} is null then null else ${CO} end` : `r.${ident(c)}`));
  const body = `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
  const out = [`-- ${table}: ${rows.length} row(s)`,
    `insert into ${t} (${cols.map(ident).join(", ")})${hasIdentity ? " overriding system value" : ""}
select ${select.join(", ")}
from jsonb_populate_recordset(null::${t}, ${dollar(body)}::jsonb) r
on conflict do nothing;`];
  // Id counters past the copied ids (the loader's setval), so the engine's next new row does not collide.
  for (const c of seqCols) {
    const seq = `pg_get_serial_sequence(${lit(t)}, ${lit(c)})`;
    out.push(`select setval(${seq}, m) from (select max(${ident(c)})::bigint as m from ${t}) x
 where m is not null and m >= coalesce((select last_value from pg_sequences where format('%I.%I', schemaname, sequencename) = ${seq}), 0);`);
  }
  return out.join("\n");
}

// ── E · catalogue ───────────────────────────────────────────────────────────────────────────────────────────────────
function catalogSql(cat, coId, supplierCodeOf) {
  const plan = planCatalog(cat, new Set(supplierCodeOf.keys()));
  const out = [];
  out.push(`-- E1 · product models (${cat.models.length})`);
  for (const m of cat.models) {
    out.push(`insert into scm.product_models as t (company_id, model_code, name, category, allowed_options, active)
values (${CO}, ${lit(m.model_code)}, ${lit(m.name ?? m.model_code)}, ${lit(m.category)}, '{}'::jsonb, true)
on conflict (company_id, model_code, category) do update set name = excluded.name, active = true, updated_at = now()
  where t.name is distinct from excluded.name or not t.active;`);
  }
  out.push(`\n-- E2 · SKUs (${cat.skus.length}); no selling prices, no stock`);
  const skuName = new Map(cat.skus.map((k) => [k.code, k.name]));
  for (const k of cat.skus) {
    const model = k.base_model ?? k.code;
    if (!cat.models.some((m) => m.model_code === model && m.category === k.category)) throw new Error(`SKU ${k.code}: no model ${model} (${k.category})`);
    const grid = plan.seatGrid.get(k.code) ?? null;
    const id = `mfg-${createHash("sha256").update(`carres-sku|${k.code}`).digest("hex").slice(0, 12)}`;
    out.push(`insert into scm.mfg_products as t (id, company_id, code, name, category, description, base_model, size_code, size_label,
  branding, status, cost_price_sen, seat_height_prices, model_id, pos_active)
values (${lit(id)}, ${CO}, ${lit(k.code)}, ${lit(k.name)}, ${lit(k.category)}::scm.mfg_product_category, ${lit(k.description)}, ${lit(k.base_model)},
  ${lit(k.size_code)}, ${lit(k.size_label)}, ${lit(k.branding)}, ${lit(k.status)}::scm.mfg_product_status, ${lit(sen(k.cost) ?? 0)}, ${jsonLit(grid)},
  (select id from scm.product_models where company_id = ${CO} and model_code = ${lit(model)} and category = ${lit(k.category)}), true)
on conflict (company_id, code) do update set name = excluded.name, category = excluded.category,
  description = excluded.description, base_model = excluded.base_model, size_code = excluded.size_code,
  size_label = excluded.size_label, branding = excluded.branding, status = excluded.status,
  cost_price_sen = excluded.cost_price_sen, seat_height_prices = excluded.seat_height_prices, model_id = excluded.model_id, updated_at = now()
  where (t.name, t.category, t.description, t.base_model, t.size_code, t.size_label, t.branding, t.status, t.cost_price_sen,
         t.seat_height_prices, t.model_id)
    is distinct from (excluded.name, excluded.category, excluded.description, excluded.base_model, excluded.size_code,
         excluded.size_label, excluded.branding, excluded.status, excluded.cost_price_sen, excluded.seat_height_prices, excluded.model_id);`);
  }
  out.push(`\n-- E3 · supplier bindings (${plan.groups.length}, one per supplier and SKU)`);
  if (plan.noSupplier.length) out.push(`--   left out, no supplier in the workbook (${new Set(plan.noSupplier).size} SKUs): ${[...new Set(plan.noSupplier)].join(", ")}`);
  for (const [code, items] of plan.missingSupplier) out.push(`--   left out, supplier ${code} is not in the supplier list (${items.size} SKUs, loaded without a binding): ${[...items].join(", ")}`);
  for (const g of plan.groups) {
    const { unit, matrix } = bindingShape(g);
    out.push(`insert into scm.supplier_material_bindings as t (company_id, supplier_id, material_kind, item_code, material_name, supplier_sku,
  unit_price_sen, currency, lead_time_days, moq, is_main_supplier, price_matrix)
values (${CO}, ${supplierRef(supplierCodeOf.get(g.supplier))}, 'mfg_product', ${lit(g.item)}, ${lit(skuName.get(g.item) ?? g.item)}, ${lit([...g.skus].join("; "))},
  ${lit(unit)}, 'MYR', ${lit(g.lead)}, ${lit(g.moq)}, ${lit(g.main)}, ${jsonLit(matrix)})
on conflict (company_id, supplier_id, material_kind, item_code) do update set material_name = excluded.material_name,
  supplier_sku = excluded.supplier_sku, unit_price_sen = excluded.unit_price_sen, lead_time_days = excluded.lead_time_days,
  moq = excluded.moq, is_main_supplier = excluded.is_main_supplier, price_matrix = excluded.price_matrix, updated_at = now()
  where (t.material_name, t.supplier_sku, t.unit_price_sen, t.lead_time_days, t.moq, t.is_main_supplier, t.price_matrix)
    is distinct from (excluded.material_name, excluded.supplier_sku, excluded.unit_price_sen, excluded.lead_time_days,
         excluded.moq, excluded.is_main_supplier, excluded.price_matrix);`);
  }
  let comboRows = 0;
  const comboOut = [];
  for (const g of plan.combos) {
    const code = g.supplier ? supplierCodeOf.get(g.supplier) ?? null : null;
    const rows = code ? [[code, null], [null, "auto-derived cost (max supplier)"]] : [[null, "auto-derived cost (max supplier)"]];
    for (const [rowCode, note] of rows) {
      comboRows++;
      comboOut.push(`insert into scm.sofa_combo_pricing as t (id, company_id, base_model, modules, tier, supplier_id, prices_by_height,
  selling_prices_by_height, pwp_prices_by_height, default_free_gifts, label, effective_from, notes)
values (${lit(comboId(coId, g, !!rowCode))}, ${CO}, ${lit(g.model)}, ${jsonLit(g.slots)}, ${lit(g.tier)}::scm.fabric_price_tier, ${rowCode ? supplierRef(rowCode) : "null"},
  ${jsonLit(g.prices)}, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, ${lit(g.label)}, current_date, ${lit(note)})
on conflict (id) do update set modules = excluded.modules, tier = excluded.tier, supplier_id = excluded.supplier_id,
  prices_by_height = excluded.prices_by_height, label = excluded.label, updated_at = now()
  where (t.modules, t.tier, t.supplier_id, t.prices_by_height, t.label)
    is distinct from (excluded.modules, excluded.tier, excluded.supplier_id, excluded.prices_by_height, excluded.label);`);
    }
  }
  out.push(`\n-- E4 · sofa combos (${plan.comboRows} workbook rows → ${plan.comboGroups} combos → ${comboRows} rows: the main supplier's row and the company row the Sales Order matches)`);
  out.push(...comboOut);
  out.push(`\n-- E5 · Carres-only maintenance entries, each added only when the database lacks it when this runs`);
  out.push(maintenanceSql(planMaintenance(cat.maint)));
  return { sql: out.join("\n"), plan, comboRows };
}

function maintenanceSql(m) {
  const out = [];
  for (const x of m.notAdded) out.push(`--   not loaded, kept in the workbook: ${x}`);
  // 5a. Products › Maintenance pools: append to the latest 'master' config; one new version only when something is added.
  const values = m.pools.map((p, i) => `(${i + 1}, ${lit(p.pool)}, ${jsonLit(p.priceSen === undefined ? p.value : { value: p.value, priceSen: p.priceSen })}, ${lit(p.value)}, ${lit(!!p.unlessCompartment)})`);
  if (values.length) {
    out.push(`do $maint$
declare
  co bigint := ${CO};
  cfg jsonb; pool jsonb; changed boolean := false; c record;
begin
  select config into cfg from scm.maintenance_config_history
   where company_id = co and scope = 'master' and effective_from <= current_date order by effective_from desc, created_at desc limit 1;
  cfg := coalesce(cfg, '{}'::jsonb);
  for c in select * from (values
    ${values.join(",\n    ")}
  ) v(ord, pool_name, elem, k, unless_compartment) order by ord loop
    if c.unless_compartment and exists (select 1 from scm.compartment_library where company_id = co and ${KEY("label")} = ${KEY("c.k")}) then
      continue;
    end if;
    pool := case when jsonb_typeof(cfg -> c.pool_name) = 'array' then cfg -> c.pool_name else '[]'::jsonb end;
    continue when exists (select 1 from jsonb_array_elements(pool) e(x)
      where ${KEY("case jsonb_typeof(e.x) when 'string' then e.x #>> '{}' else e.x ->> 'value' end")} = ${KEY("c.k")});
    cfg := jsonb_set(cfg, array[c.pool_name], pool || jsonb_build_array(c.elem));
    changed := true;
    raise notice 'Carres master data: maintenance % + %', c.pool_name, c.k;
  end loop;
  if changed then
    insert into scm.maintenance_config_history (id, company_id, scope, config, effective_from, notes)
    values (gen_random_uuid()::text, co, 'master', cfg, current_date, 'Carres master data: Carres-only entries');
  end if;
end $maint$;`);
  }
  // 5b. Sofa specials Houzs's list lacks (Power Incliner / Power Slide: an RM450 Special, owner decision D6).
  for (const s of m.specials) {
    out.push(`insert into scm.special_addons (company_id, code, label, categories, selling_price_sen, cost_price_sen, option_groups, active, sort_order)
select ${CO}, ${lit(s.code)}, ${lit(s.code)}, array['SOFA']::text[], ${lit(s.priceSen)}, 0, '[]'::jsonb, true, 100
where not exists (select 1 from scm.special_addons where company_id = ${CO} and ${KEY("label")} = ${KEY(lit(s.code))})
on conflict (company_id, code) do nothing;${s.perPiece.length > 1 ? `\n-- ${s.code} cost per piece stays in the workbook: ${s.perPiece.join("; ")}` : ""}`);
  }
  // 5c. Fabrics and colours (fabric library; colours are the Fabrics list rows).
  for (const f of m.fabrics) {
    out.push(`insert into scm.fabric_library (id, company_id, label, tier, active, sort_order)
select ${lit(f.code)}, ${CO}, ${lit(f.label)}, 'standard', true, 0
where not exists (select 1 from scm.fabric_library where company_id = ${CO}
  and ${NORM(lit(f.code))} in (${NORM("id")}, ${NORM("label")}, ${NORM("fabric_code")}))
on conflict (id) do nothing;`);
  }
  for (const c of m.colours) {
    out.push(`insert into scm.fabric_trackings (id, company_id, fabric_code, fabric_description, series, is_active)
select ${lit(c.id)}, ${CO}, ${lit(c.code)}, ${lit(c.label)}, ${lit(c.usedBy)}, true
where not exists (select 1 from scm.fabric_trackings where company_id = ${CO} and ${NORM("fabric_code")} = ${NORM(lit(c.code))})
  and not exists (select 1 from scm.fabric_colours where company_id = ${CO} and ${NORM("colour_id")} = ${NORM(lit(c.code))})
on conflict (company_id, id) do nothing;`);
  }
  return out.join("\n");
}

// ── The throwaway local engine schema ────────────────────────────────────────────────────────────────────────────────
async function withSchemaDb(srcUrl, migrationsDir, before, fn) {
  const name = `carres_emit_${process.pid}`;
  const at = (db) => srcUrl.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);
  const admin = connect(at("postgres"));
  if (!admin) throw new Error("the local server connection is not valid");
  await admin.unsafe(`drop database if exists ${name}`);
  await admin.unsafe(`create database ${name}`);
  let db;
  try {
    db = connect(at(name));
    await db.unsafe(`create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
      create extension if not exists "uuid-ossp" schema extensions; create extension if not exists pg_trgm schema public;
      alter database ${name} set search_path = "$user", public, extensions;`);
    await db.end();
    db = connect(at(name));
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql") && f < before).sort();
    for (const f of files) {
      try { await db.begin(async (tx) => { await tx.unsafe(readFileSync(resolve(migrationsDir, f), "utf8")); }); }
      catch (e) { throw new Error(`building the local engine schema stopped at ${f}: ${e.message}`); }
      await db`reset search_path`;
    }
    return await fn(db, files.length);
  } finally {
    await db?.end().catch(() => {});
    await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
    await admin.end();
  }
}

/**
 * Writes the migration. `ctx` carries the loader's own inputs and constants so both modes share one definition:
 * { outFile, src, srcUrl, suppliers, supplierCols, catalog, warehouses, warehouseCols, stateToWarehouse,
 *   testRows: { supplierCode, itemCode, warehouseCode, realName }, sourceFiles: [..] }
 */
export async function emitMasterDataSql(ctx) {
  const outFile = resolve(ctx.outFile);
  const name = basename(outFile);
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) throw new Error(`${name}: a migration file is named NNNN_words.sql`);
  const migrationsDir = dirname(outFile);
  const sections = [];
  const report = {};
  await withSchemaDb(ctx.srcUrl, migrationsDir, name, async (db, built) => {
    report.built = built;
    const [{ id: coId } = {}] = await db`select id from public.companies where code = 'HOUZS'`;
    if (coId == null) throw new Error("the local engine schema has no HOUZS company");
    if (ctx.catalog) {
      const enumCats = new Set((await db`select unnest(enum_range(null::scm.mfg_product_category))::text as c`).map((r) => r.c));
      for (const k of ctx.catalog.skus) if (!enumCats.has(k.category)) throw new Error(`SKU ${k.code}: category ${k.category} is not an engine category`);
      for (const m of ctx.catalog.models) if (!enumCats.has(m.category)) throw new Error(`model ${m.model_code}: category ${m.category} is not an engine category`);
    }
    const houzs = [];
    const ROLLBACK = Symbol("schema only");
    try {
      await db.begin(async (tx) => {
        report.houzs = await copyFromHouzs({ src: ctx.src, tx, tableNames: tablesOfGroups(CARRES_GROUPS), emit: (t) => houzs.push(t) });
        throw ROLLBACK;
      });
    } catch (e) { if (e !== ROLLBACK) throw e; }
    report.coId = coId;

    sections.push(`-- ── guard: the Carres engine company ──────────────────────────────────────────────────────────────────────────
do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres master data: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;`);
    sections.push(`-- ── D · clean-up of the hand-made test rows ──────────────────────────────────────────────────────────────────\n${cleanUpSql(ctx.testRows)}`);
    sections.push(`-- ── A · from Houzs (groups ${CARRES_GROUPS.join(", ")}): ${houzs.reduce((s, t) => s + t.rows.length, 0)} candidate rows, ids kept, never overwritten ──\n${houzs.map(houzsTableSql).join("\n\n")}`);
    const wh = ctx.warehouses.map((w) => upsertByCode("scm.warehouses", { ...w, is_active: true }, ctx.warehouseCols));
    const def = ctx.warehouses.find((w) => w.is_default).code;
    const maps = Object.entries(ctx.stateToWarehouse).map(([state, code]) => `insert into scm.state_warehouse_mappings as m (company_id, state, warehouse_id, notes)
select ${CO}, ${lit(state)}, w.id, 'Carres master data' from scm.warehouses w where w.company_id = ${CO} and w.code = ${lit(code)}
on conflict (company_id, state) do update set warehouse_id = excluded.warehouse_id, updated_at = now()
  where m.warehouse_id is distinct from excluded.warehouse_id;`);
    sections.push(`-- ── C · Carres's warehouses (${ctx.warehouses.map((w) => w.code).join(", ")}), the one default, state → warehouse ──
${wh.join("\n")}
update scm.warehouses set is_default = false, updated_at = now() where company_id = ${CO} and is_default and code <> ${lit(def)};
${maps.join("\n")}`);
    sections.push(`-- ── B · suppliers: Carres's AutoCount creditor list (${ctx.suppliers.length}) ─────────────────────────────────────────────
${ctx.suppliers.map((s) => upsertByCode("scm.suppliers", s, ctx.supplierCols)).join("\n")}`);
    if (ctx.catalog) {
      const supplierCodeOf = new Map(ctx.suppliers.map((s) => [s.code.toUpperCase(), s.code]));
      const e = catalogSql(ctx.catalog, coId, supplierCodeOf);
      report.catalog = { models: ctx.catalog.models.length, skus: ctx.catalog.skus.length, bindings: e.plan.groups.length, combos: e.comboRows };
      sections.push(`-- ── E · Carres's catalogue (owner-reviewed restructure workbook) ─────────────────────────────────────────────────\n${e.sql}`);
    }
  });

  const head = `-- Carres engine database: Carres's master data (owner decision 13 Nov 2026).
--
-- WHY. The loader (scripts/carres-db/load-carres-master-data.mjs) needs the engine connection string pasted into a
-- hidden prompt, which kept failing. This file is the SAME load as a migration: the engine deploy applies it with its
-- own secret (apply.mjs --ci), nobody pastes anything. GENERATED, do not edit by hand: regenerate with
--   node scripts/carres-db/load-carres-master-data.mjs --emit-sql scripts/carres-db/migrations/${name}
-- (and give the new file the next number; an applied migration is never edited).
--
-- WHAT. D removes the hand-made test rows (supplier ${ctx.testRows.supplierCode} unless it is the AutoCount supplier,
-- SKU/model ${ctx.testRows.itemCode}, warehouse ${ctx.testRows.warehouseCode}); it stops if anything else uses them.
-- A copies Houzs's categories, Products › Maintenance and SO Maintenance rows from Houzs's masked local copy (main
-- company only, ids kept): ${report.houzs.reduce((s, r) => s + r[2], 0)} candidate rows, each skipped when the engine already has it (the
-- engine's own migrations already seed most of the localities and dropdowns). C Carres's ${ctx.warehouses.length} warehouses and ${Object.keys(ctx.stateToWarehouse).length} state → warehouse rows.
-- B Carres's ${ctx.suppliers.length} AutoCount suppliers (business contact fields only).${report.catalog ? `
-- E Carres's catalogue: ${report.catalog.models} models, ${report.catalog.skus} SKUs, ${report.catalog.bindings} supplier bindings, ${report.catalog.combos} sofa combo rows, plus the
-- Carres-only maintenance entries Houzs's copy lacks.` : ""} NO Houzs suppliers, SKUs, models, bindings, combos,
-- warehouses, customers or staff. NO selling prices. NO stock: balances are loaded later by the owner.
-- Sources: ${ctx.sourceFiles.map((f) => basename(f)).join(" · ")} · houzs_local (masked).
-- Every company_id is the Carres company found by its code (HOUZS); parents are found by code, never by an id.
--
-- RE-RUN: safe; a second run changes nothing. No row count of the target is asserted.
-- REVERSAL: none automatic (data). Remove rows by hand by their codes if ever needed.
`;
  writeFileSync(outFile, `${head}\n${sections.join("\n\n")}\n`);
  return { outFile, report };
}
