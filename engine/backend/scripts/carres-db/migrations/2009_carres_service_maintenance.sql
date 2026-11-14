-- Carres engine database: Service Cases › Service Maintenance reference data from Houzs (owner, 14 Nov 2026:
-- "Service maintenance also takes Houzs's data").
--
-- WHY. The page (frontend pages/ServiceSettings.tsx, Lead Time tab ServiceLeadTimePortal.tsx; backend routes/assr.ts
-- lookups and routes/assrPortal.ts) was empty in Carres apart from one hidden hand-made row "ZZ TEST" in Issue
-- Categories, so the case form had no Issue Category / Resolution / Priority / Product Category / Root-Cause choices and
-- no SLA lead times. GENERATED, do not edit by hand: regenerate with
--   node scripts/carres-db/load-carres-master-data.mjs --only service-maintenance --emit-sql scripts/carres-db/migrations/2009_carres_service_maintenance.sql
-- (and give the new file the next number; an applied migration is never edited).
--
-- WHAT. D removes the ZZ TEST row(s) from these lists (and stage targets that only belong to a test priority /
-- profile); it stops, changing nothing, if any case uses one. A adds Houzs main-company rows (houzs_local, masked):
-- assr_issue_categories 6 · assr_resolution_methods 5 · assr_priorities 4 · assr_ncr_categories 7 · assr_product_categories 6 · assr_lead_time_profiles 2 · assr_stage_targets 18 · assr_priority_stage_targets 32.
-- Each row is added only when the engine has no row with the same natural key (slug or name for a list, name for a
-- profile, profile name / priority slug + stage for a target); new rows take the engine's own ids, existing rows are
-- never changed. These tables have no company column. NOT copied: the Default Case Assignees (system_settings
-- assr_default_assignee_id / assr_default_assignee2_id point at Houzs people; Carres picks its own on the page).
--
-- RE-RUN: safe; a second run changes nothing. No row count of the target is asserted.
-- REVERSAL: none automatic (data). Remove rows by hand on the page if ever needed.

-- ── D · clean-up: the hand-made ZZ TEST row(s) ─────────────────────────────────────────────────────────────
do $sm_cleanup$
declare
  r record; n int; blockers text[] := '{}'; found int := 0;
begin
  -- Picker lists: a case stores the slug or the name as text (service_category holds product category names).
  for r in
    select * from (values
      ('public.assr_issue_categories', 'issue_category'), ('public.assr_resolution_methods', 'resolution_method'),
      ('public.assr_priorities', 'priority'), ('public.assr_ncr_categories', 'ncr_category'),
      ('public.assr_product_categories', 'service_category')) v(tbl, col)
  loop
    execute format($q$select count(*) from public.assr_cases c, %s x
       where upper(btrim(x.name)) = 'ZZ TEST'
         and ((x.slug <> '' and position(lower(x.slug) in lower(coalesce(c.%I::text, ''))) > 0) or position(lower(x.name) in lower(coalesce(c.%I::text, ''))) > 0)$q$,
      r.tbl, r.col, r.col) into n;
    if n > 0 then blockers := blockers || format('assr_cases.%s uses the %s test row: %s case(s)', r.col, r.tbl, n); end if;
  end loop;
  select count(*) into n from public.assr_cases c join public.assr_lead_time_profiles p on p.id = c.lead_time_profile_id
   where upper(btrim(p.name)) = 'ZZ TEST';
  if n > 0 then blockers := blockers || format('assr_cases.lead_time_profile_id uses the test profile: %s case(s)', n); end if;
  if cardinality(blockers) > 0 then
    raise exception 'Service maintenance: the % rows are in use (%); nothing was changed', 'ZZ TEST', array_to_string(blockers, '; ');
  end if;
  -- Rows that only describe a test priority / profile go with it.
  delete from public.assr_priority_stage_targets where priority_id in (select id from public.assr_priorities where upper(btrim(name)) = 'ZZ TEST');
  delete from public.assr_stage_targets where profile_id in (select id from public.assr_lead_time_profiles where upper(btrim(name)) = 'ZZ TEST');
  for r in select unnest(array['public.assr_issue_categories', 'public.assr_resolution_methods', 'public.assr_priorities', 'public.assr_ncr_categories', 'public.assr_product_categories', 'public.assr_lead_time_profiles']) as tbl loop
    execute format('delete from %s where upper(btrim(name)) = $1', r.tbl) using 'ZZ TEST'::text;
    get diagnostics n = row_count; found := found + n;
  end loop;
  raise notice 'Service maintenance: % test row(s) named % removed', found, 'ZZ TEST';
