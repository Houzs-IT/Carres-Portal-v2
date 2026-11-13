// Carres's own catalogue for load-carres-master-data.mjs: product models, SKUs, supplier bindings, sofa combos and
// the Carres-only maintenance entries, read from the owner-reviewed restructure workbook
// (Carres-SKU-Restructure-Review.xlsx, approved 13 Nov 2026) and written in the SAME shape the engine's own screens
// write them (mfg-products batch import + ensureModelForSku, suppliers binding form, sofa combos, Products ›
// Maintenance). Every write goes through the caller's transaction; re-runs change nothing.
//
// WORKBOOK SHEETS READ (header row 1):
//   Models             model code · model name · category                                → scm.product_models
//   SKUs               code · name · category (engine enum) · base_model · size · size_label · branding · status
//                      · cost · main supplier code                                        → scm.mfg_products
//   Supplier bindings  supplier code · internal_code · supplier_sku · category (sofa | bedframe | other) · height
//                      · tier · price_rm · lead_time_days · moq · is_main_supplier       → scm.supplier_material_bindings
//   Combos             base model · modules · seat size · set cost · Carres label(s)      → scm.sofa_combo_pricing
//   Maintenance        type · code · label · surcharge / value (RM) · used by            → Carres-only maintenance
//
// SHAPES (copied from Houzs's own rows, houzs_local, 13 Nov 2026):
//   sofa binding      price_matrix {"<seat>": {"P1": sen}}, unit_price_sen 0; the SKU's seat_height_prices is the
//                     main supplier's grid as [{tier: "PRICE_1", height, priceSen}] (the engine's derived cost grid)
//   bedframe binding  price_matrix {"P1": sen}, unit_price_sen = that price
//   other binding     unit_price_sen = price, no price_matrix
//   combo             one row per (model, set of modules): modules [[alternatives], ...], prices_by_height
//                     {"<seat>": sen}, for the model's main supplier AND the company row (supplier_id null, the
//                     engine's "auto-derived cost (max supplier)" row the Sales Order matches). Wooden Arm variants
//                     fold onto the plain combo (the arm is a Special on the SO line, workbook decision); the same
//                     pieces in another order are the same combo.
// No selling prices are loaded (owner: none yet). Stock balances are never loaded.
import { createHash, randomUUID } from "node:crypto";

