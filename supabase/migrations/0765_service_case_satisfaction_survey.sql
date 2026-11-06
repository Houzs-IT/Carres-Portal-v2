-- 0765 — The customer satisfaction survey on a closed service case.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- YH (chat, 2026-11-03): "decision all follow houzs". Jess was not part of either decision.
-- Follows Houzs:
--   backend/src/db/migrations/015_assr_surveys.sql (the token table)
--   backend/src/services/assr.ts:2349-2389 (one live token per case, 90-day expiry)
--   backend/src/routes/survey.ts (the public read and submit; an expired token reads as gone)
--   backend/src/services/assrCompletionSurvey.ts (email on close to the survey email)
--
--   1. service_case_survey_tokens: a 256-bit link token, one case, expires after 90 days.
--      Staff read and mint through RLS; the public page reaches it only through the API's
--      service-role client, which checks the token and its expiry.
--   2. service_cases.satisfaction_rating (1 to 5), satisfaction_notes, survey_email.
-- Additive. Rollback at foot.

-- ── 1 · the tokens ──────────────────────────────────────────────────────────
create table if not exists public.service_case_survey_tokens (
  token        text primary key,
  case_id      uuid not null references public.service_cases(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  submitted_at timestamptz
);
create index if not exists service_case_survey_tokens_case_idx on public.service_case_survey_tokens (case_id);

alter table public.service_case_survey_tokens enable row level security;
revoke all on public.service_case_survey_tokens from public, anon;
drop policy if exists sc_survey_read on public.service_case_survey_tokens;
create policy sc_survey_read on public.service_case_survey_tokens for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') in ('operation','principal'));
drop policy if exists sc_survey_mint on public.service_case_survey_tokens;
create policy sc_survey_mint on public.service_case_survey_tokens for insert to authenticated
  with check ((select auth.jwt()->'app_metadata'->>'role') in ('operation','principal'));

-- ── 2 · the rating on the case ──────────────────────────────────────────────
alter table public.service_cases
  add column if not exists satisfaction_rating smallint,
  add column if not exists satisfaction_notes  text,
  add column if not exists survey_email        text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sc_satisfaction_rating_range') then
    alter table public.service_cases add constraint sc_satisfaction_rating_range
      check (satisfaction_rating is null or satisfaction_rating between 1 and 5);
  end if;
end $$;

-- ROLLBACK (manual):
--   alter table public.service_cases drop constraint if exists sc_satisfaction_rating_range,
--     drop column if exists satisfaction_rating, drop column if exists satisfaction_notes,
--     drop column if exists survey_email;
--   drop table if exists public.service_case_survey_tokens;