end $sm_cleanup$;

-- ── A · picker lists (General tab) ──────────────────────────────────────────────────────────────────────────────
-- public.assr_issue_categories: 6 Houzs row(s), by slug / name
with s as (select coalesce(pg_get_serial_sequence('"public"."assr_issue_categories"', 'id'),
    (select substring(column_default from $re$nextval\('([^']+)'$re$) from information_schema.columns
      where table_schema = 'public' and table_name = 'assr_issue_categories' and column_name = 'id'))::regclass as seq)
select setval(s.seq, x.m) from s, (select max(id)::bigint as m from "public"."assr_issue_categories") x
 where x.m is not null and x.m >= coalesce((select q.last_value from pg_sequences q where format('%I.%I', q.schemaname, q.sequencename)::regclass = s.seq), 0);
insert into "public"."assr_issue_categories" ("slug", "name", "sort_order", "active")
select r."slug", r."name", r."sort_order", r."active"
from jsonb_populate_recordset(null::"public"."assr_issue_categories", $j$[
{"slug":"product_defect","name":"Product defect","sort_order":10,"active":1},
{"slug":"incorrect_item_delivered","name":"Incorrect Item Delivered","sort_order":20,"active":1},
{"slug":"missing__short_items","name":"Missing / Short Items","sort_order":30,"active":1},
{"slug":"warranty_service_request","name":"Warranty Service Request","sort_order":40,"active":1},
{"slug":"installation__assembly_issue","name":"Installation / Assembly Issue","sort_order":50,"active":1},
{"slug":"others","name":"Others","sort_order":60,"active":1}
]$j$::jsonb) r
where not exists (select 1 from "public"."assr_issue_categories" e where e.slug = r.slug or lower(btrim(e.name)) = lower(btrim(r.name)));

-- public.assr_resolution_methods: 5 Houzs row(s), by slug / name
with s as (select coalesce(pg_get_serial_sequence('"public"."assr_resolution_methods"', 'id'),
    (select substring(column_default from $re$nextval\('([^']+)'$re$) from information_schema.columns
      where table_schema = 'public' and table_name = 'assr_resolution_methods' and column_name = 'id'))::regclass as seq)
select setval(s.seq, x.m) from s, (select max(id)::bigint as m from "public"."assr_resolution_methods") x
 where x.m is not null and x.m >= coalesce((select q.last_value from pg_sequences q where format('%I.%I', q.schemaname, q.sequencename)::regclass = s.seq), 0);
insert into "public"."assr_resolution_methods" ("slug", "name", "sort_order", "active")
select r."slug", r."name", r."sort_order", r."active"
from jsonb_populate_recordset(null::"public"."assr_resolution_methods", $j$[
{"slug":"replace_unit","name":"Replace unit","sort_order":10,"active":1},
{"slug":"supplier_repair","name":"Send to supplier for repair","sort_order":20,"active":1},
{"slug":"field_service_own","name":"On-site service (in-house)","sort_order":30,"active":1},
{"slug":"field_service_supplier","name":"On-site service (supplier)","sort_order":40,"active":1},
{"slug":"return_visit","name":"Customer return visit","sort_order":50,"active":1}
]$j$::jsonb) r
where not exists (select 1 from "public"."assr_resolution_methods" e where e.slug = r.slug or lower(btrim(e.name)) = lower(btrim(r.name)));

