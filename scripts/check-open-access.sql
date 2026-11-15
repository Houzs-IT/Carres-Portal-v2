-- ============================================================================
-- check-open-access.sql · what can a signed-in account reach that nobody meant?
--
-- READ-ONLY. Four questions about the portal database; each answer should be
-- ZERO ROWS. Run each block on its own (Supabase SQL editor, or the MCP's
-- execute_sql). Written 15 Nov 2026 with migrations 0776 and 0777, which
-- closed what the first three found: 31 policies and 38 functions. The fourth
-- came with 0778 and 0779 the next day.
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
  ('is_carres_or_seller', 'about the caller'),
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


-- ── 4 · A table that holds a cost or a supplier and answers a store directly ─
-- Owner, 16 Nov 2026: what Carres pays and who Carres buys from are for
-- Carres's internal roles. Row-level security chooses rows, never columns, so
-- these tables answer an account that is not internal only when the request
-- came through the Carres API, which leaves those columns out (0778, 0779;
-- apps/api/src/lib/api-door.ts). A read policy on one of them must be for
-- internal roles, for the principal, or ask is_through_carres_api().
--
-- A NEW table that holds a cost or a supplier beside something a store needs
-- joins this list and gets the same policy. One a store has no need of is
-- simply internal: (select public.is_internal()).
select p.tablename, p.policyname, p.cmd, p.qual as answers_a_store_without_the_api
  from pg_policies p
 where p.schemaname = 'public'
   and p.tablename in ('product_skus', 'catalog_fabrics', 'sofa_combo_pricing', 'special_addons',
                       'purchasing_settings', 'order_supplier_threads')
   and p.cmd in ('SELECT', 'ALL')
   and p.permissive = 'PERMISSIVE'
   and p.qual !~ 'is_through_carres_api\(\)'
   and p.qual !~ '^\s*\(?\s*\(?\s*SELECT\s+(public\.)?is_(internal|principal)\(\)'
   -- the threads' own rules for operation, the supplier and the delivery partner name a role
   and p.qual !~ 'app_role\(\)'
 order by 1, 2;
