-- =============================================================================
-- 0777 · History rows and internal functions ask who is calling
--
-- Owner: approved in conversation, 15 Nov 2026, as part of the same access
-- repair as 0776. Found while verifying 0776.
--
-- WHAT WAS WRONG
--   The mistake 0776 closed on reads, on the other two doors of the data API.
--   1. Three INSERT policies (audit_log, order_history, po_history) asked only
--      whether the account was signed in.
--   2. A function in `public` can be called by name through the data API by
--      every role that may execute it, and a new function is executable by
--      every signed-in account unless a migration says otherwise. A function
--      that runs as its owner (SECURITY DEFINER) reads and writes past
--      row-level security, so it must ask who is calling. Some did not: four
--      that the app calls for its users, and thirty-four that only other
--      functions are meant to call.
--
-- WHAT THIS CHANGES
--   1. The three INSERT policies ask is_carres_or_seller().
--   2. dealers_with_stats_list, dealer_with_stats,
--      rental_current_agreement_template and order_stamp_stair_carry answer
--      the roles the app calls them for, and the server. Nothing else in their
--      bodies moves; the first two also gain a fixed search_path.
--   3. The thirty-four stop being callable by anon and authenticated.
--      Functions that run as their owner still call them, and so does the
--      service key. None is called by name from apps/, none is used by a
--      policy, a view, a constraint or a function that runs as its caller,
--      and the two that are column defaults sit on tables no signed-in
--      account inserts into directly.
-- =============================================================================

-- ── 1 · is this the server, or a signed-in person? ──────────────────────────
-- A request through the data API carries a role: anon, authenticated or
-- service_role. A direct database session (a migration, a scheduled job)
-- carries none. Only anon and authenticated are people.

create or replace function public.is_server_call()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select coalesce(auth.role(), '') not in ('anon', 'authenticated')
$function$;

comment on function public.is_server_call() is
  'True when the caller is not a person: the service key, or a direct database session. A SECURITY DEFINER function that the app also runs from the server asks (is_internal() or is_server_call()) rather than refusing its own scheduled jobs (0777).';

revoke all on function public.is_server_call() from public, anon;
grant execute on function public.is_server_call() to authenticated, service_role;

-- ── 2 · history and audit rows are written by Carres and seller accounts ────

drop policy if exists audit_self_insert on public.audit_log;
create policy audit_self_insert on public.audit_log
  for insert to authenticated with check ((select public.is_carres_or_seller()));

drop policy if exists order_history_insert on public.order_history;
create policy order_history_insert on public.order_history
  for insert to authenticated with check ((select public.is_carres_or_seller()));

drop policy if exists po_history_insert on public.po_history;
create policy po_history_insert on public.po_history
  for insert to authenticated with check ((select public.is_carres_or_seller()));

-- ── 3 · four functions the app calls for its users ──────────────────────────

-- 3a · every store with its sales: the two Dealers pages (principal, bd).
create or replace function public.dealers_with_stats_list()
 returns table(id uuid, name text, region text, contact text, status dealer_status, joined_date date, credit_limit numeric, payment_terms text, deposit_balance numeric, order_count bigint, gmv numeric, outstanding numeric)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select d.id, d.name, d.region, d.contact, d.status, d.joined_date,
         d.credit_limit, d.payment_terms, d.deposit_balance,
         coalesce(s.order_count, 0)::bigint,
         coalesce(s.gmv, 0)::numeric,
         coalesce(s.outstanding, 0)::numeric
    from dealers d
    left join lateral (
      select count(*) as order_count,
             coalesce(sum(line_total + addon_total), 0) as gmv,
             coalesce(sum(greatest(0, (line_total + addon_total) - o.paid)), 0) as outstanding
        from orders o
        left join lateral (select coalesce(sum(unit_price * qty), 0) as line_total
                             from order_lines where order_id = o.id) ol on true
        left join lateral (select coalesce(sum(unit_price * qty), 0) as addon_total
                             from order_addons where order_id = o.id) oa on true
        where o.dealer_id = d.id
          and o.status <> 'cancelled'
    ) s on true
    where d.status <> 'rejected'
      and ((select public.is_internal()) or (select public.is_server_call()))
    order by d.name;
$function$;