-- public.assr_priorities: 4 Houzs row(s), by slug / name
with s as (select coalesce(pg_get_serial_sequence('"public"."assr_priorities"', 'id'),
    (select substring(column_default from $re$nextval\('([^']+)'$re$) from information_schema.columns
      where table_schema = 'public' and table_name = 'assr_priorities' and column_name = 'id'))::regclass as seq)
select setval(s.seq, x.m) from s, (select max(id)::bigint as m from "public"."assr_priorities") x
 where x.m is not null and x.m >= coalesce((select q.last_value from pg_sequences q where format('%I.%I', q.schemaname, q.sequencename)::regclass = s.seq), 0);
insert into "public"."assr_priorities" ("slug", "name", "sort_order", "sla_hours", "active")
select r."slug", r."name", r."sort_order", r."sla_hours", r."active"
from jsonb_populate_recordset(null::"public"."assr_priorities", $j$[
{"slug":"low","name":"Low","sort_order":10,"sla_hours":336,"active":1},
{"slug":"normal","name":"Normal","sort_order":20,"sla_hours":168,"active":1},
{"slug":"high","name":"High","sort_order":30,"sla_hours":72,"active":1},
{"slug":"urgent","name":"Urgent","sort_order":40,"sla_hours":24,"active":1}
]$j$::jsonb) r
where not exists (select 1 from "public"."assr_priorities" e where e.slug = r.slug or lower(btrim(e.name)) = lower(btrim(r.name)));

-- public.assr_ncr_categories: 7 Houzs row(s), by slug / name
with s as (select coalesce(pg_get_serial_sequence('"public"."assr_ncr_categories"', 'id'),
    (select substring(column_default from $re$nextval\('([^']+)'$re$) from information_schema.columns
      where table_schema = 'public' and table_name = 'assr_ncr_categories' and column_name = 'id'))::regclass as seq)
select setval(s.seq, x.m) from s, (select max(id)::bigint as m from "public"."assr_ncr_categories") x
 where x.m is not null and x.m >= coalesce((select q.last_value from pg_sequences q where format('%I.%I', q.schemaname, q.sequencename)::regclass = s.seq), 0);
insert into "public"."assr_ncr_categories" ("slug", "name", "sort_order", "active")
select r."slug", r."name", r."sort_order", r."active"
from jsonb_populate_recordset(null::"public"."assr_ncr_categories", $j$[
{"slug":"material_defect","name":"Material defect","sort_order":10,"active":1},
{"slug":"workmanship","name":"Workmanship","sort_order":20,"active":1},
{"slug":"transit_damage","name":"Transit damage","sort_order":30,"active":1},
{"slug":"design","name":"Design","sort_order":40,"active":1},
{"slug":"installation","name":"Installation","sort_order":50,"active":1},
{"slug":"customer_misuse","name":"Customer misuse","sort_order":60,"active":1},
{"slug":"other","name":"Other","sort_order":70,"active":1}
]$j$::jsonb) r
where not exists (select 1 from "public"."assr_ncr_categories" e where e.slug = r.slug or lower(btrim(e.name)) = lower(btrim(r.name)));

-- public.assr_product_categories: 6 Houzs row(s), by slug / name
with s as (select coalesce(pg_get_serial_sequence('"public"."assr_product_categories"', 'id'),
    (select substring(column_default from $re$nextval\('([^']+)'$re$) from information_schema.columns
      where table_schema = 'public' and table_name = 'assr_product_categories' and column_name = 'id'))::regclass as seq)
select setval(s.seq, x.m) from s, (select max(id)::bigint as m from "public"."assr_product_categories") x
 where x.m is not null and x.m >= coalesce((select q.last_value from pg_sequences q where format('%I.%I', q.schemaname, q.sequencename)::regclass = s.seq), 0);
