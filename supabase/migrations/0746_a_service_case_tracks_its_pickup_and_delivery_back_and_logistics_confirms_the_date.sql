-- 0746 — A Service Case tracks its pickup and its delivery back, and Logistics confirms the date.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- Jess was not part of this decision.
-- Follows Houzs:
--   backend/src/db/migrations-pg/0268_assr_pickup_by.sql            (pickup_by)
--   backend/src/db/migrations-pg/20260917T1400_assr_delivery_by.sql (delivery_by)
--   backend/src/db/migrations-pg/0282_assr_sched_dates.sql          (sched_pickup_date, sched_delivery_date)
--   backend/src/db/migrations-pg/20261020T1600_assr_pickup_tracking.sql
--     and backend/src/scm/shared/assr-pickup-tracking.ts            (status, actual date, PIC, item location)
--   commit 002deb115 (26 Oct 2026): the date Service keys is a request; Logistics confirms it.
--
-- Columns on service_cases (all nullable, all additive):
--   pickup_by              'own' (our team collects) | 'supplier' (the supplier collects)
--   pickup_requested_at    the pickup date Service asks for (Houzs customer_pickup_at, "ETA")
--   pickup_confirmed_at    the pickup date Logistics confirmed (Houzs sched_pickup_date)
--   actual_pickup_at       the day it was collected
--   pickup_status          'pending' | 'scheduled' | 'completed'
--   pickup_pic             who collects (free text, at most 120 characters, as Houzs)
--   item_location          'customer' | 'warehouse' | 'supplier'
--   delivery_by            'own' | 'supplier'
--   delivery_requested_at  the delivery-back date Service asks for (Houzs do_date)
--   delivery_confirmed_at  the delivery-back date Logistics confirmed (Houzs sched_delivery_date)
-- Rollback at foot.

alter table public.service_cases
  add column if not exists pickup_by             text,
  add column if not exists pickup_requested_at   date,
  add column if not exists pickup_confirmed_at   date,
  add column if not exists actual_pickup_at      date,
  add column if not exists pickup_status         text,
  add column if not exists pickup_pic            text,
  add column if not exists item_location         text,
  add column if not exists delivery_by           text,
  add column if not exists delivery_requested_at date,
  add column if not exists delivery_confirmed_at date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sc_pickup_by_known') then
    alter table public.service_cases add constraint sc_pickup_by_known
      check (pickup_by is null or pickup_by in ('own', 'supplier'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_delivery_by_known') then
    alter table public.service_cases add constraint sc_delivery_by_known
      check (delivery_by is null or delivery_by in ('own', 'supplier'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_pickup_status_known') then
    alter table public.service_cases add constraint sc_pickup_status_known
      check (pickup_status is null or pickup_status in ('pending', 'scheduled', 'completed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_item_location_known') then
    alter table public.service_cases add constraint sc_item_location_known
      check (item_location is null or item_location in ('customer', 'warehouse', 'supplier'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_pickup_pic_length') then
    alter table public.service_cases add constraint sc_pickup_pic_length
      check (pickup_pic is null or char_length(pickup_pic) <= 120);
  end if;
end $$;

comment on column public.service_cases.pickup_requested_at is
  '0746: the pickup date Service asks for. Logistics confirms it in pickup_confirmed_at (Houzs 002deb115).';
comment on column public.service_cases.delivery_requested_at is
  '0746: the delivery-back date Service asks for. Logistics confirms it in delivery_confirmed_at (Houzs 002deb115).';

-- ROLLBACK (manual):
--   alter table public.service_cases
--     drop constraint if exists sc_pickup_by_known,
--     drop constraint if exists sc_delivery_by_known,
--     drop constraint if exists sc_pickup_status_known,
--     drop constraint if exists sc_item_location_known,
--     drop constraint if exists sc_pickup_pic_length,
--     drop column if exists pickup_by, drop column if exists pickup_requested_at,
--     drop column if exists pickup_confirmed_at, drop column if exists actual_pickup_at,
--     drop column if exists pickup_status, drop column if exists pickup_pic,
--     drop column if exists item_location, drop column if exists delivery_by,
--     drop column if exists delivery_requested_at, drop column if exists delivery_confirmed_at;
