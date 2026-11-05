-- 0751 · Projects slice 2: Project Maintenance masters and the project team.
--
-- Weisiang's decision (Mr Lim, 2026-10-22, via YH): clear Carres rules, implement Houzs.
-- Jess was not part of this decision. Follows Houzs project_brands (schema.pg.ts:206-213),
-- project_venues (038_venues.sql, 0178, 0182), project_organizers (028_organizers.sql),
-- project_contractors (20260902T1224_projects_contractor.sql) and project_team
-- (021_projects.sql:194-204). The four Houzs masters share one Carres table with a kind;
-- a master is retired with active = false, never removed, so old projects keep their words.
-- Nothing dropped or deleted.

create table if not exists public.project_masters (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('brand', 'venue', 'organizer', 'contractor')),
  name       text not null check (btrim(name) <> '' and length(name) <= 120),
  state      text,
  address    text,
  notes      text,
  active     boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists project_masters_kind_name_key on public.project_masters (kind, lower(btrim(name)));
comment on table public.project_masters is
  '0751 (Houzs Project Maintenance): the brand, venue, organizer and contractor lists the project form picks from. state and address are used by venues.';

create table if not exists public.project_team (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.app_users(id) on delete cascade,
  role       text check (role is null or length(role) <= 40),
  created_at timestamptz not null default now()
);
create unique index if not exists project_team_member_key on public.project_team (project_id, user_id, coalesce(role, ''));
create index if not exists project_team_user_idx on public.project_team (user_id);

-- Row security: Operation and the principal, as 0750 (Houzs projects.manage and
-- projects.write map to the Operations portal, docs/houzs-port/projects-plan.md §4).
alter table public.project_masters enable row level security;
alter table public.project_team enable row level security;
revoke all on public.project_masters, public.project_team from public, anon, authenticated;
grant select, insert, update on public.project_masters to authenticated;
grant select, insert, delete on public.project_team to authenticated;

drop policy if exists project_masters_read on public.project_masters;
create policy project_masters_read on public.project_masters for select using ((select public.is_operation()));
drop policy if exists project_masters_insert on public.project_masters;
create policy project_masters_insert on public.project_masters for insert with check ((select public.is_operation()));
drop policy if exists project_masters_update on public.project_masters;
create policy project_masters_update on public.project_masters for update
  using ((select public.is_operation())) with check ((select public.is_operation()));

drop policy if exists project_team_read on public.project_team;
create policy project_team_read on public.project_team for select using ((select public.is_operation()));
drop policy if exists project_team_insert on public.project_team;
create policy project_team_insert on public.project_team for insert with check ((select public.is_operation()));
drop policy if exists project_team_delete on public.project_team;
create policy project_team_delete on public.project_team for delete using ((select public.is_operation()));
