-- 0764 — Issue categories, product categories, priorities and root causes become Service Settings
-- lists, and a priority's SLA hours set the case deadline.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- YH (chat, 2026-11-03): "decision all follow houzs". Jess was not part of either decision.
-- Follows Houzs:
--   backend/src/db/migrations/065_assr_lookups.sql (issue categories, priorities with sla_hours,
--     NCR root-cause classifications, and their seeds)
--   frontend/src/pages/ServiceSettings.tsx:90-111 (the lookup lists on the settings page)
--   backend/src/services/assrSla.ts:56-77, backend/src/services/assr.ts:465-468 and :1288-1300
--     (deadline = opened + the priority's sla_hours; a priority change recomputes it)
--
-- Carres rules cleared: 0285's fixed issue-type and product-category lists (sc_issue_type_known,
-- sc_product_category_known), 0711's fixed priority list (service_cases_priority_known), and
-- 0289's sc_evidence_required_with_issue (an issue type only with evidence on file): Houzs staff
-- pick the issue category on the case at any time. The create door's evidence checklist stays.
-- The case columns keep their codes; a foreign key to each list replaces the fixed check. Each
-- list is seeded with the codes those checks allowed, so every row on file stays valid.
--
--   1. four lists, same shape and policies as the resolution methods (0761).
--   2. service_case_priorities.sla_hours.
--   3. service_cases.root_cause (Houzs ncr_category).
--   4. the fixed checks give way to foreign keys on code; the evidence-with-issue check goes.
-- Additive except the four dropped checks. Rollback at foot.

-- ── 1 · the lists ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['service_case_issue_categories', 'service_case_product_categories',
                           'service_case_priorities', 'service_case_root_causes'] loop
    execute format($f$
      create table if not exists public.%I (
        id         uuid primary key default gen_random_uuid(),
        code       text not null unique,
        label      text not null,
        sort_order integer not null default 0,
        active     boolean not null default true,
        created_at timestamptz not null default now()
      )$f$, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists sc_list_read on public.%I', t);
    execute format($f$create policy sc_list_read on public.%I for select to authenticated
      using ((select auth.jwt()->'app_metadata'->>'role') in ('operation','principal'))$f$, t);
    execute format('drop policy if exists sc_list_principal_write on public.%I', t);
    execute format($f$create policy sc_list_principal_write on public.%I for all to authenticated
      using ((select auth.jwt()->'app_metadata'->>'role') = 'principal')
      with check ((select auth.jwt()->'app_metadata'->>'role') = 'principal')$f$, t);
    execute format('drop policy if exists sc_list_service_editor_write on public.%I', t);
    execute format($f$create policy sc_list_service_editor_write on public.%I for all to authenticated
      using ((select public.settings_can_edit('service')))
      with check ((select public.settings_can_edit('service')))$f$, t);
  end loop;
end $$;

-- ── 2 · SLA hours (Houzs assr_priorities.sla_hours; blank = the 14 working days) ──
alter table public.service_case_priorities add column if not exists sla_hours integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scp_sla_hours_positive') then
    alter table public.service_case_priorities add constraint scp_sla_hours_positive
      check (sla_hours is null or sla_hours > 0);
  end if;
end $$;

-- Configuration, not transactions: it survives go-live (CLAUDE.md §6).
insert into public.service_case_issue_categories (code, label, sort_order) values
  ('wrong_sku', 'Wrong SKU', 10), ('missing_parts', 'Missing parts', 20),
  ('wrong_spec', 'Wrong specification', 30), ('wrong_colour', 'Wrong colour', 40),
  ('colour_uneven', 'Colour uneven', 50), ('damaged', 'Damaged', 60), ('other', 'Other', 70)
on conflict (code) do nothing;
insert into public.service_case_product_categories (code, label, sort_order) values
  ('mattress', 'Mattress', 10), ('bedframe', 'Bed frame', 20), ('sofa', 'Sofa', 30), ('other', 'Other', 40)
on conflict (code) do nothing;
insert into public.service_case_priorities (code, label, sort_order, sla_hours) values
  ('low', 'Low', 10, 336), ('normal', 'Normal', 20, 168), ('high', 'High', 30, 72), ('urgent', 'Urgent', 40, 24)
on conflict (code) do nothing;
insert into public.service_case_root_causes (code, label, sort_order) values
  ('material_defect', 'Material defect', 10), ('workmanship', 'Workmanship', 20),
  ('transit_damage', 'Transit damage', 30), ('design', 'Design', 40), ('installation', 'Installation', 50),
  ('customer_misuse', 'Customer misuse', 60), ('other', 'Other', 70)
on conflict (code) do nothing;

-- ── 3 · the case's root cause ───────────────────────────────────────────────
alter table public.service_cases add column if not exists root_cause text;

-- ── 4 · the fixed checks give way to the lists ──────────────────────────────
alter table public.service_cases drop constraint if exists sc_issue_type_known;
alter table public.service_cases drop constraint if exists sc_product_category_known;
alter table public.service_cases drop constraint if exists service_cases_priority_known;
alter table public.service_cases drop constraint if exists sc_evidence_required_with_issue;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sc_issue_type_listed') then
    alter table public.service_cases add constraint sc_issue_type_listed foreign key (issue_type)
      references public.service_case_issue_categories(code) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_product_category_listed') then
    alter table public.service_cases add constraint sc_product_category_listed foreign key (product_category)
      references public.service_case_product_categories(code) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_priority_listed') then
    alter table public.service_cases add constraint sc_priority_listed foreign key (priority)
      references public.service_case_priorities(code) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_root_cause_listed') then
    alter table public.service_cases add constraint sc_root_cause_listed foreign key (root_cause)
      references public.service_case_root_causes(code) on update cascade;
  end if;
end $$;

-- ROLLBACK (manual; the old checks fit only while no new code is in use):
--   alter table public.service_cases drop constraint if exists sc_issue_type_listed,
--     drop constraint if exists sc_product_category_listed, drop constraint if exists sc_priority_listed,
--     drop constraint if exists sc_root_cause_listed, drop column if exists root_cause;
--   re-add 0285's sc_issue_type_known / sc_product_category_known, 0711's service_cases_priority_known
--   and 0289's sc_evidence_required_with_issue;
--   drop table if exists public.service_case_root_causes, public.service_case_priorities,
--     public.service_case_product_categories, public.service_case_issue_categories;
