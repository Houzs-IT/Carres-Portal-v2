-- 2023 · Carres: Todern sofa costs for 5117A (1S, 2S) and 5119 2S (Chew, Finance owner, 2026-11-20:
--        「没有，先补其他的」).
--
-- WHY
--   Todern's price list for Carres (09/12/2025) prices SF5117A at 24" (1S 736, 2S 1056, 3S 1408) and SF5119 at
--   24" (1S 1035, 2S 1485, 3S 1980) and 30" (1S 1081, 2S 1551, 3S 2068). The February 2026 purchase invoice bought
--   TH5119 2S at 1551, the 30" price.
--   5117A 1S and 2S hold the right prices under seat size "DEFAULT"; a PO looks the cost up by seat size, so the
--   cost belongs under 24". 5119 2S has no supplier and no cost at all.
--
-- WHAT
--   5117A-1S, 5117A-2S   Todern binding and SKU cost grid: seat size DEFAULT becomes 24. No number changes.
--   5119-2S              a Todern binding (main; the SKU has no supplier) at 24" 1485 and 30" 1551 on Price 2,
--                        the SKU cost grid the same, and SKU cost 1485 (the smallest seat size, as on other sofas).
--   Held back by Chew until checked: 5117A-3S (an invoice shows 1508 against the quoted 1408) and 8060 stool.
--   Nothing is deleted. No new SKU is made.
--
-- RE-RUN: safe; a second run writes the same values. No row count is asserted.
-- REVERSAL: rename seat size 24 back to DEFAULT on the two 5117A SKUs; delete the Todern 5119-2S binding and clear
--           its SKU cost grid and cost.

do $guard$
declare missing text;
begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres Todern 5117A/5119 costs: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
  select string_agg(x, ', ') into missing from (
    select 'supplier 400-0002' as x
     where not exists (select 1 from scm.suppliers s join public.companies c on c.id = s.company_id and c.code = 'HOUZS'
                        where s.code = '400-0002')
    union all
    select 'SKU ' || k from unnest(array['5117A-1S', '5117A-2S', '5119-2S']) k
     where not exists (select 1 from scm.mfg_products p join public.companies c on c.id = p.company_id and c.code = 'HOUZS'
                        where p.code = k)
  ) m;
  if missing is not null then
    raise exception 'Carres Todern 5117A/5119 costs: not on file: %; nothing was changed', missing;
  end if;
end $guard$;

-- 1. 5117A 1S and 2S: the Todern binding's DEFAULT seat cell moves to 24 (only when 24 is not already there).
update scm.supplier_material_bindings b
   set price_matrix = (b.price_matrix - 'DEFAULT') || jsonb_build_object('24', b.price_matrix->'DEFAULT'),
       updated_at = now()
  from public.companies c, scm.suppliers s
 where c.code = 'HOUZS' and s.company_id = c.id and s.code = '400-0002'
   and b.company_id = c.id and b.supplier_id = s.id and b.material_kind = 'mfg_product'
   and b.item_code in ('5117A-1S', '5117A-2S')
   and jsonb_typeof(b.price_matrix) = 'object' and b.price_matrix ? 'DEFAULT' and not b.price_matrix ? '24';

-- 2. 5117A 1S and 2S: the SKU cost grid's DEFAULT rows become 24.
update scm.mfg_products p
   set seat_height_prices = (select jsonb_agg(case when e->>'height' = 'DEFAULT'
                                                   then jsonb_set(e, '{height}', '"24"') else e end)
                               from jsonb_array_elements(p.seat_height_prices) e),
       updated_at = now()
  from public.companies c
 where c.code = 'HOUZS' and p.company_id = c.id and p.code in ('5117A-1S', '5117A-2S')
   and jsonb_typeof(p.seat_height_prices) = 'array'
   and exists (select 1 from jsonb_array_elements(p.seat_height_prices) e where e->>'height' = 'DEFAULT')
   and not exists (select 1 from jsonb_array_elements(p.seat_height_prices) e where e->>'height' = '24');

-- 3. 5119 2S: the Todern binding at the quoted prices (main when the SKU has no main yet).
update scm.supplier_material_bindings b
   set price_matrix = '{"24": {"P2": 148500}, "30": {"P2": 155100}}'::jsonb, updated_at = now()
  from public.companies c, scm.suppliers s
 where c.code = 'HOUZS' and s.company_id = c.id and s.code = '400-0002'
   and b.company_id = c.id and b.supplier_id = s.id and b.material_kind = 'mfg_product' and b.item_code = '5119-2S'
   and b.price_matrix is distinct from '{"24": {"P2": 148500}, "30": {"P2": 155100}}'::jsonb;

insert into scm.supplier_material_bindings
       (company_id, supplier_id, material_kind, item_code, material_name, supplier_sku, unit_price_sen, price_matrix,
        is_main_supplier)
select c.id, s.id, 'mfg_product', p.code, p.name, p.code, 0, '{"24": {"P2": 148500}, "30": {"P2": 155100}}'::jsonb,
       not exists (select 1 from scm.supplier_material_bindings o
                    where o.company_id = c.id and o.material_kind = 'mfg_product'
                      and o.item_code = p.code and o.is_main_supplier)
  from public.companies c
  join scm.suppliers s on s.company_id = c.id and s.code = '400-0002'
  join scm.mfg_products p on p.company_id = c.id and p.code = '5119-2S'
 where c.code = 'HOUZS'
   and not exists (select 1 from scm.supplier_material_bindings b
                    where b.company_id = c.id and b.supplier_id = s.id and b.material_kind = 'mfg_product'
                      and b.item_code = p.code);

-- 4. 5119 2S: the SKU cost grid and cost; a retail price stored on the old grid is kept.
update scm.mfg_products p
   set cost_price_sen = 148500,
       seat_height_prices = '[{"tier": "PRICE_2", "height": "24", "priceSen": 148500},
                              {"tier": "PRICE_2", "height": "30", "priceSen": 155100}]'::jsonb
         || coalesce((select jsonb_agg(e - 'priceSen')
                        from jsonb_array_elements(case when jsonb_typeof(p.seat_height_prices) = 'array'
                                                       then p.seat_height_prices else '[]'::jsonb end) e
                       where e ? 'sellingPriceSen'), '[]'::jsonb),
       updated_at = now()
  from public.companies c
 where c.code = 'HOUZS' and p.company_id = c.id and p.code = '5119-2S';
