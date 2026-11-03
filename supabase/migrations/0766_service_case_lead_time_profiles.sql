-- 0766 — Lead Time profiles: Normal / Peak / custom sets of stage target days, one active.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- YH (chat, 2026-11-03): "decision all follow houzs". Jess was not part of either decision.
-- Follows Houzs:
--   backend/src/db/migrations/075_assr_lead_time_portal.sql (profiles, stage targets, amendments,
--     Normal active and Peak seeded)
--   backend/src/routes/assrPortal.ts:42-196, 281-340 (list, create from the active profile,
--     activate, amend a target with a reason of 10 characters or more)
--   backend/src/services/assr.ts:125-200 (a stage's target = the active profile's, else the default;
--     an amended target is re-read by open cases in that stage, owner 2026-10-20)
--
--   1. service_case_lead_time_profiles, one active at a time.
--   2. service_case_lead_time_targets: target days per profile and stage.
--   3. service_case_lead_time_amendments: who changed which target, from what, and why.
--   4. Seed Normal (active) and Peak from each stage's own target_days (0745).
--   5. The 0745 stage-history trigger reads the active profile's target first, then the
--      stage's own target_days.
--   6. Three checked functions do every write: create, activate, amend. Each refuses a caller
--      who cannot edit Service settings.
-- Not ported: Houzs's scheduled activation (080, a 30-minute cron; Carres's cron runs daily)
-- and per-priority stage targets (082). Additive except the trigger function body. Rollback at foot.

-- ── 1–3 · tables ────────────────────────────────────────────────────────────
create table if not exists public.service_case_lead_time_profiles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) between 1 and 60),
  description text,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists sc_lead_time_one_active
  on public.service_case_lead_time_profiles (is_active) where is_active;

create table if not exists public.service_case_lead_time_targets (
  profile_id  uuid not null references public.service_case_lead_time_profiles(id) on delete cascade,
  status_id   uuid not null references public.service_case_statuses(id) on delete cascade,
  target_days numeric(5,1) not null check (target_days > 0 and target_days <= 365),
  primary key (profile_id, status_id)
);

