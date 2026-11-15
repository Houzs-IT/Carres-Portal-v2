-- ============================================================================
-- check-open-access.sql · what can a signed-in account reach that nobody meant?
--
-- READ-ONLY. Five questions about the portal database; each answer should be
-- ZERO ROWS. Run each block on its own (Supabase SQL editor, or the MCP's
-- execute_sql). Written 15 Nov 2026 with migrations 0776 and 0777, which
-- closed what the first three found: 31 policies and 38 functions. The fourth
-- and fifth came with 0778 to 0780 the next day: who sees what Carres pays.
--
-- Why it exists. Everything in `public` is reachable by name through the data
-- API with nothing but a signed-in token:
--   a table       through its row-level security policies
--   a function    if the role may EXECUTE it, and a new function is executable
--                 by every signed-in account unless a migration says otherwise
-- So "any signed-in account" is the default answer three times over, and a
-- signed-in account is not yet a Carres account: it may be an outside party's
-- login, a disabled login whose token has not run out, or an account with no
-- row in app_users.
--
-- CI stops a NEW policy of the first kind (scripts/migration-open-policy.mjs).
-- Nothing in CI can read a function's privileges, so block 3 is run by hand:
-- after a migration that adds SECURITY DEFINER functions, and before a
-- release that gives an outside party a login.
-- ============================================================================


-- ── 1 · A policy that asks only "is this account signed in?" ────────────────
select schemaname, tablename, policyname, cmd, roles::text as roles,
       coalesce(qual, '') as using_expression, coalesce(with_check, '') as with_check_expression
  from pg_policies
 where schemaname in ('public', 'storage')
   and permissive = 'PERMISSIVE'
   and (   lower(regexp_replace(coalesce(qual, ''),       '\s+', '', 'g')) in
             ('true', '(auth.uid()isnotnull)', '((selectauth.uid()asuid)isnotnull)',
              '(auth.role()=''authenticated''::text)', '((selectauth.role()asrole)=''authenticated''::text)')
        or lower(regexp_replace(coalesce(with_check, ''), '\s+', '', 'g')) in
             ('true', '(auth.uid()isnotnull)', '((selectauth.uid()asuid)isnotnull)',
              '(auth.role()=''authenticated''::text)', '((selectauth.role()asrole)=''authenticated''::text)'))
   and not (roles::text in ('{service_role}', '{postgres}', '{supabase_auth_admin}'))
 order by 1, 2, 3;


-- ── 2 · A table with row-level security off, or a view that runs as its owner
--        and does not ask who is reading ─────────────────────────────────────
select 'table without row-level security' as finding, n.nspname || '.' || c.relname as object
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
union all
select 'owner-run view with no caller check', n.nspname || '.' || c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v'
   and coalesce(c.reloptions::text, '') !~ 'security_invoker=(true|on|1)'
   and (has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'SELECT'))
   and pg_get_viewdef(c.oid) !~* '(is_internal|is_carres_or_seller|is_principal|is_operation|app_role|gl_may_read)\s*\('
   -- a view over other owner-run views that ask is asked through them
   and not exists (
         select 1
           from pg_depend d
           join pg_rewrite r on r.oid = d.objid and r.ev_class = c.oid
           join pg_class base on base.oid = d.refobjid and base.relkind = 'v' and base.oid <> c.oid
          where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
            and pg_get_viewdef(base.oid) ~* '(is_internal|is_carres_or_seller|is_principal|is_operation|app_role|gl_may_read)\s*\(')
 order by 1, 2;