insert into "public"."assr_product_categories" ("slug", "name", "sort_order", "active")
select r."slug", r."name", r."sort_order", r."active"
from jsonb_populate_recordset(null::"public"."assr_product_categories", $j$[
{"slug":"mattress","name":"Mattress","sort_order":30,"active":1},
{"slug":"bed_frame","name":"Bedframe","sort_order":10,"active":1},
{"slug":"sofa","name":"Sofa","sort_order":20,"active":1},
{"slug":"pillow_bolster","name":"Pillow / Bolster","sort_order":900,"active":0},
{"slug":"accessories","name":"Accessories","sort_order":50,"active":1},
{"slug":"dining","name":"Dining","sort_order":40,"active":1}
]$j$::jsonb) r
where not exists (select 1 from "public"."assr_product_categories" e where e.slug = r.slug or lower(btrim(e.name)) = lower(btrim(r.name)));

-- ── A · lead time (Lead Time tab and the profile stamped on new cases) ─────────────────────────────────────────
-- public.assr_lead_time_profiles: 2 Houzs row(s), by name. One profile is active: a Houzs active profile
-- stays inactive when the engine already has an active one.
with s as (select coalesce(pg_get_serial_sequence('"public"."assr_lead_time_profiles"', 'id'),
    (select substring(column_default from $re$nextval\('([^']+)'$re$) from information_schema.columns
      where table_schema = 'public' and table_name = 'assr_lead_time_profiles' and column_name = 'id'))::regclass as seq)
select setval(s.seq, x.m) from s, (select max(id)::bigint as m from "public"."assr_lead_time_profiles") x
 where x.m is not null and x.m >= coalesce((select q.last_value from pg_sequences q where format('%I.%I', q.schemaname, q.sequencename)::regclass = s.seq), 0);
insert into public.assr_lead_time_profiles (name, description, is_active)
select r.name, r.description,
       case when r.is_active::int = 1 and not exists (select 1 from public.assr_lead_time_profiles a where a.is_active = 1) then 1 else 0 end
from jsonb_to_recordset($j$[
{"name":"Normal","description":"Default operating conditions — 21 days end-to-end (proposal §8.1).","is_active":1},
{"name":"Peak","description":"Hari Raya / CNY / year-end / monsoon — 28 days end-to-end (proposal §8.1).","is_active":0}
]$j$::jsonb) r(name text, description text, is_active bigint)
where not exists (select 1 from public.assr_lead_time_profiles e where lower(btrim(e.name)) = lower(btrim(r.name)));

-- public.assr_stage_targets: 18 Houzs row(s), by profile name + stage
with s as (select coalesce(pg_get_serial_sequence('"public"."assr_stage_targets"', 'id'),
    (select substring(column_default from $re$nextval\('([^']+)'$re$) from information_schema.columns
      where table_schema = 'public' and table_name = 'assr_stage_targets' and column_name = 'id'))::regclass as seq)
select setval(s.seq, x.m) from s, (select max(id)::bigint as m from "public"."assr_stage_targets") x
 where x.m is not null and x.m >= coalesce((select q.last_value from pg_sequences q where format('%I.%I', q.schemaname, q.sequencename)::regclass = s.seq), 0);
insert into "public"."assr_stage_targets" ("profile_id", stage, target_days)
select p.pid, r.stage, r.target_days
from jsonb_to_recordset($j$[
{"parent":"Normal","stage":"pending_review","target_days":1},
{"parent":"Normal","stage":"under_verification","target_days":2},
{"parent":"Normal","stage":"pending_solution","target_days":2},
{"parent":"Normal","stage":"pending_inspection","target_days":2},
{"parent":"Normal","stage":"pending_item_pickup","target_days":2},
{"parent":"Normal","stage":"pending_supplier_pickup","target_days":3},
{"parent":"Normal","stage":"pending_item_ready","target_days":5},
{"parent":"Normal","stage":"pending_delivery_service","target_days":4},
{"parent":"Normal","stage":"completed","target_days":0},
{"parent":"Peak","stage":"pending_review","target_days":1},
{"parent":"Peak","stage":"under_verification","target_days":2},
{"parent":"Peak","stage":"pending_solution","target_days":3},
{"parent":"Peak","stage":"pending_inspection","target_days":3},
{"parent":"Peak","stage":"pending_item_pickup","target_days":3},
{"parent":"Peak","stage":"pending_supplier_pickup","target_days":4},
{"parent":"Peak","stage":"pending_item_ready","target_days":7},
{"parent":"Peak","stage":"pending_delivery_service","target_days":5},
{"parent":"Peak","stage":"completed","target_days":0}
]$j$::jsonb) r(parent text, stage text, target_days double precision)
cross join lateral (select min(x.id) as pid from "public"."assr_lead_time_profiles" x where lower(btrim(x.name)) = lower(btrim(r.parent))) p
where p.pid is not null
  and not exists (select 1 from "public"."assr_stage_targets" e where e."profile_id" = p.pid and e.stage = r.stage);