const s = (v) => { if (v == null) return null; const t = String(v).trim(); return t === "" ? null : t; };
const num = (v) => { const t = s(v); if (t == null) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const sen = (rm) => (rm == null ? null : Math.round(rm * 100));
const norm = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const key = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** A stable uuid from text, so a re-run finds the row it wrote. */
const stableUuid = (text) => {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const tierName = (t) => { const m = /^P([1-4])$/i.exec(s(t) ?? ""); return m ? `PRICE_${m[1]}` : null; };

export function readCatalog(file, XLSX, readFileSync) {
  const wb = XLSX.read(readFileSync(file));
  const sheet = (name, need) => {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`${file}: sheet "${name}" is missing`);
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const have = new Set(Object.keys(rows[0] ?? {}).map((h) => h.trim()));
    const missing = need.filter((h) => !have.has(h));
    if (missing.length) throw new Error(`${file}: sheet "${name}" lacks column(s) ${missing.join(", ")}`);
    // Header names trimmed ("category " → "category"): the SKUs sheet carries both the review columns and the
    // engine import columns, and the import ones are the ones written.
    return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim() === k ? k : `${k.trim()}#import`, v])));
  };
  const models = sheet("Models", ["model code", "model name", "category"]).map((r) => ({
    model_code: s(r["model code"]), name: s(r["model name"]), category: s(r.category), main_supplier: s(r["main supplier code"]),
  })).filter((m) => m.model_code);
  const skus = sheet("SKUs", ["code", "name", "category", "base_model", "size", "size_label", "branding", "status", "cost", "main supplier code"]).map((r) => ({
    code: s(r.code), name: s(r.name), category: s(r.category), description: s(r["description#import"]),
    base_model: s(r.base_model), size_code: s(r.size), size_label: s(r.size_label), branding: s(r.branding),
    status: (s(r.status) ?? "ACTIVE").toUpperCase(), cost: num(r.cost), main_supplier: s(r["main supplier code"]),
  })).filter((k) => k.code);
  const bindings = sheet("Supplier bindings", ["supplier code", "internal_code", "supplier_sku", "category", "height", "tier", "price_rm", "lead_time_days", "moq", "is_main_supplier"]).map((r) => ({
    supplier: s(r["supplier code"]), item: s(r.internal_code), supplier_sku: s(r.supplier_sku), kind: s(r.category) ?? "other",
    height: s(r.height), tier: s(r.tier), price: num(r.price_rm), lead: num(r.lead_time_days) ?? 0, moq: num(r.moq) ?? 0,
    main: String(r.is_main_supplier).toLowerCase() === "true",
  })).filter((b) => b.item);
  const combos = sheet("Combos", ["base model", "modules", "seat size", "set cost", "Carres label(s)"]).map((r) => ({
    model: s(r["base model"]), modules: s(r.modules), seat: s(r["seat size"]), cost: num(r["set cost"]), label: s(r["Carres label(s)"]),
  })).filter((c) => c.model && c.modules);
  const maint = sheet("Maintenance", ["type", "code", "label", "surcharge / value (RM)", "used by"]).map((r) => ({
    type: s(r.type), code: s(r.code), label: s(r.label), value: s(r["surcharge / value (RM)"]), usedBy: s(r["used by"]), certainty: s(r.certainty),
  })).filter((m) => m.type && m.code);
  return { models, skus, bindings, combos, maint };
}

const tally = () => ({ inserted: 0, updated: 0, unchanged: 0 });
const outcome = (rows) => (rows.length === 0 ? "unchanged" : rows[0].inserted ? "inserted" : "updated");

/** "2A(LHF|RHF) + 1NA" → [["2A(LHF)","2A(RHF)"],["1NA"]]; "+Wooden Arm" is a Special, not a module. */
export function parseModules(text) {
  const wooden = /\+\s*Wooden Arm/i.test(text);
  const slots = text.replace(/\s*\+\s*Wooden Arm/gi, "").split(/\s*\+\s*/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = /^(.*)\(([^()]*\|[^()]*)\)$/.exec(p);
    return m ? m[2].split("|").map((side) => `${m[1]}(${side.trim()})`) : [p];
  });
  return { slots, wooden };
}