-- ── 3 · A function that runs as its owner, that a signed-in account may call,
--        and that never asks who is calling (itself or through what it calls) ─
-- "Asks" is read off the source: a role helper, the token's role, or a refusal.
-- It is a screen, not a proof: a function it passes can still ask the wrong
-- question. One it reports either gains a check, or loses EXECUTE for anon and
-- authenticated (functions that run as their owner still reach it), or joins
-- the list below with its reason.
with recursive fn as (
  select p.oid, p.proname, p.prosrc, p.prosecdef, p.prorettype,
         has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('anon', p.oid, 'EXECUTE') as callable_by_a_person,
         p.prosrc ~* '(app_role\s*\(|is_internal\s*\(|is_principal\s*\(|is_operation\s*\(|is_carres_or_seller\s*\(|gl_may_read|settings_can_edit|app_dealer_id\s*\(|app_partner_id\s*\(|app_supplier_id\s*\(|app_warehouse_id\s*\(|app_metadata|42501|forbidden|insufficient_privilege|not allowed|only the |may not|permission)' as asks
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
), candidate as (
  select * from fn
   where prosecdef and callable_by_a_person and not asks
     and prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
), walk(root, cur, depth) as (
  select c.oid, c.oid, 0 from candidate c
  union
  select w.root, g.oid, w.depth + 1
    from walk w
    join fn f on f.oid = w.cur
    join fn g on g.oid <> f.oid and f.prosrc ~* ('\m' || g.proname || '\s*\(')
   where w.depth < 3
), asked_through_a_callee as (
  select distinct w.root from walk w join fn g on g.oid = w.cur where g.asks
), accepted(name, why) as (values
  -- who the caller is: they answer about the caller and nobody else
  ('app_role', 'the caller''s own role'), ('app_dealer_id', 'the caller''s own store'),
  ('app_partner_id', 'the caller''s own partner'), ('app_supplier_id', 'the caller''s own supplier'),
  ('app_warehouse_id', 'the caller''s own site'), ('is_internal', 'about the caller'),
  ('is_operation', 'about the caller'), ('is_principal', 'about the caller'),
  ('is_carres_or_seller', 'about the caller'), ('sees_cost', 'about the caller'),
  ('is_through_carres_api', 'about the request: true or false, and the value it compares never leaves it (0778)'),
  ('my_org_duties', 'the caller''s own duties'), ('rental_can_approve', 'about the caller'),
  ('staff_leave_may_submit', 'about the caller'), ('staff_leave_recorder_view', 'empty unless the caller records leave'),
  ('ops_stock_plan_has_duty', 'about the caller'),
  ('mark_badge_seen', 'writes the caller''s own row'), ('touch_last_seen', 'writes the caller''s own row'),
  -- yes or no about a user id, with no name and no money
  ('workspace_is_person', 'used by a function that runs as its caller'),
  ('finance_may_request_payment', 'yes or no about a user id'),
  ('purchasing_actor_may_issue', 'yes or no about a user id'),
  ('receiving_posted_authority', 'yes or no about user ids'),
  -- lookups with nothing about a person or a price
  ('_office_is_working_day', 'a date is a working day or not; used by a function that runs as its caller'),
  ('gl_account_for_payment_method', 'an account code; used by a function that runs as its caller'),
  ('resolve_demand_category', 'a SKU''s category; used by a function that runs as its caller'),
  ('stock_sku_category', 'a SKU''s category; used by a view'),
  -- retired: the body only raises
  ('operation_adjust_stock', 'retired, raises'), ('purchasing_set_purpose_approval', 'retired, raises'),
  ('sales_order_apply_amendment', 'not built, raises')
)
select c.proname || '(' || pg_get_function_identity_arguments(c.oid) || ')' as function_that_never_asks
  from candidate c
 where c.oid not in (select root from asked_through_a_callee)
   and c.proname not in (select name from accepted)
 order by 1;