-- 3b · one store with its sales: the same pages, and a store reading itself.
create or replace function public.dealer_with_stats(p_id uuid)
 returns table(id uuid, name text, region text, contact text, status dealer_status, joined_date date, credit_limit numeric, payment_terms text, deposit_balance numeric, order_count bigint, gmv numeric, outstanding numeric)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select d.id, d.name, d.region, d.contact, d.status, d.joined_date,
         d.credit_limit, d.payment_terms, d.deposit_balance,
         coalesce(s.order_count, 0)::bigint,
         coalesce(s.gmv, 0)::numeric,
         coalesce(s.outstanding, 0)::numeric
    from dealers d
    left join lateral (
      select count(*) as order_count,
             coalesce(sum(line_total + addon_total), 0) as gmv,
             coalesce(sum(greatest(0, (line_total + addon_total) - o.paid)), 0) as outstanding
        from orders o
        left join lateral (select coalesce(sum(unit_price * qty), 0) as line_total
                             from order_lines where order_id = o.id) ol on true
        left join lateral (select coalesce(sum(unit_price * qty), 0) as addon_total
                             from order_addons where order_id = o.id) oa on true
        where o.dealer_id = d.id
          and o.status <> 'cancelled'
    ) s on true
   where d.id = p_id
     and ((select public.is_internal())
          or (select public.is_server_call())
          or ((select public.is_carres_or_seller()) and d.id = (select public.app_dealer_id())));
$function$;

-- 3c · the agreement wording a store shows a customer.
create or replace function public.rental_current_agreement_template(p_doc_key text default 'rent_to_own'::text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  -- The full row shape, so the API can feed it straight to the existing
  -- `rentalAgreementTemplateFromRow` adapter instead of growing a second,
  -- near-identical domain type for "the current one".
  SELECT to_jsonb(t)
    FROM (
      SELECT id, doc_key, name, binds_to, version, body, fields, effective_from,
             active, created_at, updated_at, updated_by
        FROM public.rental_agreement_templates
       WHERE doc_key = coalesce(nullif(btrim(p_doc_key), ''), 'rent_to_own')
         AND active
         AND effective_from <= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
         AND ((SELECT public.is_carres_or_seller()) OR (SELECT public.is_server_call()))
       ORDER BY version DESC
       LIMIT 1
    ) t;
$function$;

-- 3d · the stair carry fee on an order: whoever may edit that order.
-- order_stamp_stair_carry_pinned (0414) ends by calling this, in the same
-- statement, so a refusal here also undoes the rate it had just pinned.
create or replace function public.order_stamp_stair_carry(p_order_id uuid, p_fee numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_exists boolean;
begin
  if p_fee is null or p_fee < 0 then
    raise exception 'stair carry fee must be a non-negative number'
      using errcode = '22023', detail = 'bad_fee';
  end if;

  -- 0777: Carres's internal roles, the store the order belongs to, and the
  -- server. Asked before the order is looked up, so the answer never says
  -- whether an id exists.
  if not (public.is_server_call()
          or public.is_internal()
          or (public.is_carres_or_seller()
              and exists (select 1 from public.orders o
                           where o.id = p_order_id
                             and o.dealer_id = public.app_dealer_id()))) then
    raise exception 'forbidden: this order is not yours to change'
      using errcode = '42501', detail = 'forbidden';
  end if;

  select exists (select 1 from public.orders o where o.id = p_order_id) into v_exists;
  if not v_exists then
    raise exception 'Order not found' using errcode = '42P01';
  end if;

  -- Delete-then-insert, so the function is idempotent and can never leave two
  -- rows for one fee. `order_addons` has no natural unique key on
  -- (order_id, addon_key) — several service add-ons of the same kind are legal
  -- — so an upsert is not available and this is the honest equivalent.
  delete from public.order_addons
   where order_id = p_order_id
     and addon_key = 'STAIR_CARRY';

  if p_fee > 0 then
    insert into public.order_addons (order_id, addon_key, qty, unit_price, attrs)
    values (p_order_id, 'STAIR_CARRY', 1, p_fee, null);
  end if;
end;
$function$;

-- ── 4 · thirty-four functions only other functions call ─────────────────────

do $internal$
declare
  r record;
  still text;
  names text[] := array[
    '_activity_log_order_id_from_ref', '_commission_assert_order_month_open', '_ola_field_changed',
    '_operation_auto_dispatch_if_ready', '_operation_release_order_reserve', '_v3_claim_threads_for_po',
    'allocate_formal_document_code', 'ap_refuse_before_go_live', 'consignment_return_unit_refusal',
    'fin_line_project', 'gen_guarantee_id', 'gl_account_section', 'gl_ar_control_account',
    'gl_income_account_for', 'is_operations_superuser', 'next_case_no', 'next_sn_no',
    'operation_calc_shortages', 'operation_pick_warehouse', 'ops_person_is_in_today',
    'ops_rollup_stock_balances', 'order_partner_advance', 'purchase_return_unit_refusal',
    'purchasing_check_line_commercials', 'purchasing_default_destination',
    'purchasing_po_effective_arrival', 'purchasing_po_expected_arrivals', 'receiving_receiver_of',
    'receiving_unit_lock_reason', 'repair_order_unit_refusal', 'sales_order_contractual_hash',
    'sales_order_snapshot', 'warehouse_holds_capability', 'warehouse_is_person'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(names)
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname)
    into still
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(names)
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if still is not null then
    raise exception 'Still callable by a signed-in account: %', still;
  end if;
end
$internal$;
