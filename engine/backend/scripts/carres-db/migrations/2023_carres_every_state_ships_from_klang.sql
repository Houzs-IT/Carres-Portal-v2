-- 2023 · Carres: every Malaysian state ships from KLG-WH01 (Hub CARRES-0005, operation@carres.com, 2026-11-19:
--        "Carres allow to delivery whole malaysia").
--
-- WHY
--   A new Sales Order takes its Sales Location from the delivery State through scm.state_warehouse_mappings, and the
--   save is refused when the State has no row (so-location-gate.ts so_state_unmapped). Step 2008 mapped only
--   Selangor, Kuala Lumpur and Putrajaya to KLG-WH01, so an order to Kedah or any other state could not be created.
--
-- WHAT
--   One row per Malaysian state and federal territory, spelled as scm.my_localities spells them (the list the
--   address picker offers), pointing at KLG-WH01. A state that already has a row, under any letter case, keeps it:
--   an administrator's choice on Sales Orders > Maintenance is never overwritten.
--
-- RE-RUN: safe; a second run finds every state mapped. No row count is asserted.
-- REVERSAL: delete from scm.state_warehouse_mappings where notes = 'CARRES-0005: Carres delivers to all Malaysia';

do $guard$ begin
  if not exists (
    select 1 from scm.warehouses w join public.companies c on c.id = w.company_id
     where c.code = 'HOUZS' and w.code = 'KLG-WH01'
  ) then
    raise exception 'Carres every state ships from Klang: warehouse KLG-WH01 of company HOUZS is missing; nothing was changed';
  end if;
end $guard$;

insert into scm.state_warehouse_mappings (company_id, state, warehouse_id, notes)
select c.id, s.state, w.id, 'CARRES-0005: Carres delivers to all Malaysia'
  from public.companies c
  join scm.warehouses w on w.company_id = c.id and w.code = 'KLG-WH01'
 cross join (values
   ('Johor'), ('Kedah'), ('Kelantan'), ('Kuala Lumpur'), ('Labuan'), ('Melaka'), ('Negeri Sembilan'), ('Pahang'),
   ('Perak'), ('Perlis'), ('Pulau Pinang'), ('Putrajaya'), ('Sabah'), ('Sarawak'), ('Selangor'), ('Terengganu')
 ) as s(state)
 where c.code = 'HOUZS'
   and not exists (
     select 1 from scm.state_warehouse_mappings m
      where m.company_id = c.id and upper(btrim(m.state)) = upper(s.state)
   )
on conflict (company_id, state) do nothing;
