-- 2025 · Carres: the unused sofa seat sizes 25", 27" and 29" leave the seat-size list (Chew, Finance owner,
--        2026-11-20: 「好，全部改」).
--
-- WHY
--   The master maintenance config's sofaSizes list holds 25", 27" and 29". No Carres sofa SKU, supplier binding or
--   combo carries a price at any of them, yet every list draws a column and every picker offers them: the Products
--   sofa grid showed three empty columns.
--
-- WHAT
--   A new master config version for Carres, effective today: the current one with those three sizes removed from
--   sofaSizes. Everything else in the config is carried over as it is. Earlier versions stay in history. Written the
--   way the Maintenance page saves (a new maintenance_config_history row); nothing is deleted.
--   Skipped when the current version no longer holds any of the three, or when a size is in use by then.
--
-- RE-RUN: safe; a second run finds the sizes already gone. No row count is asserted.
-- REVERSAL: add the three sizes back on Products → Maintenance → Sofa → Sizes (or insert the previous version again).

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres unused sofa sizes: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;

insert into scm.maintenance_config_history (company_id, id, scope, config, effective_from, notes)
select cur.company_id, gen_random_uuid()::text, 'master',
       jsonb_set(cur.config, '{sofaSizes}',
                 coalesce((select jsonb_agg(v order by o)
                             from jsonb_array_elements(cur.config->'sofaSizes') with ordinality a(v, o)
                            where v #>> '{}' not in ('25"', '27"', '29"')), '[]'::jsonb)),
       greatest(current_date, cur.effective_from),
       'Carres: unused seat sizes 25", 27", 29" removed (Chew 2026-11-20)'
  from (select h.company_id, h.config, h.effective_from
          from scm.maintenance_config_history h
          join public.companies c on c.id = h.company_id and c.code = 'HOUZS'
         where h.scope = 'master' and h.effective_from <= current_date
         order by h.effective_from desc, h.created_at desc
         limit 1) cur
 where jsonb_typeof(cur.config->'sofaSizes') = 'array'
   and exists (select 1 from jsonb_array_elements(cur.config->'sofaSizes') v
                where v #>> '{}' in ('25"', '27"', '29"'))
   -- No priced use of the three sizes anywhere in Carres.
   and not exists (select 1 from scm.mfg_products p,
                        jsonb_array_elements(case when jsonb_typeof(p.seat_height_prices) = 'array'
                                                  then p.seat_height_prices else '[]'::jsonb end) e
                    where p.company_id = cur.company_id and e->>'height' in ('25"', '27"', '29"', '25', '27', '29'))
   and not exists (select 1 from scm.supplier_material_bindings b
                    where b.company_id = cur.company_id and jsonb_typeof(b.price_matrix) = 'object'
                      and b.price_matrix ?| array['25"', '27"', '29"', '25', '27', '29']);
