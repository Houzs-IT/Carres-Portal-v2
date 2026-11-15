-- =============================================================================
-- 0776 · Only Carres and seller logins read the catalogue and the settings
--
-- Owner: approved in conversation, 15 Nov 2026.
--
-- WHAT WAS WRONG
--   Twenty-eight read policies asked one question: "is this a signed-in
--   account?" (`auth.uid() is not null` x24, `true` to authenticated x3,
--   `auth.role() = 'authenticated'` x1). A signed-in account is not yet a
--   Carres account. The same answer went to a supplier's, a delivery
--   partner's or a warehouse's login, to a disabled login until its token ran
--   out, and to an account that has no row in app_users at all. The tables are
--   the catalogue with its prices and costs, and the selling and purchasing
--   settings.
--   Two more reads were wider than their purpose: `rental_plans_pos`, a view
--   that runs as its owner and was granted to every signed-in account, and
--   `delivery_partners`, whose read policy named the supplier role. The
--   supplier, warehouse and delivery partner portals were removed on
--   12 Nov 2026.
--
-- WHAT THIS CHANGES: reads only. No write policy, table, column or row moves.
--   1. One helper, is_carres_or_seller(): the account is ACTIVE and its role is
--      principal, operation, finance, bd or hr (Carres), or dealer, salesperson
--      or showroom (the stores that sell). It reads app_users, as is_internal()
--      does, so a disabled account stops at its next query and a role written
--      into a token cannot stand in for the row.
--   2. 25 tables: read = is_carres_or_seller(). These are what the POS and the
--      order edits load (apps/api: routes/catalog.ts, routes/orders.ts,
--      routes/rental.ts, routes/operation/settings-core.ts).
--   3. 2 history tables: read = is_internal(). Only Catalog Maintenance reads
--      them.
--   4. warehouses: Carres's internal roles; a warehouse login, its own site; a
--      delivery partner, a warehouse it owns (the partner purchase order
--      policies ask exactly that).
--   5. delivery_partners: the supplier branch goes.
--   6. rental_plans_pos: the same columns and the same owner-run projection,
--      with the helper in its WHERE.
--   Each replaced policy is now named <table>_read. The old names said
--   "read_all".
--
-- WHO LOSES A READ
--   Supplier, partner and warehouse logins (no app here since 12 Nov 2026: they
--   see "This portal moved"), disabled logins, and accounts with no app_users
--   row. Nobody else: docs/ENGINEERING.md section 3 lists who was measured
--   reading each table.
-- =============================================================================

-- ── 1 · who may read ─────────────────────────────────────────────────────────

create or replace function public.is_carres_or_seller()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    (select role from public.app_users
      where id = auth.uid() and status = 'active') in
      ('principal', 'operation', 'finance', 'bd', 'hr', 'dealer', 'salesperson', 'showroom'),
    false
  )
$function$;

comment on function public.is_carres_or_seller() is
  'True when the caller is an ACTIVE Carres account (principal, operation, finance, bd, hr) or an ACTIVE selling account (dealer, salesperson, showroom). False for supplier, partner and warehouse logins, a disabled login, and an account with no app_users row. Use it, wrapped as (select public.is_carres_or_seller()), where a read policy would otherwise say "any signed-in account" (0776).';

revoke all on function public.is_carres_or_seller() from public, anon;
grant execute on function public.is_carres_or_seller() to authenticated, service_role;

-- ── 2 · the catalogue and the settings the stores sell from ─────────────────

drop policy if exists addons_read_all on public.addons;
drop policy if exists addons_read on public.addons;
create policy addons_read on public.addons
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists address_list_overrides_read on public.address_list_overrides;
create policy address_list_overrides_read on public.address_list_overrides
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists catalog_fabrics_read_all on public.catalog_fabrics;
drop policy if exists catalog_fabrics_read on public.catalog_fabrics;
create policy catalog_fabrics_read on public.catalog_fabrics
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists catalog_option_pools_read_all on public.catalog_option_pools;
drop policy if exists catalog_option_pools_read on public.catalog_option_pools;
create policy catalog_option_pools_read on public.catalog_option_pools
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists company_profile_read on public.company_profile;
create policy company_profile_read on public.company_profile
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists delivery_fee_config_read_all on public.delivery_fee_config;
drop policy if exists delivery_fee_config_read on public.delivery_fee_config;
create policy delivery_fee_config_read on public.delivery_fee_config
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists tier_addon_config_read_all on public.fabric_tier_addon_config;
drop policy if exists fabric_tier_addon_config_read on public.fabric_tier_addon_config;
create policy fabric_tier_addon_config_read on public.fabric_tier_addon_config
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists floor_read_all on public.floor_config;
drop policy if exists floor_config_read on public.floor_config;
create policy floor_config_read on public.floor_config
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists free_item_campaigns_read_all on public.free_item_campaigns;
drop policy if exists free_item_campaigns_read on public.free_item_campaigns;
create policy free_item_campaigns_read on public.free_item_campaigns
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists guarantee_terms_read_all on public.guarantee_terms;
drop policy if exists guarantee_terms_read on public.guarantee_terms;
create policy guarantee_terms_read on public.guarantee_terms
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists model_default_free_gifts_read_all on public.model_default_free_gifts;
drop policy if exists model_default_free_gifts_read on public.model_default_free_gifts;
create policy model_default_free_gifts_read on public.model_default_free_gifts
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists model_tier_overrides_read_all on public.model_fabric_tier_overrides;
drop policy if exists model_fabric_tier_overrides_read on public.model_fabric_tier_overrides;
create policy model_fabric_tier_overrides_read on public.model_fabric_tier_overrides
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists model_sofa_compartments_read_all on public.model_sofa_compartments;
drop policy if exists model_sofa_compartments_read on public.model_sofa_compartments;
create policy model_sofa_compartments_read on public.model_sofa_compartments
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists order_entry_config_read_authenticated on public.order_entry_config;
drop policy if exists order_entry_config_read on public.order_entry_config;
create policy order_entry_config_read on public.order_entry_config
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists product_bundles_read_all on public.product_bundles;
drop policy if exists product_bundles_read on public.product_bundles;
create policy product_bundles_read on public.product_bundles
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists catalog_read_all on public.product_models;
drop policy if exists product_models_read on public.product_models;
create policy product_models_read on public.product_models
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists skus_read_all on public.product_skus;
drop policy if exists product_skus_read on public.product_skus;
create policy product_skus_read on public.product_skus
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists purchasing_settings_read on public.purchasing_settings;
create policy purchasing_settings_read on public.purchasing_settings
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists pwp_rules_read_all on public.pwp_rules;
drop policy if exists pwp_rules_read on public.pwp_rules;
create policy pwp_rules_read on public.pwp_rules
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists sofa_combo_pricing_read_all on public.sofa_combo_pricing;
drop policy if exists sofa_combo_pricing_read on public.sofa_combo_pricing;
create policy sofa_combo_pricing_read on public.sofa_combo_pricing
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists sofa_compartments_read_all on public.sofa_compartments;
drop policy if exists sofa_compartments_read on public.sofa_compartments;
create policy sofa_compartments_read on public.sofa_compartments
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists fabrics_read_all on public.sofa_fabrics;
drop policy if exists sofa_fabrics_read on public.sofa_fabrics;
create policy sofa_fabrics_read on public.sofa_fabrics
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists special_addons_read_all on public.special_addons;
drop policy if exists special_addons_read on public.special_addons;
create policy special_addons_read on public.special_addons
  for select to authenticated using ((select public.is_carres_or_seller()));

