-- =============================================================================
-- 0780 · An account that does not see cost reads no buying-side table
--
-- Owner: 16 Nov 2026. What Carres pays for an item and who Carres buys it from
-- are for principal, operation and finance. Nobody who sells sees them: not a
-- store login (dealer, salesperson, showroom) and not bd ("Bd also don't need
-- to view").
--
-- WHAT IS TRUE BEFORE THIS FILE
--   bd is one of Carres's internal roles, so every policy written as
--   is_internal() answers it: suppliers, purchase orders and their cost,
--   receiving, supplier claims, purchase returns, repair orders, stock units
--   (each names its supplier), the catalogue's cost history, and the supplier's
--   share of a rental. Its pages use none of these. They place orders and look
--   after stores, through functions that run as their owner.
--
-- WHAT THIS CHANGES
--   1. sees_cost(): an active principal, operation or finance account.
--   2. One more policy on every buying-side table, the same on each, and
--      RESTRICTIVE: it is ANDed with whatever the table already allows, so no
--      existing policy is rewritten and a later one cannot undo it.
--        An active Carres or store account reads or writes the table only if
--        it sees cost.
--      Any other kind of account (a supplier's, a partner's, a warehouse's) is
--      left to the table's own policies, exactly as now.
--   3. The same policy on the six tables a store needs in order to sell (0779),
--      with one more way through: the request came through the Carres API,
--      which leaves the cost out. This is what stops bd reading them directly
--      through the policies written for internal roles.
--   4. catalog_fabrics_set_cost asks sees_cost() instead of is_internal().
--   5. create_rental_agreement hands the supplier's share back only to an
--      account that sees cost. Everyone who may sell still signs a customer up.
--
-- WHO IS NOT AFFECTED
--   principal, operation, finance; the service key; scheduled jobs; and every
--   function that runs as its owner, which is how a store and bd place orders.
--
-- APPLIED ONLY AFTER the deployed API treats bd as a role that does not see
-- cost: from then on its catalogue and order requests come through the API
-- with the header (3) asks for.
-- =============================================================================

-- ── 1 · who sees cost ───────────────────────────────────────────────────────

create or replace function public.sees_cost()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    (select role from public.app_users
      where id = auth.uid() and status = 'active') in
      ('principal', 'operation', 'finance'),
    false
  )
$function$;

comment on function public.sees_cost() is
  'True for an ACTIVE principal, operation or finance account: the roles that see what Carres pays and who Carres buys from (owner, 16 Nov 2026). Everyone who sells is left out, bd included. The API''s twin is COST_ROLES in packages/shared/src/cost-visibility.ts (0780).';

revoke all on function public.sees_cost() from public, anon;
grant execute on function public.sees_cost() to authenticated, service_role;

-- ── 2 and 3 · the one extra policy ──────────────────────────────────────────
-- is_carres_or_seller() is every active Carres and store role (0776). "A
-- Carres or store account that does not see cost" is therefore bd, hr, dealer,
-- salesperson and showroom today, and any role added to the first list before
-- it is added to the second.

do $bar$
declare
  t text;
  -- What a store needs in order to sell. Through the Carres API only (0779).
  through_the_api text[] := array[
    'product_skus', 'catalog_fabrics', 'sofa_combo_pricing', 'special_addons',
    'purchasing_settings', 'order_supplier_threads'
  ];
  -- The buying side: a row here says what Carres pays, or who Carres buys
  -- from, or is part of a document that exists only between Carres and a
  -- supplier.
  buying_side text[] := array[
    -- who Carres buys from, and at what price
    'suppliers', 'sku_supplier_offers', 'purchasing_production_days', 'purchasing_supplier_settings',
    'purchasing_setting_changes', 'purchase_snoozes',
    -- purchase requests, demands and purchase orders
    'purchase_requests', 'purchase_request_events', 'purchase_request_new_models',
    'purchase_requests_checkpoint_a', 'forecast_purchase_requests', 'purchase_demands',
    'purchase_orders', 'purchase_order_lines', 'po_line_sources', 'po_history', 'po_revisions',
    'po_version_documents', 'po_sends', 'po_email_attempts', 'po_email_attempt_documents',
    'po_supplier_promises', 'po_supplier_answer_screenshots', 'po_arrival_confirmations',
    'po_change_requests', 'po_cost_approvals', 'po_goods_cancellation_events', 'po_pickup_events',
    'po_receipts',
    -- receiving
    'warehouse_receipts', 'receiving_events', 'receiving_unit_results',
    'arrival_sources', 'arrival_source_events', 'arrival_source_units',
    -- supplier claims, purchase returns, repair orders
    'supplier_claims', 'supplier_claim_replies',
    'purchase_returns', 'purchase_return_units', 'purchase_return_pickup_confirmations',
    'purchase_return_supplier_receipts', 'purchase_return_supplier_receipt_units',
    'supplier_return_handovers',
    'repair_orders', 'repair_order_units', 'repair_order_supplier_replies', 'repair_order_owner_consents',
    -- what Carres owes and pays its suppliers
    'supplier_bills', 'supplier_bill_lines', 'supplier_bill_foreign_amounts',
    'supplier_credit_notes', 'supplier_credit_note_lines', 'supplier_credit_note_applications',
    'supplier_debit_notes', 'supplier_debit_note_lines',
    'supplier_note_followups', 'supplier_note_followup_contacts', 'supplier_note_followup_settlements',
    'supplier_advance_applications', 'supplier_advance_money_back',
    'payment_vouchers', 'payment_voucher_lines', 'payment_voucher_allocations',
    'payment_voucher_debit_note_allocations', 'payment_voucher_opening_allocations',
    'finance_supplier_profiles', 'fin_party_codes', 'ap_document_events', 'ap_document_files',
    -- cost held beside something else
    'order_line_costs', 'fin_opening_stock', 'catalog_config_history', 'service_cases',
    -- a stock unit names its supplier
    'ops_stock_items', 'ops_stock_items_seed_backup_20260711', 'ops_sofa_loans',
    -- the supplier's share of a rental
    'rental_plans', 'rental_offers', 'rental_agreements', 'rental_billings'
  ];
begin
  foreach t in array through_the_api || buying_side loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise exception '0780: the table % does not exist, so this list is stale', t;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || quote_ident(t))) then
      raise exception '0780: row-level security is off on %, so a policy on it would do nothing', t;
    end if;
    execute format('drop policy if exists cost_and_supplier_are_internal on public.%I', t);
  end loop;

  foreach t in array through_the_api loop
    execute format(
      'create policy cost_and_supplier_are_internal on public.%I as restrictive for all to authenticated '
      || 'using ((select public.sees_cost()) or not (select public.is_carres_or_seller()) '
      || 'or (select public.is_through_carres_api()))', t);
  end loop;

  foreach t in array buying_side loop
    execute format(
      'create policy cost_and_supplier_are_internal on public.%I as restrictive for all to authenticated '
      || 'using ((select public.sees_cost()) or not (select public.is_carres_or_seller()))', t);
  end loop;