create table if not exists public.service_case_lead_time_amendments (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.service_case_lead_time_profiles(id) on delete cascade,
  status_id   uuid not null references public.service_case_statuses(id) on delete cascade,
  before_days numeric(5,1),
  after_days  numeric(5,1) not null,
  reason      text not null check (length(btrim(reason)) >= 10),
  changed_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists sc_lead_time_amendments_profile_idx
  on public.service_case_lead_time_amendments (profile_id, created_at desc);

-- Staff read; only the functions below write.
do $$
declare t text;
begin
  foreach t in array array['service_case_lead_time_profiles', 'service_case_lead_time_targets',
                           'service_case_lead_time_amendments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('drop policy if exists sc_lead_time_read on public.%I', t);
    execute format($f$create policy sc_lead_time_read on public.%I for select to authenticated
      using ((select auth.jwt()->'app_metadata'->>'role') in ('operation','principal'))$f$, t);
  end loop;
end $$;

-- ── 4 · seed (configuration, survives go-live) ─────────────────────────────
insert into public.service_case_lead_time_profiles (name, description, is_active)
select 'Normal', 'Default operating conditions.', not exists (select 1 from public.service_case_lead_time_profiles where is_active)
where not exists (select 1 from public.service_case_lead_time_profiles where name = 'Normal');
insert into public.service_case_lead_time_profiles (name, description, is_active)
values ('Peak', 'Hari Raya, CNY, year end, monsoon.', false)
on conflict (name) do nothing;
insert into public.service_case_lead_time_targets (profile_id, status_id, target_days)
select p.id, s.id, s.target_days
  from public.service_case_lead_time_profiles p
  cross join public.service_case_statuses s
 where p.name in ('Normal', 'Peak') and s.target_days is not null
on conflict do nothing;

-- ── 5 · the stage clock reads the active profile ────────────────────────────
create or replace function public.service_case_stage_history_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_now timestamptz := now();
begin
  if tg_op = 'UPDATE' and new.status_id is not distinct from old.status_id then
    return new;
  end if;
  update public.service_case_stage_history
     set exited_at = v_now
   where case_id = new.id and exited_at is null;
  insert into public.service_case_stage_history (case_id, status_id, entered_at, target_days, changed_by)
  values (
    new.id,
    new.status_id,
    v_now,
    coalesce(
      (select t.target_days
         from public.service_case_lead_time_targets t
         join public.service_case_lead_time_profiles p on p.id = t.profile_id and p.is_active
        where t.status_id = new.status_id),
      (select s.target_days from public.service_case_statuses s where s.id = new.status_id)),
    auth.uid()
  );
  return new;
end;
$fn$;

-- ── 6 · the writes ──────────────────────────────────────────────────────────
-- A new profile starts as a copy of the active one's targets, inactive.
create or replace function public.service_case_create_lead_time_profile(p_name text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_id uuid;
begin
  if not coalesce(public.settings_can_edit('service'), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.service_case_lead_time_profiles (name, description)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''))
  returning id into v_id;
  insert into public.service_case_lead_time_targets (profile_id, status_id, target_days)
  select v_id, t.status_id, t.target_days
    from public.service_case_lead_time_targets t
    join public.service_case_lead_time_profiles p on p.id = t.profile_id and p.is_active;
  return v_id;
end;
$fn$;

-- Cases already in a stage keep the target they entered with (Houzs §10 "Effective date").
create or replace function public.service_case_activate_lead_time_profile(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not coalesce(public.settings_can_edit('service'), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.service_case_lead_time_profiles where id = p_profile) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  update public.service_case_lead_time_profiles set is_active = false where is_active and id <> p_profile;
  update public.service_case_lead_time_profiles set is_active = true where id = p_profile;
end;
$fn$;

-- Amending the active profile re-reads the target on every open case in that stage.
create or replace function public.service_case_amend_lead_time_target(
  p_profile uuid, p_status uuid, p_days numeric, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_before numeric(5,1);
  v_active boolean;
  v_changed integer := 0;
begin
  if not coalesce(public.settings_can_edit('service'), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select is_active into v_active from public.service_case_lead_time_profiles where id = p_profile;
  if v_active is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  select target_days into v_before from public.service_case_lead_time_targets
   where profile_id = p_profile and status_id = p_status;
  insert into public.service_case_lead_time_targets (profile_id, status_id, target_days)
  values (p_profile, p_status, p_days)
  on conflict (profile_id, status_id) do update set target_days = excluded.target_days;
  insert into public.service_case_lead_time_amendments (profile_id, status_id, before_days, after_days, reason, changed_by)
  values (p_profile, p_status, v_before, p_days, btrim(p_reason), auth.uid());
  if v_active then
    update public.service_case_stage_history h
       set target_days = p_days
      from public.service_cases c
     where h.case_id = c.id and h.exited_at is null and h.status_id = p_status
       and c.status_id = p_status and c.archived_at is null
       and h.target_days is distinct from p_days;
    get diagnostics v_changed = row_count;
  end if;
  return v_changed;
end;
$fn$;

revoke execute on function public.service_case_create_lead_time_profile(text, text) from public, anon;
revoke execute on function public.service_case_activate_lead_time_profile(uuid) from public, anon;
revoke execute on function public.service_case_amend_lead_time_target(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.service_case_create_lead_time_profile(text, text) to authenticated;
grant execute on function public.service_case_activate_lead_time_profile(uuid) to authenticated;
grant execute on function public.service_case_amend_lead_time_target(uuid, uuid, numeric, text) to authenticated;

-- ROLLBACK (manual):
--   drop function if exists public.service_case_amend_lead_time_target(uuid, uuid, numeric, text),
--     public.service_case_activate_lead_time_profile(uuid), public.service_case_create_lead_time_profile(text, text);
--   re-create 0745's service_case_stage_history_log() (target from service_case_statuses only);
--   drop table if exists public.service_case_lead_time_amendments, public.service_case_lead_time_targets,
--     public.service_case_lead_time_profiles;
