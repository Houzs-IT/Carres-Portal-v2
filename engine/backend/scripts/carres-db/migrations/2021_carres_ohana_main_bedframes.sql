-- 2021 · Carres: Ohana Studio is the main supplier of the Hookka bedframes CODY, JAGER, REGAL (A) and TRION (A)
--        (Chew, Finance owner, 2026-11-19: 「改去ohana」).
--
-- WHY
--   These SKUs were bound to NB Furniture (main, at the old prices) and to Ohana Studio. AutoCount's Purchase Invoice
--   Detail Listing (2 Jan – 28 Sep 2026) has no NB invoice at all: every one of these bedframes was bought from Hookka,
--   and from May 2026 billed by Ohana Studio, at the prices migration 2020 wrote onto the Ohana bindings. With NB as
--   main, a PO defaulted to NB's old price (JAGER King RM320 instead of RM430).
--
-- WHAT
--   For the 14 SKUs below: NB Furniture's binding stops being main and Ohana Studio's becomes main. Both stay bound,
--   so a PO can still pick NB. No price and no SKU cost changes (the SKU cost is already Ohana's, the dearest).
--
-- RE-RUN: safe; a second run changes nothing. No row count is asserted.
-- REVERSAL: set is_main_supplier back to NB Furniture (400-BF03) for these SKUs, Ohana's first set false.

do $guard$
declare missing text;
begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres Ohana main bedframes: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
  select string_agg(x.code, ', ') into missing
    from unnest(array['CODY-(K)','CODY-(Q)','CODY-(S)','CODY-(SS)','JAGER-(K)','JAGER-(Q)','JAGER-(S)','JAGER-(SS)',
                      'REGAL (A)-(K)','REGAL (A)-(Q)','REGAL (A)-(S)','REGAL (A)-(SS)','TRION (A)-(K)','TRION (A)-(Q)']) as x(code)
   where not exists (select 1 from scm.supplier_material_bindings b
                       join scm.suppliers s on s.id = b.supplier_id and s.code = '400-O001'
                       join public.companies c on c.id = b.company_id and c.code = 'HOUZS'
                      where b.material_kind = 'mfg_product' and b.item_code = x.code);
  if missing is not null then
    raise exception 'Carres Ohana main bedframes: no Ohana Studio binding for %; nothing was changed', missing;
  end if;
end $guard$;

create temp table _ohana_main (code text primary key) on commit drop;
insert into _ohana_main values
  ('CODY-(K)'), ('CODY-(Q)'), ('CODY-(S)'), ('CODY-(SS)'), ('JAGER-(K)'), ('JAGER-(Q)'), ('JAGER-(S)'), ('JAGER-(SS)'),
  ('REGAL (A)-(K)'), ('REGAL (A)-(Q)'), ('REGAL (A)-(S)'), ('REGAL (A)-(SS)'), ('TRION (A)-(K)'), ('TRION (A)-(Q)');

-- One main per item: the old main lets go first.
update scm.supplier_material_bindings b
   set is_main_supplier = false, updated_at = now()
  from _ohana_main n, public.companies c, scm.suppliers s
 where c.code = 'HOUZS' and s.company_id = c.id and s.code = '400-O001'
   and b.company_id = c.id and b.material_kind = 'mfg_product' and b.item_code = n.code
   and b.supplier_id <> s.id and b.is_main_supplier;

update scm.supplier_material_bindings b
   set is_main_supplier = true, updated_at = now()
  from _ohana_main n, public.companies c, scm.suppliers s
 where c.code = 'HOUZS' and s.company_id = c.id and s.code = '400-O001'
   and b.company_id = c.id and b.supplier_id = s.id and b.material_kind = 'mfg_product' and b.item_code = n.code
   and not b.is_main_supplier;