-- public.assr_priority_stage_targets: 32 Houzs row(s), by priority slug + stage
with s as (select coalesce(pg_get_serial_sequence('"public"."assr_priority_stage_targets"', 'id'),
    (select substring(column_default from $re$nextval\('([^']+)'$re$) from information_schema.columns
      where table_schema = 'public' and table_name = 'assr_priority_stage_targets' and column_name = 'id'))::regclass as seq)
select setval(s.seq, x.m) from s, (select max(id)::bigint as m from "public"."assr_priority_stage_targets") x
 where x.m is not null and x.m >= coalesce((select q.last_value from pg_sequences q where format('%I.%I', q.schemaname, q.sequencename)::regclass = s.seq), 0);
insert into "public"."assr_priority_stage_targets" ("priority_id", stage, target_days)
select p.pid, r.stage, r.target_days
from jsonb_to_recordset($j$[
{"parent":"urgent","stage":"pending_review","target_days":1},
{"parent":"urgent","stage":"under_verification","target_days":1},
{"parent":"urgent","stage":"pending_solution","target_days":1},
{"parent":"urgent","stage":"pending_inspection","target_days":1},
{"parent":"urgent","stage":"pending_item_pickup","target_days":1},
{"parent":"urgent","stage":"pending_supplier_pickup","target_days":2},
{"parent":"urgent","stage":"pending_item_ready","target_days":3},
{"parent":"urgent","stage":"pending_delivery_service","target_days":2},
{"parent":"high","stage":"pending_review","target_days":1},
{"parent":"high","stage":"under_verification","target_days":1},
{"parent":"high","stage":"pending_solution","target_days":1},
{"parent":"high","stage":"pending_inspection","target_days":2},
{"parent":"high","stage":"pending_item_pickup","target_days":2},
{"parent":"high","stage":"pending_supplier_pickup","target_days":2},
{"parent":"high","stage":"pending_item_ready","target_days":4},
{"parent":"high","stage":"pending_delivery_service","target_days":3},
{"parent":"normal","stage":"pending_review","target_days":1},
{"parent":"normal","stage":"under_verification","target_days":5},
{"parent":"normal","stage":"pending_solution","target_days":3},
{"parent":"normal","stage":"pending_inspection","target_days":2},
{"parent":"normal","stage":"pending_item_pickup","target_days":2},
{"parent":"normal","stage":"pending_supplier_pickup","target_days":7},
{"parent":"normal","stage":"pending_item_ready","target_days":7},
{"parent":"normal","stage":"pending_delivery_service","target_days":7},
{"parent":"low","stage":"pending_review","target_days":2},
{"parent":"low","stage":"under_verification","target_days":3},
{"parent":"low","stage":"pending_solution","target_days":3},
{"parent":"low","stage":"pending_inspection","target_days":3},
{"parent":"low","stage":"pending_item_pickup","target_days":3},
{"parent":"low","stage":"pending_supplier_pickup","target_days":4},
{"parent":"low","stage":"pending_item_ready","target_days":7},
{"parent":"low","stage":"pending_delivery_service","target_days":5}
]$j$::jsonb) r(parent text, stage text, target_days double precision)
cross join lateral (select min(x.id) as pid from "public"."assr_priorities" x where x.slug = r.parent) p
where p.pid is not null
  and not exists (select 1 from "public"."assr_priority_stage_targets" e where e."priority_id" = p.pid and e.stage = r.stage);