-- ── 4 · A buying-side table that has lost its rule ──────────────────────────
-- Owner, 16 Nov 2026: what Carres pays and who Carres buys from are for
-- principal, operation and finance. Nobody who sells sees them: not a store
-- login, and not bd. Row-level security chooses rows, never columns, so every
-- table below carries one RESTRICTIVE policy, cost_and_supplier_are_internal
-- (0780): an active Carres or store account touches it only if sees_cost().
-- On the six a store needs in order to sell there is one more way through,
-- the Carres API, which leaves the cost out (0778, 0779;
-- apps/api/src/lib/api-door.ts).
--
-- The list is 0780's. A later migration that drops the policy from one of
-- these, or turns row-level security off, shows here.
with through_the_api(name) as (values
  ('product_skus'), ('catalog_fabrics'), ('sofa_combo_pricing'), ('special_addons'),
  ('purchasing_settings'), ('order_supplier_threads')
), buying_side(name) as (values
  ('suppliers'), ('sku_supplier_offers'), ('purchasing_production_days'), ('purchasing_supplier_settings'),
  ('purchasing_setting_changes'), ('purchase_snoozes'),
  ('purchase_requests'), ('purchase_request_events'), ('purchase_request_new_models'),
  ('purchase_requests_checkpoint_a'), ('forecast_purchase_requests'), ('purchase_demands'),
  ('purchase_orders'), ('purchase_order_lines'), ('po_line_sources'), ('po_history'), ('po_revisions'),
  ('po_version_documents'), ('po_sends'), ('po_email_attempts'), ('po_email_attempt_documents'),
  ('po_supplier_promises'), ('po_supplier_answer_screenshots'), ('po_arrival_confirmations'),
  ('po_change_requests'), ('po_cost_approvals'), ('po_goods_cancellation_events'), ('po_pickup_events'),
  ('po_receipts'),
  ('warehouse_receipts'), ('receiving_events'), ('receiving_unit_results'),
  ('arrival_sources'), ('arrival_source_events'), ('arrival_source_units'),
  ('supplier_claims'), ('supplier_claim_replies'),
  ('purchase_returns'), ('purchase_return_units'), ('purchase_return_pickup_confirmations'),
  ('purchase_return_supplier_receipts'), ('purchase_return_supplier_receipt_units'),
  ('supplier_return_handovers'),
  ('repair_orders'), ('repair_order_units'), ('repair_order_supplier_replies'), ('repair_order_owner_consents'),
  ('supplier_bills'), ('supplier_bill_lines'), ('supplier_bill_foreign_amounts'),
  ('supplier_credit_notes'), ('supplier_credit_note_lines'), ('supplier_credit_note_applications'),
  ('supplier_debit_notes'), ('supplier_debit_note_lines'),
  ('supplier_note_followups'), ('supplier_note_followup_contacts'), ('supplier_note_followup_settlements'),
  ('supplier_advance_applications'), ('supplier_advance_money_back'),
  ('payment_vouchers'), ('payment_voucher_lines'), ('payment_voucher_allocations'),
  ('payment_voucher_debit_note_allocations'), ('payment_voucher_opening_allocations'),
  ('finance_supplier_profiles'), ('fin_party_codes'), ('ap_document_events'), ('ap_document_files'),
  ('order_line_costs'), ('fin_opening_stock'), ('catalog_config_history'), ('service_cases'),
  ('ops_stock_items'), ('ops_stock_items_seed_backup_20260711'), ('ops_sofa_loans'),
  ('rental_plans'), ('rental_offers'), ('rental_agreements'), ('rental_billings')
), listed as (
  select name, true as through_the_api from through_the_api
  union all
  select name, false from buying_side
)
select l.name as table_name,
       case
         when c.oid is null then 'the table is gone: take it off this list and 0780''s successor'
         when not c.relrowsecurity then 'row-level security is off'
         when p.policyname is null then 'the policy cost_and_supplier_are_internal is missing'
         when p.permissive <> 'RESTRICTIVE' or p.cmd <> 'ALL' then 'the policy is no longer restrictive for all'
         when p.qual !~ 'sees_cost\(\)' or p.qual !~ 'is_carres_or_seller\(\)' then 'the policy no longer asks sees_cost()'
         when l.through_the_api and p.qual !~ 'is_through_carres_api\(\)' then 'a store can no longer read it through the API'
         when not l.through_the_api and p.qual ~ 'is_through_carres_api\(\)' then 'it is open through the API and should not be'
       end as finding
  from listed l
  left join pg_class c on c.relname = l.name and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  left join pg_policies p on p.schemaname = 'public' and p.tablename = l.name
                         and p.policyname = 'cost_and_supplier_are_internal'
 where c.oid is null or not c.relrowsecurity or p.policyname is null
    or p.permissive <> 'RESTRICTIVE' or p.cmd <> 'ALL'
    or p.qual !~ 'sees_cost\(\)' or p.qual !~ 'is_carres_or_seller\(\)'
    or (l.through_the_api and p.qual !~ 'is_through_carres_api\(\)')
    or (not l.through_the_api and p.qual ~ 'is_through_carres_api\(\)')
