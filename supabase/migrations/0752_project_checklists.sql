-- 0752 · Projects slice 3: checklist templates and each project's checklist.
--
-- Weisiang's decision (Mr Lim, 2026-10-22, via YH): clear Carres rules, implement Houzs.
-- Jess was not part of this decision. Follows Houzs project_checklist_templates,
-- project_checklist_template_items and project_checklist (schema.pg.ts:541-631;
-- 021_projects.sql; 054_checklist_due_offset.sql). A task's due day is the project's start
-- day plus its offset (Houzs 054), so moving the start moves every task. Sections are a
-- text label on the task instead of Houzs' separate section tables. Houzs attachments,
-- review, permission gates and crew visibility are left out (plan §6). Nothing dropped.

create table if not exists public.project_checklist_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> '' and length(name) <= 120),
  -- Houzs project_event_types.default_template_id: a new project of this type starts with it.
  event_type text check (event_type in ('exhibition', 'solo')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists project_checklist_templates_default_key
  on public.project_checklist_templates (event_type) where event_type is not null and active;

create table if not exists public.project_checklist_template_items (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references public.project_checklist_templates(id) on delete cascade,
  section         text check (section is null or length(section) <= 80),
  seq             integer not null default 0,
  title           text not null check (btrim(title) <> '' and length(title) <= 200),
  due_offset_days integer check (due_offset_days between -365 and 365)
);
create index if not exists project_checklist_template_items_tpl_idx on public.project_checklist_template_items (template_id, seq);

create table if not exists public.project_checklist (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  section         text check (section is null or length(section) <= 80),
  seq             integer not null default 0,
  title           text not null check (btrim(title) <> '' and length(title) <= 200),
  due_offset_days integer check (due_offset_days between -365 and 365),
  -- Houzs statuses: pending, done, na (not needed), blocked.
  status          text not null default 'pending' check (status in ('pending', 'done', 'na', 'blocked')),
  notes           text check (notes is null or length(notes) <= 1000),
  completed_by    uuid references public.app_users(id) on delete set null,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists project_checklist_project_idx on public.project_checklist (project_id, seq);

-- Row security: Operation and the principal, as 0750. Template items and checklist
-- tasks may be removed (Houzs DELETE /checklist/:itemId); templates are retired.
alter table public.project_checklist_templates enable row level security;
alter table public.project_checklist_template_items enable row level security;
alter table public.project_checklist enable row level security;
revoke all on public.project_checklist_templates, public.project_checklist_template_items, public.project_checklist
  from public, anon, authenticated;
grant select, insert, update on public.project_checklist_templates to authenticated;
grant select, insert, update, delete on public.project_checklist_template_items, public.project_checklist to authenticated;

drop policy if exists project_checklist_templates_all on public.project_checklist_templates;
create policy project_checklist_templates_all on public.project_checklist_templates for all
  using ((select public.is_operation())) with check ((select public.is_operation()));
drop policy if exists project_checklist_template_items_all on public.project_checklist_template_items;
create policy project_checklist_template_items_all on public.project_checklist_template_items for all
  using ((select public.is_operation())) with check ((select public.is_operation()));
drop policy if exists project_checklist_all on public.project_checklist;
create policy project_checklist_all on public.project_checklist for all
  using ((select public.is_operation())) with check ((select public.is_operation()));