drop policy if exists special_delivery_fee_rules_read_all on public.special_delivery_fee_rules;
drop policy if exists special_delivery_fee_rules_read on public.special_delivery_fee_rules;
create policy special_delivery_fee_rules_read on public.special_delivery_fee_rules
  for select to authenticated using ((select public.is_carres_or_seller()));

-- ── 3 · the two histories only Catalog Maintenance reads ────────────────────

drop policy if exists catalog_config_history_read_all on public.catalog_config_history;
drop policy if exists catalog_config_history_read on public.catalog_config_history;
create policy catalog_config_history_read on public.catalog_config_history
  for select to authenticated using ((select public.is_internal()));

drop policy if exists sku_identity_history_read on public.product_sku_identity_history;
drop policy if exists product_sku_identity_history_read on public.product_sku_identity_history;
create policy product_sku_identity_history_read on public.product_sku_identity_history
  for select to authenticated using ((select public.is_internal()));

-- ── 4 · warehouses: Carres, the site's own login, the partner that owns it ──

drop policy if exists warehouses_read_all on public.warehouses;
drop policy if exists warehouses_read on public.warehouses;
create policy warehouses_read on public.warehouses
  for select to authenticated
  using (
    (select public.is_internal())
    or ((select public.app_role()) = 'warehouse'::public.app_role and id = (select public.app_warehouse_id()))
    or ((select public.app_role()) = 'partner'::public.app_role and owning_partner_id = (select public.app_partner_id()))
  );

-- ── 5 · delivery partners: the supplier branch goes ─────────────────────────

drop policy if exists partners_read on public.delivery_partners;
create policy partners_read on public.delivery_partners
  for select to authenticated
  using (
    (select public.is_internal())
    or id = (select public.app_partner_id())
  );

-- ── 6 · the store-facing rental offers: the same projection, for the stores ─
-- Still a definer view on purpose (0255): it shows the stores this column list
-- of an internal-only table. The WHERE now also asks who is reading.

create or replace view public.rental_plans_pos
  with (security_invoker = false) as
  select
    rp.id,
    rp.sku,
    rp.term_months,
    rp.monthly_fee,
    rp.included_package_id,
    sp.name            as package_name,
    sp.service_type    as package_service_type,
    sp.visits_per_year as package_visits_per_year,
    (rp.stripe_price_id is not null) as stripe_ready
  from public.rental_plans rp
  left join public.service_packages sp on sp.id = rp.included_package_id
  where rp.active
    and (select public.is_carres_or_seller());

comment on view public.rental_plans_pos is
  'Store-facing rental offers (0255): active plans only, without the supplier and commission split columns. Definer view: it shows this column list of an internal-only table, and since 0776 only to an active Carres or selling account.';

revoke all on public.rental_plans_pos from anon;
grant select on public.rental_plans_pos to authenticated;

-- ── 7 · no read policy in public still answers "any signed-in account" ──────

do $check$
declare
  still_open text;
begin
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
    into still_open
    from pg_policies
   where schemaname = 'public'
     and permissive = 'PERMISSIVE'
     and cmd in ('SELECT', 'ALL')
     and lower(regexp_replace(qual, '\s+', '', 'g')) in (
           'true',
           '(auth.uid()isnotnull)',
           '((selectauth.uid()asuid)isnotnull)',
           '(auth.role()=''authenticated''::text)',
           '((selectauth.role()asrole)=''authenticated''::text)');
  if still_open is not null then
    raise exception 'A read policy still admits any signed-in account: %', still_open;
  end if;
end
$check$;
