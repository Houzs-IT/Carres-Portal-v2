-- 0745 — A Service Case keeps when it entered each stage, and each stage has target days.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- Jess was not part of this decision.
-- Follows Houzs backend/src/services/assr.ts:905-1020 (transitionStage writes
-- assr_stage_history and snapshots stage_target_days on entry) and
-- backend/src/db/migrations/082_assr_priority_stage_targets.sql (target days per stage).
-- Carres stages are rows in service_case_statuses, so the target sits on the stage row
-- (Houzs's Lead Time profile fallback), not per priority.
--
--   1. service_case_statuses.target_days — how many days a case should stay in the stage.
--      Null = no target. Edited in Service Settings.
--   2. service_case_stage_history — one row per stage a case entered, with the target
--      snapshotted at entry (later edits to the stage's target do not move old rows).
--      The open row (exited_at null) is the current stage.
--   3. A trigger writes it on insert and on every status_id change. No client writes it.
--
-- A case filed before 0745 has no history row; the API then reads its stage as entered
-- at created_at (Houzs assr.ts:2006 does the same). Additive. Rollback at foot.

-- ── 1 · target days on a stage ──────────────────────────────────────────────
alter table public.service_case_statuses
  add column if not exists target_days numeric(5,1);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scs_target_days_positive') then
    alter table public.service_case_statuses
      add constraint scs_target_days_positive check (target_days is null or (target_days > 0 and target_days <= 365));
  end if;
end $$;
comment on column public.service_case_statuses.target_days is
  '0745: days a case should stay in this stage (Houzs stage target). Null = no target.';

-- ── 2 · stage history ───────────────────────────────────────────────────────
create table if not exists public.service_case_stage_history (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.service_cases(id) on delete cascade,
  status_id   uuid references public.service_case_statuses(id),
  entered_at  timestamptz not null default now(),
  exited_at   timestamptz,
  target_days numeric(5,1),
  changed_by  uuid
);
create index if not exists service_case_stage_history_case_idx
  on public.service_case_stage_history (case_id, entered_at);
create unique index if not exists service_case_stage_history_one_open
  on public.service_case_stage_history (case_id) where exited_at is null;

alter table public.service_case_stage_history enable row level security;
drop policy if exists scsh_read on public.service_case_stage_history;
create policy scsh_read on public.service_case_stage_history
  for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') in ('operation','principal'));
-- No write policy: only the trigger below (security definer) writes rows.

-- ── 3 · the trigger ─────────────────────────────────────────────────────────
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
    (select s.target_days from public.service_case_statuses s where s.id = new.status_id),
    auth.uid()
  );
  return new;
end;
$fn$;
revoke execute on function public.service_case_stage_history_log() from public, anon, authenticated;
drop trigger if exists service_case_stage_history_log on public.service_cases;
create trigger service_case_stage_history_log
  after insert or update of status_id on public.service_cases
  for each row execute function public.service_case_stage_history_log();

-- ROLLBACK (manual):
--   drop trigger if exists service_case_stage_history_log on public.service_cases;
--   drop function if exists public.service_case_stage_history_log();
--   drop table if exists public.service_case_stage_history;
--   alter table public.service_case_statuses drop constraint if exists scs_target_days_positive;
--   alter table public.service_case_statuses drop column if exists target_days;
