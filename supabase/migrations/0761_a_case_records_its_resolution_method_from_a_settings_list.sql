-- 0761 — A case records its resolution method, picked from a Service Settings list.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- Jess was not part of this decision.
-- Follows Houzs backend/src/db/migrations/065_assr_lookups.sql (admin-editable resolution
-- methods; a method taken out of use stays on the cases that have it) and the labels Houzs
-- shows today, frontend/src/components/StatusDot.tsx:98-104.
-- Not ported from 065: issue categories and priorities (in Carres the issue type decides the
-- evidence a case needs and sets the priority, so both stay fixed lists), and NCR categories
-- (Houzs has the table but no screen sets a case's NCR category).
--
--   1. service_case_resolution_methods — same shape and policies as service_case_types.
--   2. service_cases.resolution_method_id.
-- Additive. Rollback at foot.

create table if not exists public.service_case_resolution_methods (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  label      text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Configuration, not transactions: it survives go-live (CLAUDE.md §6).
insert into public.service_case_resolution_methods (code, label, sort_order) values
  ('replace_unit',           'Replace Unit',               10),
  ('supplier_repair',        'Supplier Service',           20),
  ('field_service_own',      'On Site Service (Own Team)', 30),
  ('field_service_supplier', 'On Site Service (Supplier)', 40),
  ('return_visit',           '2nd Services',               50)
on conflict (code) do nothing;

alter table public.service_case_resolution_methods enable row level security;
-- Same three policies as the case type list (0210 read + principal write, 0711 Service editor).
drop policy if exists scrm_read on public.service_case_resolution_methods;
create policy scrm_read on public.service_case_resolution_methods
  for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') in ('operation','principal'));
drop policy if exists scrm_principal_write on public.service_case_resolution_methods;
create policy scrm_principal_write on public.service_case_resolution_methods
  for all to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'principal')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'principal');
drop policy if exists scrm_service_editor_write on public.service_case_resolution_methods;
create policy scrm_service_editor_write on public.service_case_resolution_methods
  for all to authenticated
  using ((select public.settings_can_edit('service')))
  with check ((select public.settings_can_edit('service')));

alter table public.service_cases
  add column if not exists resolution_method_id uuid references public.service_case_resolution_methods(id);

-- ROLLBACK (manual):
--   alter table public.service_cases drop column if exists resolution_method_id;
--   drop table if exists public.service_case_resolution_methods;