end
$bar$;

-- ── 4 · setting a fabric's cost ─────────────────────────────────────────────
-- The body 0202 wrote, with one change: who may. It asked is_internal(), which
-- answers bd.

create or replace function public.catalog_fabrics_set_cost(p_id uuid, p_cost numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_row public.catalog_fabrics;
BEGIN
  IF NOT (SELECT public.sees_cost()) THEN
    RAISE EXCEPTION 'operation/principal only'
      USING ERRCODE = '42501', DETAIL = 'catalog_fabrics_cost_internal_only';
  END IF;
  IF p_cost IS NOT NULL AND p_cost < 0 THEN
    RAISE EXCEPTION 'cost must be a non-negative amount'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.catalog_fabrics
     SET cost       = p_cost,
         updated_at = now(),
         updated_by = (SELECT auth.uid())
   WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fabric not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'cost', v_row.cost);
END;
$function$;

-- ── 5 · signing a customer up for a rental ──────────────────────────────────
-- The function is long and everything else in it stays. One expression
-- changes: the agreement it hands back. (The helper is 0681's: it refuses
-- unless the text to change is there exactly once.)

create or replace function pg_temp.mig0780_rewrite(p_fn regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $rw$
declare
  v_def text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
  v_n   integer;
begin
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  if v_n <> 1 then
    raise exception '0780: % holds the text to change % times, not once: %', p_fn, v_n, left(p_old, 90);
  end if;
  execute replace(v_def, p_old, p_new);
end;
$rw$;

do $rental$
declare
  fn regprocedure :=
    'public.create_rental_agreement(uuid, text, text, text, text, uuid, uuid, date, text, date, text, text, text)'::regprocedure;
begin
  -- A second run of this file finds it already changed and leaves it.
  if position($n$to_jsonb(v_agreement) - 'supplier_rate_pct'$n$ in (select p.prosrc from pg_proc p where p.oid = fn)) > 0 then
    return;
  end if;
  perform pg_temp.mig0780_rewrite(fn,
    $old$to_jsonb(v_agreement),$old$,
    $new$case when (select public.sees_cost()) or (select public.is_server_call())
                            then to_jsonb(v_agreement)
                            else to_jsonb(v_agreement) - 'supplier_rate_pct' end,$new$);
end
$rental$;

-- ── 6 · it is all there ─────────────────────────────────────────────────────

do $check$
declare
  n integer;
  src text;
begin
  select count(*) into n
    from pg_policies p
   where p.schemaname = 'public' and p.policyname = 'cost_and_supplier_are_internal'
     and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL' and p.qual ~ 'sees_cost\(\)';
  if n <> 86 then
    raise exception '0780: % tables carry the policy, not 86', n;
  end if;

  select count(*) into n
    from pg_policies p
   where p.schemaname = 'public' and p.policyname = 'cost_and_supplier_are_internal'
     and p.qual ~ 'is_through_carres_api\(\)';
  if n <> 6 then
    raise exception '0780: % tables are open through the Carres API, not 6', n;
  end if;

  if has_function_privilege('anon', 'public.sees_cost()', 'EXECUTE') then
    raise exception '0780: the public key can call sees_cost()';
  end if;

  select p.prosrc into src from pg_proc p where p.oid = 'public.catalog_fabrics_set_cost(uuid, numeric)'::regprocedure;
  if src !~ 'sees_cost\(\)' or src ~ 'is_internal\(\)' then
    raise exception '0780: catalog_fabrics_set_cost does not ask sees_cost()';
  end if;

  select p.prosrc into src
    from pg_proc p
   where p.oid = 'public.create_rental_agreement(uuid, text, text, text, text, uuid, uuid, date, text, date, text, text, text)'::regprocedure;
  if position($n$to_jsonb(v_agreement) - 'supplier_rate_pct'$n$ in src) = 0 then
    raise exception '0780: create_rental_agreement still hands the supplier''s share to everyone';
  end if;
end
$check$;
