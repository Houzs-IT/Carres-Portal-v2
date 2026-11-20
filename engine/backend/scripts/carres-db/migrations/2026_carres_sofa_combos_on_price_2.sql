-- 2026 · Carres: sofa combo costs move to Price 2, the Carres base price (Chew, Finance owner, 2026-11-20:
--        「还是以price 2」 and 「好，开始改」).
--
-- WHY
--   Price 2 is the Carres base cost; the SKU cost grids already sit there (migration 2022). The combo costs still sit
--   on Price 1, so Sofa Combo Pricing shows them as "No price" on the Price 2 tab, and an order (whose fabric tier is
--   Price 2) finds no combo price: a combo row matches only its own tier (sofa-combo-pricing.ts).
--   5117A 1+2+3 is priced at seat size DEFAULT, while its SKUs moved to 24" (migration 2023).
--   9055 3L 30" carries Armani's 2,860 on the generic row; the main supplier, Dorsettloft, quotes 2,850.
--
-- WHAT
--   1. Every Carres combo on Price 1 moves to Price 2. No number changes. Skipped for a combo that already has a
--      Price 2 row for the same model, label, supplier and customer.
--   2. 5117A combos: seat size DEFAULT becomes 24 (only when 24 is not there yet).
--   3. 9055 3L generic row: 30" becomes 2,850, when it still holds 2,860.
--   Nothing is deleted.
--
-- RE-RUN: safe; a second run finds nothing to change. No row count is asserted.
-- REVERSAL: set tier back to PRICE_1 on the moved rows; rename 24 to DEFAULT on 5117A; set 9055 3L 30" to 286000.

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres sofa combos on Price 2: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;

-- 1. Price 1 → Price 2.
update scm.sofa_combo_pricing k
   set tier = 'PRICE_2', updated_at = now()
  from public.companies c
 where c.code = 'HOUZS' and k.company_id = c.id and k.deleted_at is null and k.tier = 'PRICE_1'
   and not exists (select 1 from scm.sofa_combo_pricing o
                    where o.company_id = k.company_id and o.deleted_at is null and o.tier = 'PRICE_2'
                      and o.base_model = k.base_model and o.label = k.label
                      and o.supplier_id is not distinct from k.supplier_id
                      and o.customer_id is not distinct from k.customer_id);

-- 2. 5117A: seat size DEFAULT → 24.
update scm.sofa_combo_pricing k
   set prices_by_height = (k.prices_by_height - 'DEFAULT') || jsonb_build_object('24', k.prices_by_height->'DEFAULT'),
       updated_at = now()
  from public.companies c
 where c.code = 'HOUZS' and k.company_id = c.id and k.deleted_at is null and k.base_model = '5117A'
   and jsonb_typeof(k.prices_by_height) = 'object'
   and k.prices_by_height ? 'DEFAULT' and not k.prices_by_height ? '24';

-- 3. 9055 3L generic row: 30" = Dorsettloft's 2,850.
update scm.sofa_combo_pricing k
   set prices_by_height = jsonb_set(k.prices_by_height, '{30}', '285000'), updated_at = now()
  from public.companies c
 where c.code = 'HOUZS' and k.company_id = c.id and k.deleted_at is null
   and k.base_model = '9055' and k.label = '3L' and k.supplier_id is null and k.customer_id is null
   and (k.prices_by_height->>'30')::numeric = 286000;
