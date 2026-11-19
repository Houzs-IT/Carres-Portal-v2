-- 2022 · Carres: a sofa's cost sits on Price 2, the tier the engine reads as cost (Chew, Finance owner, 2026-11-19:
--        「好，搬过去」).
--
-- WHY
--   The 13 Nov catalogue load put every sofa cost on Price 1. The engine reads a sofa's cost from Price 2, its default
--   tier (derive-product-cost-from-suppliers.ts hasCostTier; mfg-pricing.ts resolveSeatHeightSen falls back to
--   Price 2): a binding with only Price 1 counts as "no cost", so Products showed Gap on SKUs that have a price
--   (Todern 5086 / 5090 / 5117A, Red Sofa 833, Dorsettloft 8017 / 8027, Armani 9015 / 9023 / 9038 2NA).
--   Migration 2020 already wrote the quoted sofas on Price 2; Carres's fabrics carry no grade yet, so one price per
--   seat size is all a sofa has, and it belongs on Price 2.
--
-- WHAT
--   Only SOFA SKUs whose cost is on Price 1 alone, and no number changes:
--     supplier bindings   each seat cell {"P1": x} with no Price 2 in the whole grid becomes {"P2": x}
--     SKU cost grid       each PRICE_1 cost row of a grid with no PRICE_2 cost becomes PRICE_2 (a row moves whole)
--   A grid that already has Price 2 anywhere is left alone. Combos are not touched (the selling side matches combos at
--   PRICE_1 by design, sofa-build.ts).
--
-- RE-RUN: safe; a second run finds nothing on Price 1 alone. No row count is asserted.
-- REVERSAL: the same two updates with P2/PRICE_2 and P1/PRICE_1 swapped, for the SKUs this changed.

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres sofa cost on Price 2: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;

update scm.supplier_material_bindings b
   set price_matrix = (select jsonb_object_agg(e.key, (e.value - 'P1') || jsonb_build_object('P2', e.value->'P1'))
                         from jsonb_each(b.price_matrix) e),
       updated_at = now()
  from scm.mfg_products p, public.companies c
 where c.code = 'HOUZS' and p.company_id = c.id and p.category = 'SOFA'
   and b.company_id = c.id and b.material_kind = 'mfg_product' and b.item_code = p.code
   and jsonb_typeof(b.price_matrix) = 'object'
   and exists (select 1 from jsonb_each(b.price_matrix) e where jsonb_typeof(e.value) = 'object' and e.value ? 'P1')
   and not exists (select 1 from jsonb_each(b.price_matrix) e where jsonb_typeof(e.value) <> 'object' or e.value ? 'P2');

update scm.mfg_products p
   set seat_height_prices = (select jsonb_agg(case when e->>'tier' = 'PRICE_1' and e ? 'priceSen'
                                                   then jsonb_set(e, '{tier}', '"PRICE_2"') else e end
                                              order by o)
                               from jsonb_array_elements(p.seat_height_prices) with ordinality as x(e, o)),
       updated_at = now()
  from public.companies c
 where c.code = 'HOUZS' and p.company_id = c.id and p.category = 'SOFA'
   and jsonb_typeof(p.seat_height_prices) = 'array'
   and exists (select 1 from jsonb_array_elements(p.seat_height_prices) e where e->>'tier' = 'PRICE_1' and e ? 'priceSen')
   and not exists (select 1 from jsonb_array_elements(p.seat_height_prices) e
                    where coalesce(e->>'tier', 'PRICE_2') <> 'PRICE_1' and e ? 'priceSen');
