// Carres: a Pending Delivery order (no delivery order yet) can already have its lorry, drivers and helpers chosen on
// Delivery Planning (owner, 16 Nov 2026). Houzs keeps the crew on the DO only, so its board said "Create a delivery
// order first". The choice is kept in scm.carres_so_crew_plan (engine migration 2015); when a DO is opened for the
// order a database trigger moves it onto the DO crew and removes the plan, whichever door opened the DO.
import { Hono } from 'hono';
import type { Env, Variables } from '../scm/env';
import { chunkIn } from '../scm/lib/paginate-all';
import { resolveCrewSeats } from '../scm/lib/crew-seats';
import { latestLiveDoIdForSo, soCompanyWithinGrants } from '../scm/lib/trip-crew-sync';
import type { CrewOut } from '../scm/lib/delivery-board-maps';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the scm PostgREST client, untyped like every route helper
type Sb = any;

type PlanRow = {
  so_doc_no: string; lorry_id: string | null;
  driver_1_id: string | null; driver_2_id: string | null; helper_1_id: string | null; helper_2_id: string | null;
};

const SEAT_KEYS = ['driver1Id', 'driver2Id', 'helper1Id', 'helper2Id', 'lorryId'] as const;

/** The crew planned for each order in docNos, named from the masters, shaped like a DO crew. */
export async function loadSoCrewPlans(sb: Sb, docNos: readonly string[]): Promise<Map<string, CrewOut>> {
  const out = new Map<string, CrewOut>();
  if (!docNos.length) return out;
  const { data: plans, error } = await chunkIn<PlanRow>(docNos, (batch, from, to) => sb.from('carres_so_crew_plan')
    .select('so_doc_no, lorry_id, driver_1_id, driver_2_id, helper_1_id, helper_2_id')
    .in('so_doc_no', batch).order('so_doc_no').range(from, to));
  if (error || !plans.length) return out; // best-effort like the other board reads: no plan shown, nothing breaks
  const ids = (pick: (p: PlanRow) => Array<string | null>) => [...new Set(plans.flatMap(pick).filter((x): x is string => !!x))];
  const driverIds = ids((p) => [p.driver_1_id, p.driver_2_id]);
  const helperIds = ids((p) => [p.helper_1_id, p.helper_2_id]);
  const lorryIds = ids((p) => [p.lorry_id]);
  const [dr, hr, lr] = await Promise.all([
    driverIds.length ? sb.from('drivers').select('id, name, ic_number, phone').in('id', driverIds) : Promise.resolve({ data: [] }),
    helperIds.length ? sb.from('helpers').select('id, name').in('id', helperIds) : Promise.resolve({ data: [] }),
    lorryIds.length ? sb.from('lorries').select('id, plate').in('id', lorryIds) : Promise.resolve({ data: [] }),
  ]);
  const byId = (r: { data?: Array<Record<string, string | null>> | null }) => new Map((r.data ?? []).map((x) => [String(x.id), x]));
  const drv = byId(dr); const hlp = byId(hr); const lor = byId(lr);
  for (const p of plans) {
    const d1 = p.driver_1_id ? drv.get(p.driver_1_id) : undefined;
    const d2 = p.driver_2_id ? drv.get(p.driver_2_id) : undefined;
    const h1 = p.helper_1_id ? hlp.get(p.helper_1_id) : undefined;
    const h2 = p.helper_2_id ? hlp.get(p.helper_2_id) : undefined;
    const plate = (p.lorry_id ? lor.get(p.lorry_id)?.plate : null) ?? null;
    out.set(p.so_doc_no, {
      driver: [d1?.name, d2?.name].filter(Boolean).join(' / ') || null,
      helper: [h1?.name, h2?.name].filter(Boolean).join(' / ') || null,
      lorry: plate,
      driver_1_name: d1?.name ?? null, driver_1_ic: d1?.ic_number ?? null, driver_1_contact: d1?.phone ?? null,
      driver_2_name: d2?.name ?? null,
      helper_1_name: h1?.name ?? null, helper_2_name: h2?.name ?? null,
      lorry_plate: plate,
    });
  }
  return out;
}

export const carresSoCrewPlan = new Hono<{ Bindings: Env; Variables: Variables }>();

/* PUT /delivery-planning/so/:docNo/crew-plan — one or more seats (driver1Id, driver2Id, helper1Id, helper2Id,
   lorryId); a seat the body names is set (null or '' clears it), one it leaves out is kept, as on a DO crew. */
carresSoCrewPlan.put('/so/:docNo/crew-plan', async (c) => {
  const docNo = c.req.param('docNo');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || !SEAT_KEYS.some((k) => k in body)) return c.json({ error: 'no_changes' }, 400);
  const sb = c.get('supabase') as Sb;
  try {
    const companyId = await soCompanyWithinGrants(c, docNo);
    if (companyId == null) return c.json({ error: 'not_found' }, 404);
    if (await latestLiveDoIdForSo(sb, companyId, docNo)) {
      return c.json({ error: 'has_delivery_order', reason: 'This order has a delivery order now. Reload the page and pick the crew again.' }, 409);
    }
    const { data: before, error: bErr } = await sb.from('carres_so_crew_plan')
      .select('driver_1_id, driver_2_id, helper_1_id, helper_2_id, lorry_id').eq('so_doc_no', docNo).maybeSingle();
    if (bErr) throw new Error(bErr.message);
    const s = resolveCrewSeats(body, (before ?? {}) as Record<string, unknown>);
    if (!s.driver1Id && !s.driver2Id && !s.helper1Id && !s.helper2Id && !s.lorryId) {
      const { error } = await sb.from('carres_so_crew_plan').delete().eq('so_doc_no', docNo);
      if (error) throw new Error(error.message);
      return c.json({ ok: true, plan: null });
    }
    const { error } = await sb.from('carres_so_crew_plan').upsert({
      so_doc_no: docNo, company_id: companyId,
      driver_1_id: s.driver1Id, driver_2_id: s.driver2Id, helper_1_id: s.helper1Id, helper_2_id: s.helper2Id, lorry_id: s.lorryId,
      updated_at: new Date().toISOString(), updated_by: (c.get('user') as { id?: string } | null)?.id ?? null,
    }, { onConflict: 'so_doc_no' });
    if (error) throw new Error(error.message);
    return c.json({ ok: true, plan: s });
  } catch (e) {
    return c.json({ error: 'crew_save_failed', reason: String((e as Error).message).slice(0, 200) }, 500);
  }
});
