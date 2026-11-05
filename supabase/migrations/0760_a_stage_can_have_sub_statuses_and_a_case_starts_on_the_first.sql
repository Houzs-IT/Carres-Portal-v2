-- 0760 — A stage can have sub-statuses, and a case entering the stage starts on the first.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- Jess was not part of this decision.
-- Follows Houzs backend/src/scm/shared/assr-sub-statuses.ts (sub-statuses inside a stage,
-- switched directly by staff; entering a stage seeds the FIRST one; any other stage
-- carries none). Houzs hardcodes the list per stage; Carres stages are config rows,
-- so the sub-statuses are config rows under a stage, edited in Service Settings.
--
--   1. service_case_sub_statuses — label, order and in-use per stage.
--   2. service_cases.sub_status_id.
--   3. A BEFORE trigger: on insert or a stage change it sets the first sub-status in use
--      of the new stage (or none); otherwise it refuses a sub-status of another stage.
-- Additive. Rollback at foot.

-- ── 1 · the list ────────────────────────────────────────────────────────────
create table if not exists public.service_case_sub_statuses (
  id         uuid primary key default gen_random_uuid(),
  status_id  uuid not null references public.service_case_statuses(id) on delete cascade,
  code       text not null unique,
  label      text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists service_case_sub_statuses_status_idx
  on public.service_case_sub_statuses (status_id, sort_order);

alter table public.service_case_sub_statuses enable row level security;
-- Same three policies as the stage list (0210 read + principal write, 0711 Service editor).
drop policy if exists scss_read on public.service_case_sub_statuses;
create policy scss_read on public.service_case_sub_statuses
  for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') in ('operation','principal'));
drop policy if exists scss_principal_write on public.service_case_sub_statuses;
create policy scss_principal_write on public.service_case_sub_statuses
  for all to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'principal')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'principal');
drop policy if exists scss_service_editor_write on public.service_case_sub_statuses;
create policy scss_service_editor_write on public.service_case_sub_statuses
  for all to authenticated
  using ((select public.settings_can_edit('service')))
  with check ((select public.settings_can_edit('service')));

-- ── 2 · the case's sub-status ───────────────────────────────────────────────
alter table public.service_cases
  add column if not exists sub_status_id uuid references public.service_case_sub_statuses(id) on delete set null;

-- ── 3 · seed on stage entry, refuse another stage's ─────────────────────────
create or replace function public.service_case_sub_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
    new.sub_status_id := (
      select ss.id from public.service_case_sub_statuses ss
       where ss.status_id = new.status_id and ss.active
       order by ss.sort_order, ss.created_at
       limit 1
    );
  elsif new.sub_status_id is not null and not exists (
    select 1 from public.service_case_sub_statuses ss
     where ss.id = new.sub_status_id and ss.status_id = new.status_id
  ) then
    raise exception 'This sub-status belongs to another stage.'
      using errcode = '22023', detail = 'sub_status_not_in_stage';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.service_case_sub_status_guard() from public, anon, authenticated;
drop trigger if exists service_case_sub_status_guard on public.service_cases;
create trigger service_case_sub_status_guard
  before insert or update of status_id, sub_status_id on public.service_cases
  for each row execute function public.service_case_sub_status_guard();

-- ROLLBACK (manual):
--   drop trigger if exists service_case_sub_status_guard on public.service_cases;
--   drop function if exists public.service_case_sub_status_guard();
--   alter table public.service_cases drop column if exists sub_status_id;
--   drop table if exists public.service_case_sub_statuses;