union all
-- the two functions 0780 changed, read off their source
select 'catalog_fabrics_set_cost', 'it no longer asks sees_cost()'
 where not exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                    where n.nspname = 'public' and f.proname = 'catalog_fabrics_set_cost'
                      and f.prosrc ~ 'sees_cost\(\)' and f.prosrc !~ 'is_internal\(\)')
union all
select 'create_rental_agreement', 'it hands the supplier''s share back to an account that does not see cost'
 where not exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                    where n.nspname = 'public' and f.proname = 'create_rental_agreement'
                      and position('to_jsonb(v_agreement) - ''supplier_rate_pct''' in f.prosrc) > 0)
 order by 1;


-- ── 5 · A NEW table that names a cost or a supplier and has no rule ─────────
-- Read off the shape: a column whose name says cost or supplier, or a foreign
-- key to a supplier, a purchase order, a supplier's bill or a payment voucher.
-- A table this reports either joins block 4's list with the policy
--   create policy cost_and_supplier_are_internal on public.<table>
--     as restrictive for all to authenticated
--     using ((select public.sees_cost()) or not (select public.is_carres_or_seller()));
-- or joins the short list below with the reason it is not buying-side.
with reviewed(name, why) as (values
  ('app_users',                       'supplier_id is a supplier login''s own link; an account reads its own row'),
  ('issue_money_links',               'cost_bearer_id is who bears an issue''s cost, not what Carres pays a supplier'),
  ('payment_requests',                'staff ask Finance to pay a bill; bd and hr use it, through functions'),
  ('dealer_commission_payments',      'what a dealer is paid, which the dealer sees'),
  ('dealer_commission_close_dealers', 'what a dealer is paid, which the dealer sees'),
  ('payments',                        'the old payments table, empty; if it is used again for money out it joins block 4')
)
select c.relname as table_with_no_rule,
       (select string_agg(a.attname, ', ' order by a.attnum)
          from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           and a.attname ~* '(cost|cogs|margin|supplier|buy_price|purchase_price|landed|markup|factory|vendor)') as columns_that_name_one,
       (select string_agg(distinct con.confrelid::regclass::text, ', ')
          from pg_constraint con
         where con.contype = 'f' and con.conrelid = c.oid
           and con.confrelid::regclass::text in ('suppliers', 'purchase_orders', 'purchase_order_lines', 'purchase_demands',
               'purchase_requests', 'supplier_claims', 'purchase_returns', 'repair_orders', 'warehouse_receipts',
               'supplier_bills', 'supplier_credit_notes', 'supplier_debit_notes', 'payment_vouchers',
               'sku_supplier_offers')) as points_at
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
   and (exists (select 1 from pg_attribute a
                 where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                   and a.attname ~* '(cost|cogs|margin|supplier|buy_price|purchase_price|landed|markup|factory|vendor)')
        or exists (select 1 from pg_constraint con
                    where con.contype = 'f' and con.conrelid = c.oid
                      and con.confrelid::regclass::text in ('suppliers', 'purchase_orders', 'purchase_order_lines',
                          'purchase_demands', 'purchase_requests', 'supplier_claims', 'purchase_returns', 'repair_orders',
                          'warehouse_receipts', 'supplier_bills', 'supplier_credit_notes', 'supplier_debit_notes',
                          'payment_vouchers', 'sku_supplier_offers')))
   and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname
                      and p.policyname = 'cost_and_supplier_are_internal')
   and c.relname not in (select name from reviewed)
 order by 1;
