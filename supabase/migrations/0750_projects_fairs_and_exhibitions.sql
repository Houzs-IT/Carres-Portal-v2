-- 0750 · Projects: fairs, exhibitions and solo roadshows (slice 1 of the Projects port).
--
-- Weisiang's decision (Mr Lim, 2026-10-22, via YH): clear Carres rules, implement Houzs.
-- Jess was not part of this decision. Follows Houzs projects / project_activity
-- (backend/src/db/schema.pg.ts:154-192, 241-251; migrations 053 stages, 088 status).
-- Carres has one company, so Houzs company_id is not carried. Brand, venue, organizer and
-- contractor are text, as in Houzs; their pickers come from the masters in a later slice.
-- Nothing dropped or deleted.

create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (btrim(code) <> ''),
  name          text not null check (btrim(name) <> '' and length(name) <= 200),
  stage         text not null default 'draft'
                check (stage in ('draft', 'setup', 'live', 'dismantle', 'completed')),
  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'cancelled')),
  event_type    text check (event_type in ('exhibition', 'solo')),
  brand         text not null check (btrim(brand) <> ''),
  state         text not null check (btrim(state) <> ''),
  venue         text not null check (btrim(venue) <> ''),
  venue_address text,
  organizer     text,
  contractor    text,
  booth_no      text,
  size_sqm      numeric(10,2) check (size_sqm is null or size_sqm >= 0),
  start_date    date not null,
  end_date      date not null,
  pic_id        uuid references public.app_users(id) on delete set null,
  notes         text,
  created_by    uuid references public.app_users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  archived_by   uuid references public.app_users(id) on delete set null,
  constraint projects_dates_check check (end_date >= start_date)
);
create index if not exists projects_start_idx on public.projects (start_date);
create index if not exists projects_status_idx on public.projects (status) where archived_at is null;
comment on table public.projects is
  '0750 (Weisiang''s decision 2026-10-22, Houzs Projects): one fair, exhibition or solo roadshow. stage = internal workflow, status = boss-facing state.';

create table if not exists public.project_activity (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  action      text not null check (action in ('created', 'stage_change', 'status_change', 'archived', 'unarchived', 'note')),
  from_value  text,
  to_value    text,
  note        text check (note is null or length(note) <= 2000),
  user_id     uuid references public.app_users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists project_activity_project_idx on public.project_activity (project_id, created_at desc);

-- Stage, status and archive changes record themselves, so no door can skip the trail
-- (Houzs logs the same actions from its routes, services/projects.ts).
create or replace function public.projects_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_activity (project_id, action, to_value) values (new.id, 'created', new.status);
    return new;
  end if;
  new.updated_at := now();
  if new.stage is distinct from old.stage then
    insert into public.project_activity (project_id, action, from_value, to_value) values (new.id, 'stage_change', old.stage, new.stage);
  end if;
  if new.status is distinct from old.status then
    insert into public.project_activity (project_id, action, from_value, to_value) values (new.id, 'status_change', old.status, new.status);
  end if;
  if new.archived_at is distinct from old.archived_at then
    insert into public.project_activity (project_id, action) values (new.id, case when new.archived_at is null then 'unarchived' else 'archived' end);
  end if;
  return new;
end;
$$;
revoke all on function public.projects_record_activity() from public, anon, authenticated;

drop trigger if exists projects_record_activity_ins on public.projects;
create trigger projects_record_activity_ins after insert on public.projects
  for each row execute function public.projects_record_activity();
drop trigger if exists projects_record_activity_upd on public.projects;
create trigger projects_record_activity_upd before update on public.projects
  for each row execute function public.projects_record_activity();

-- Row security: Operation and the principal read and write (Houzs projects.list / .write /
-- .manage map to the Operations portal, docs/houzs-port/projects-plan.md §4).
-- Activity rows are written by the trigger or as a note, never edited or removed.
alter table public.projects enable row level security;
alter table public.project_activity enable row level security;
revoke all on public.projects, public.project_activity from public, anon, authenticated;
grant select, insert, update on public.projects to authenticated;
grant select, insert on public.project_activity to authenticated;

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select using ((select public.is_operation()));
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert with check ((select public.is_operation()));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update
  using ((select public.is_operation())) with check ((select public.is_operation()));

drop policy if exists project_activity_read on public.project_activity;
create policy project_activity_read on public.project_activity for select using ((select public.is_operation()));
drop policy if exists project_activity_note on public.project_activity;
create policy project_activity_note on public.project_activity for insert
  with check ((select public.is_operation()) and action = 'note' and user_id = auth.uid());
