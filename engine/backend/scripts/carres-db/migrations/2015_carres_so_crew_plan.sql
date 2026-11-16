-- Carres engine database: a Sales Order still waiting for its delivery order can already have its lorry, drivers and
-- helpers chosen on Delivery Planning, and they move onto the delivery order when it is opened (owner, 16 Nov 2026:
-- "carres 是 pending delivery 就可以选谁送货了的").
--
-- WHY. Houzs keeps the crew on the delivery order (scm.delivery_order_crew, one row per DO), so the board answered
-- "Create a delivery order first" on every Pending Delivery row. Carres decides who delivers before the DO exists.
--
-- WHAT.
--   1 scm.carres_so_crew_plan: one row per Sales Order with no live DO yet, holding the five seat ids (lorry,
--     driver 1 and 2, helper 1 and 2). Names and plates are read from the masters when shown, so a renamed driver
--     shows the new name. Deleted with its Sales Order.
--   2 When a delivery order is inserted for that Sales Order, a trigger writes the plan onto the DO header
--     (driver_id, driver_name, vehicle) and into scm.delivery_order_crew with the same snapshot columns the
--     Worker's crew write fills (trip-crew-sync.ts writeDoCrewRow), then removes the plan row. Every door that
--     opens a DO gets it, because it lives in the database, not in one route. A DO that already has a crew row
--     keeps it.
--   3 Row level security ON with no policy; anon and authenticated lose their grants. The Worker (scm_engine) is
--     the only reader and writer (scripts/carres-db/engine-owns-all.sql runs after every apply).
--
-- RE-RUN: safe; every statement is "if not exists" or "or replace". No row count is asserted.
-- REVERSAL: drop trigger carres_so_crew_plan_to_do on scm.delivery_orders; drop function
--           scm.carres_so_crew_plan_to_do(); drop table scm.carres_so_crew_plan.

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres crew plan: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;

-- 1 . The plan
create table if not exists scm.carres_so_crew_plan (
  so_doc_no   text primary key references scm.mfg_sales_orders (doc_no) on delete cascade on update cascade,
  company_id  bigint not null,
  lorry_id    uuid,
  driver_1_id uuid,
  driver_2_id uuid,
  helper_1_id uuid,
  helper_2_id uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table scm.carres_so_crew_plan enable row level security;
revoke all on scm.carres_so_crew_plan from public;
do $grants$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on scm.carres_so_crew_plan from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on scm.carres_so_crew_plan from authenticated';
  end if;
end $grants$;

-- 2 . A new delivery order takes the plan
create or replace function scm.carres_so_crew_plan_to_do() returns trigger
language plpgsql security definer set search_path = scm, public as $fn$
declare
  p  scm.carres_so_crew_plan%rowtype;
  d1 record; d2 record; h1 record; h2 record;
  plate text;
begin
  if new.so_doc_no is null or upper(coalesce(new.status, '')) = 'CANCELLED' then
    return null;
  end if;
  select * into p from scm.carres_so_crew_plan where so_doc_no = new.so_doc_no;
  if not found then
    return null;
  end if;
  if not exists (select 1 from scm.delivery_order_crew where do_id = new.id) then
    select name, ic_number, phone, vehicle into d1 from scm.drivers where id = p.driver_1_id;
    select name, ic_number, phone into d2 from scm.drivers where id = p.driver_2_id;
    select name, contact into h1 from scm.helpers where id = p.helper_1_id;
    select name, contact into h2 from scm.helpers where id = p.helper_2_id;
    select l.plate into plate from scm.lorries l where l.id = p.lorry_id;
    insert into scm.delivery_order_crew (
      company_id, do_id, driver_1_id, driver_2_id, helper_1_id, helper_2_id, lorry_id,
      driver_1_name, driver_1_ic, driver_1_contact, driver_2_name, driver_2_ic, driver_2_contact,
      helper_1_name, helper_1_contact, helper_2_name, helper_2_contact, lorry_plate, assigned_by)
    values (
      new.company_id, new.id, p.driver_1_id, p.driver_2_id, p.helper_1_id, p.helper_2_id, p.lorry_id,
      d1.name, d1.ic_number, d1.phone, d2.name, d2.ic_number, d2.phone,
      h1.name, h1.contact, h2.name, h2.contact, plate, p.updated_by);
    update scm.delivery_orders
       set driver_id = p.driver_1_id, driver_name = d1.name, vehicle = coalesce(d1.vehicle, plate)
     where id = new.id;
  end if;
  delete from scm.carres_so_crew_plan where so_doc_no = new.so_doc_no;
  return null;
end $fn$;

revoke all on function scm.carres_so_crew_plan_to_do() from public;

drop trigger if exists carres_so_crew_plan_to_do on scm.delivery_orders;
create trigger carres_so_crew_plan_to_do
  after insert on scm.delivery_orders
  for each row execute function scm.carres_so_crew_plan_to_do();