export async function loadCatalog(tx, co, cat) {
  const out = { models: tally(), skus: tally(), bindings: tally(), combos: tally(), comboRows: cat.combos.length, comboGroups: 0,
    noSupplier: [], missingSupplier: new Map(), added: [], notAdded: [], problems: [] };

  // Engine category list (enum): a SKU category not in it stops the run.
  const enumCats = new Set((await tx`select unnest(enum_range(null::scm.mfg_product_category))::text as c`).map((r) => r.c));
  for (const k of cat.skus) if (!enumCats.has(k.category)) throw new Error(`SKU ${k.code}: category ${k.category} is not an engine category`);
  for (const m of cat.models) if (!enumCats.has(m.category)) throw new Error(`model ${m.model_code}: category ${m.category} is not an engine category`);
  out.categories = [...new Set(cat.skus.map((k) => k.category))];

  const supplierId = new Map((await tx`select id, code from scm.suppliers where company_id = ${co}`).map((r) => [r.code.toUpperCase(), r.id]));

  // 1. Models (ensureModelForSku's shape: allowed_options {}, active, no branding / photo).
  for (const m of cat.models) {
    const r = await tx`
      insert into scm.product_models as t (company_id, model_code, name, category, allowed_options, active)
      values (${co}, ${m.model_code}, ${m.name ?? m.model_code}, ${m.category}, '{}'::jsonb, true)
      on conflict (company_id, model_code, category) do update set name = excluded.name, active = true, updated_at = now()
        where t.name is distinct from excluded.name or not t.active
      returning (xmax = 0) as inserted`;
    out.models[outcome(r)]++;
  }
  const modelId = new Map((await tx`select id, model_code, category from scm.product_models where company_id = ${co}`).map((r) => [`${r.model_code}|${r.category}`, r.id]));

  // 2. Bindings grouped per (supplier, item): one engine binding each.
  const groups = new Map();
  for (const b of cat.bindings) {
    if (!b.supplier) { out.noSupplier.push(b.item); continue; }
    const sid = supplierId.get(b.supplier.toUpperCase());
    if (!sid) { if (!out.missingSupplier.has(b.supplier)) out.missingSupplier.set(b.supplier, new Set()); out.missingSupplier.get(b.supplier).add(b.item); continue; }
    const g = groups.get(`${sid}|${b.item}`) ?? { sid, item: b.item, kind: b.kind, skus: new Set(), main: false, lead: b.lead, moq: b.moq, rows: [] };
    if (b.supplier_sku) for (const x of b.supplier_sku.split(/;\s*/)) g.skus.add(x);
    g.main ||= b.main; g.rows.push(b); groups.set(`${sid}|${b.item}`, g);
  }
  const shape = (g) => {
    if (g.kind === "sofa") {
      const pm = {};
      for (const r of g.rows) { const h = r.height ?? "DEFAULT"; const t = (r.tier ?? "P2").toUpperCase(); (pm[h] ??= {})[t] = sen(r.price); }
      return { unit: 0, matrix: pm };
    }
    if (g.kind === "bedframe") {
      const pm = {};
      for (const r of g.rows) pm[(r.tier ?? "P2").toUpperCase()] = sen(r.price);
      const first = Object.keys(pm).sort()[0];
      return { unit: pm[first] ?? 0, matrix: pm };
    }
    return { unit: sen(g.rows[0].price) ?? 0, matrix: null };
  };
  // The SKU's seat grid = its main supplier's sofa grid.
  const seatGrid = new Map();
  for (const g of groups.values()) {
    if (g.kind !== "sofa" || !g.main) continue;
    const grid = [];
    for (const [h, tiers] of Object.entries(shape(g).matrix)) for (const [t, p] of Object.entries(tiers)) { const tn = tierName(t); if (tn && p != null) grid.push({ tier: tn, height: h, priceSen: p }); }
    grid.sort((a, b) => (a.height + a.tier).localeCompare(b.height + b.tier, undefined, { numeric: true }));
    seatGrid.set(g.item, grid);
  }

  // 3. SKUs (batch-import shape; the cost goes in cost_price_sen like the New SKU form).
  const skuName = new Map();
  for (const k of cat.skus) {
    const mid = modelId.get(`${k.base_model ?? k.code}|${k.category}`);
    if (!mid) throw new Error(`SKU ${k.code}: no model ${k.base_model ?? k.code} (${k.category})`);
    const grid = seatGrid.get(k.code) ?? null;
    skuName.set(k.code, k.name);
    const id = `mfg-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const r = await tx`
      insert into scm.mfg_products as t (id, company_id, code, name, category, description, base_model, size_code, size_label,
        branding, status, cost_price_sen, seat_height_prices, model_id, pos_active)
      values (${id}, ${co}, ${k.code}, ${k.name}, ${k.category}::scm.mfg_product_category, ${k.description}, ${k.base_model},
        ${k.size_code}, ${k.size_label}, ${k.branding}, ${k.status}::scm.mfg_product_status, ${sen(k.cost) ?? 0},
        ${grid ? JSON.stringify(grid) : null}::text::jsonb, ${mid}, true)
      on conflict (company_id, code) do update set name = excluded.name, category = excluded.category,
        description = excluded.description, base_model = excluded.base_model, size_code = excluded.size_code,
        size_label = excluded.size_label, branding = excluded.branding, status = excluded.status,
        cost_price_sen = excluded.cost_price_sen, seat_height_prices = excluded.seat_height_prices, model_id = excluded.model_id,
        updated_at = now()
      where (t.name, t.category, t.description, t.base_model, t.size_code, t.size_label, t.branding, t.status, t.cost_price_sen,
             t.seat_height_prices, t.model_id)
        is distinct from (excluded.name, excluded.category, excluded.description, excluded.base_model, excluded.size_code,
             excluded.size_label, excluded.branding, excluded.status, excluded.cost_price_sen, excluded.seat_height_prices, excluded.model_id)
      returning (xmax = 0) as inserted`;
    out.skus[outcome(r)]++;
  }

  // 4. Bindings.
  for (const g of groups.values()) {
    const { unit, matrix } = shape(g);
    const r = await tx`
      insert into scm.supplier_material_bindings as t (company_id, supplier_id, material_kind, item_code, material_name, supplier_sku,
        unit_price_sen, currency, lead_time_days, moq, is_main_supplier, price_matrix)
      values (${co}, ${g.sid}, 'mfg_product', ${g.item}, ${skuName.get(g.item) ?? g.item}, ${[...g.skus].join("; ")},
        ${unit}, 'MYR', ${g.lead}, ${g.moq}, ${g.main}, ${matrix ? JSON.stringify(matrix) : null}::text::jsonb)
      on conflict (company_id, supplier_id, material_kind, item_code) do update set material_name = excluded.material_name,
        supplier_sku = excluded.supplier_sku, unit_price_sen = excluded.unit_price_sen, lead_time_days = excluded.lead_time_days,
        moq = excluded.moq, is_main_supplier = excluded.is_main_supplier, price_matrix = excluded.price_matrix, updated_at = now()
      where (t.material_name, t.supplier_sku, t.unit_price_sen, t.lead_time_days, t.moq, t.is_main_supplier, t.price_matrix)
        is distinct from (excluded.material_name, excluded.supplier_sku, excluded.unit_price_sen, excluded.lead_time_days,
             excluded.moq, excluded.is_main_supplier, excluded.price_matrix)
      returning (xmax = 0) as inserted`;
    out.bindings[outcome(r)]++;
  }

  // 5. Combos: one per (model, set of modules), prices per seat size; plain cost wins over a Wooden Arm variant.
  const mainSupplierOf = new Map(cat.models.map((m) => [m.model_code, m.main_supplier]));
  const tierOfModel = new Map();
  for (const g of groups.values()) {
    if (g.kind !== "sofa" || !g.main) continue;
    const model = cat.skus.find((k) => k.code === g.item)?.base_model;
    for (const r of g.rows) if (model && r.tier && !tierOfModel.has(model)) tierOfModel.set(model, tierName(r.tier));
  }
  const combos = new Map();
  for (const c of cat.combos) {
    const { slots, wooden } = parseModules(c.modules);
    const mk = slots.map((alts) => [...alts].sort().join("|")).sort().join(" + ");
    const g = combos.get(`${c.model}|${mk}`) ?? { model: c.model, slots: slots.map((a) => [...a]).sort((a, b) => a.join().localeCompare(b.join())), prices: {}, plain: {}, labels: new Set() };
    if (c.label) g.labels.add(c.label);
    const seat = c.seat ?? "DEFAULT";
    if (!(seat in g.prices) || (!wooden && !g.plain[seat])) { g.prices[seat] = sen(c.cost); if (!wooden) g.plain[seat] = true; }
    combos.set(`${c.model}|${mk}`, g);
  }
  out.comboGroups = combos.size;
  for (const g of combos.values()) {
    const sup = mainSupplierOf.get(g.model);
    const sid = sup ? supplierId.get(sup.toUpperCase()) ?? null : null;
    const tier = tierOfModel.get(g.model) ?? "PRICE_2";
    const label = [...g.labels].join(" / ").slice(0, 200) || null;
    // The supplier's own row (when the supplier is known) and the company row the Sales Order matches.
    const rows = sid ? [[sid, null], [null, "auto-derived cost (max supplier)"]] : [[null, "auto-derived cost (max supplier)"]];
    for (const [rowSid, note] of rows) {
      const id = stableUuid(`carres-combo|${co}|${g.model}|${JSON.stringify(g.slots)}|${rowSid ? "supplier" : "company"}`);
      const r = await tx`
        insert into scm.sofa_combo_pricing as t (id, company_id, base_model, modules, tier, supplier_id, prices_by_height,
          selling_prices_by_height, pwp_prices_by_height, default_free_gifts, label, effective_from, notes)
        values (${id}, ${co}, ${g.model}, ${JSON.stringify(g.slots)}::text::jsonb, ${tier}::scm.fabric_price_tier, ${rowSid},
          ${JSON.stringify(g.prices)}::text::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, ${label}, current_date, ${note})
        on conflict (id) do update set modules = excluded.modules, tier = excluded.tier, supplier_id = excluded.supplier_id,
          prices_by_height = excluded.prices_by_height, label = excluded.label, updated_at = now()
        where (t.modules, t.tier, t.supplier_id, t.prices_by_height, t.label)
          is distinct from (excluded.modules, excluded.tier, excluded.supplier_id, excluded.prices_by_height, excluded.label)
        returning (xmax = 0) as inserted`;
      out.combos[outcome(r)]++;
    }
  }

  // 6. Carres-only maintenance: only what Houzs's copied maintenance does not already have.
  await addMaintenance(tx, co, cat.maint, out);
  return out;
}

async function addMaintenance(tx, co, maint, out) {
  const byType = (t) => maint.filter((m) => m.type === t);
  // 6a. Products › Maintenance pools (the latest 'master' config; a new version only when something is added).
  const [latest] = await tx`select id, config, effective_from from scm.maintenance_config_history
    where company_id = ${co} and scope = 'master' and effective_from <= current_date order by effective_from desc, created_at desc limit 1`;
  const config = structuredClone(latest?.config ?? {});
  let changed = false;
  const library = new Set((await tx`select label from scm.compartment_library where company_id = ${co}`).map((r) => key(r.label)));
  const addString = (pool, value, why) => {
    const list = (config[pool] ??= []);
    if (list.some((x) => key(typeof x === "string" ? x : x?.value) === key(value))) return;
    list.push(value); changed = true; out.added.push(`${pool}: ${value}${why ? ` (${why})` : ""}`);
  };
  const addPriced = (pool, value, priceSen, why) => {
    const list = (config[pool] ??= []);
    if (list.some((x) => key(typeof x === "string" ? x : x?.value) === key(value))) return;
    list.push({ value, priceSen }); changed = true; out.added.push(`${pool}: ${value}${why ? ` (${why})` : ""}`);
  };
  for (const m of byType("Sofa compartment")) { if (!library.has(key(m.code))) addString("sofaCompartments", m.code, m.certainty === "GUESS" ? "guess" : ""); }
  for (const m of byType("Sofa seat size")) addString("sofaSizes", m.code);
  for (const m of byType("Bedframe divan height")) addPriced("divanHeights", m.code, 0);
  for (const m of byType("Bedframe gap")) addString("gaps", m.code);
  for (const m of byType("Bedframe leg height")) {
    if (/^\d+(\.\d+)?"$/.test(m.code)) addPriced("legHeights", m.code, 0);
    else out.notAdded.push(`leg height "${m.code}" (${m.label}): not one value; sofa leg is chosen on the SO line`);
  }
  for (const m of byType("Bedframe special")) addPriced("specials", m.code, sen(num(m.value)) ?? 0, m.certainty === "GUESS" ? "guess" : "");
  for (const m of byType("Bed size")) addString("bedframeSizes", m.code);
  for (const m of byType("Bedframe total height")) out.notAdded.push(`total height ${m.code} (${m.label}): headboard height, not the engine's Total Height measure - confirm first`);
  for (const m of byType("Bedframe divan height surcharge")) out.notAdded.push(`divan ${m.code} on ${m.usedBy}: +RM${m.value} supplier cost, kept in the workbook (no per-SKU divan cost field)`);
  if (changed) {
    await tx`insert into scm.maintenance_config_history (id, company_id, scope, config, effective_from, notes)
      values (${randomUUID()}, ${co}, 'master', ${JSON.stringify(config)}::text::jsonb, current_date, 'Carres master data: Carres-only entries')`;
  }

  // 6b. Sofa specials (special_addons, the Specials list): a special Houzs's list lacks.
  const specials = new Set((await tx`select label from scm.special_addons where company_id = ${co}`).map((r) => key(r.label)));
  const seenSpecial = new Set();
  for (const m of byType("Sofa special surcharge")) {
    if (seenSpecial.has(key(m.code))) continue; seenSpecial.add(key(m.code));
    if (specials.has(key(m.code))) {
      const per = byType("Sofa special surcharge").filter((x) => key(x.code) === key(m.code)).map((x) => `${x.label} +RM${x.value}`);
      if (per.length > 1) out.notAdded.push(`${m.code} cost per piece (${per.join("; ")}): the special exists; per-piece cost stays in the workbook`);
      continue;
    }
    // Power Incliner / Power Slide: sold as an RM450 Special (owner decision D6).
    const price = sen(num(m.value));
    await tx`insert into scm.special_addons (company_id, code, label, categories, selling_price_sen, cost_price_sen, option_groups, active, sort_order)
      values (${co}, ${m.code}, ${m.code}, ${["SOFA"]}, ${price}, 0, '[]'::jsonb, true, 100)
      on conflict (company_id, code) do nothing`;
    out.added.push(`special_addons: ${m.code} (Sofa, RM${m.value})`);
  }

  // 6c. Fabrics and colours (fabric library; colours are the Fabrics list rows).
  const fabrics = new Set((await tx`select id, label, fabric_code from scm.fabric_library where company_id = ${co}`).flatMap((r) => [norm(r.id), norm(r.label), norm(r.fabric_code)]).filter(Boolean));
  for (const m of byType("Fabric")) {
    if (fabrics.has(norm(m.code))) continue;
    await tx`insert into scm.fabric_library (id, company_id, label, tier, active, sort_order) values (${m.code}, ${co}, ${m.label ?? m.code}, 'standard', true, 0) on conflict (id) do nothing`;
    fabrics.add(norm(m.code)); out.added.push(`fabric_library: ${m.code}`);
  }
  const colours = new Set([
    ...(await tx`select fabric_code from scm.fabric_trackings where company_id = ${co}`).map((r) => norm(r.fabric_code)),
    ...(await tx`select colour_id from scm.fabric_colours where company_id = ${co}`).map((r) => norm(r.colour_id)),
  ]);
  for (const m of byType("Fabric colour")) {
    if (colours.has(norm(m.code))) continue;
    const id = (m.label ?? m.code).replace(/\s+/g, "_");
    await tx`insert into scm.fabric_trackings (id, company_id, fabric_code, fabric_description, series, is_active)
      values (${id}, ${co}, ${m.code}, ${m.label ?? m.code}, ${m.usedBy}, true) on conflict (company_id, id) do nothing`;
    colours.add(norm(m.code)); out.added.push(`fabric colour: ${m.label ?? m.code}`);
  }
}
