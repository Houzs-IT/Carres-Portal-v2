-- 2024 · Carres: sofa pieces with no seat size keep their cost on a PO, and Ohana is main on 5531 1A and L
--        (Chew, Finance owner, 2026-11-20: 「可以」 on both).
--
-- WHY
--   A PO prices a sofa line from the supplier binding's seat-size cells. A piece with no seat size (a corner, a
--   console, a DB) carries its price under "DEFAULT", which no PO line names, so the PO falls back to the binding's
--   flat unit price, and that is 0 (po-pricing.ts → mfg-pricing.ts computeMfgLineCost). The PO cost was RM 0.
--   5531 1A and L (left and right) are bound only to Ohana, with no main supplier.
--
-- WHAT
--   833-CNR, 833-CONSOLE, 833-DB (Red Sofa) and 9050-CONSOLE WOODEN (Armani): the binding's flat unit price takes its
--   own DEFAULT Price 2 cell (1026, 470, 810, 480). No number is invented and the cells stay as they are.
--   5531-1A(LHF), 5531-1A(RHF), 5531-L(LHF), 5531-L(RHF): the Ohana binding becomes main, when the SKU has no main.
--   Left for later (Chew): Todern 5086 and 5117A-3S, which wait for Todern's prices.
--
-- RE-RUN: safe; a second run finds nothing to change. No row count is asserted.
-- REVERSAL: set unit_price_sen back to 0 on those four bindings; set is_main_supplier false on the four Ohana ones.

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres sofa no-seat PO cost: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
  if not exists (select 1 from scm.suppliers s join public.companies c on c.id = s.company_id and c.code = 'HOUZS'
                  where s.code = '400-O001') then
    raise exception 'Carres sofa no-seat PO cost: supplier 400-O001 (Ohana) is missing; nothing was changed';
  end if;
end $guard$;

-- 1. A no-seat piece's flat price = its DEFAULT Price 2 cell (only where the flat price is 0 or empty).
update scm.supplier_material_bindings b
   set unit_price_sen = (b.price_matrix->'DEFAULT'->>'P2')::int, updated_at = now()
  from public.companies c
 where c.code = 'HOUZS' and b.company_id = c.id and b.material_kind = 'mfg_product'
   and b.item_code in ('833-CNR', '833-CONSOLE', '833-DB', '9050-CONSOLE WOODEN')
   and jsonb_typeof(b.price_matrix) = 'object'
   and jsonb_typeof(b.price_matrix->'DEFAULT'->'P2') = 'number'
   and coalesce(b.unit_price_sen, 0) = 0;

-- 2. Ohana becomes main on 5531 1A and L, when no supplier is main yet.
update scm.supplier_material_bindings b
   set is_main_supplier = true, updated_at = now()
  from public.companies c, scm.suppliers s
 where c.code = 'HOUZS' and s.company_id = c.id and s.code = '400-O001'
   and b.company_id = c.id and b.supplier_id = s.id and b.material_kind = 'mfg_product'
   and b.item_code in ('5531-1A(LHF)', '5531-1A(RHF)', '5531-L(LHF)', '5531-L(RHF)')
   and not coalesce(b.is_main_supplier, false)
   and not exists (select 1 from scm.supplier_material_bindings o
                    where o.company_id = c.id and o.material_kind = 'mfg_product'
                      and o.item_code = b.item_code and o.is_main_supplier);
