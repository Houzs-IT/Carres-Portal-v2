-- =============================================================================
-- 0779 · A store reads the product tables only through the Carres API
--
-- Owner: 16 Nov 2026. What Carres pays for an item and who Carres buys it from
-- are for Carres's internal roles. A store login (dealer, salesperson,
-- showroom) sells; it never sees them.
--
-- WHAT IS TRUE BEFORE THIS FILE (0776)
--   Five tables answer every active Carres and store account, because a store
--   needs them to sell: product_skus, catalog_fabrics, sofa_combo_pricing,
--   special_addons, purchasing_settings. Four of them also hold a cost, a
--   supplier or the supplier's own item code. Row-level security chooses rows,
--   never columns.
--
-- WHAT THIS CHANGES
--   1. Those five tables answer
--        - Carres's internal roles (principal, operation, finance, bd), as now;
--        - any other active Carres or store account ONLY when the request came
--          through the Carres API (0778). The API opens that door on the
--          routes a store sells through, and removes cost and supplier from
--          what it sends back.
--      A store's own direct read finds no rows. Nothing a store does through
--      the API changes: same routes, same prices, same orders.
--   2. A store's read of its own orders' supplier threads gets the same
--      condition, and now also asks that the account is active. No route a
--      store calls reads that table.
--
-- WHO IS NOT AFFECTED
--   Internal roles (their branch has no condition), the service key, scheduled
--   jobs, and every function that runs as its owner.
--
-- APPLIED ONLY AFTER the deployed API answers GET /health/api-door with ok:
-- from then on its requests carry the header these policies ask for.
-- =============================================================================

alter policy product_skus_read on public.product_skus
  using ((select public.is_internal())
         or ((select public.is_carres_or_seller()) and (select public.is_through_carres_api())));

alter policy catalog_fabrics_read on public.catalog_fabrics
  using ((select public.is_internal())
         or ((select public.is_carres_or_seller()) and (select public.is_through_carres_api())));

alter policy sofa_combo_pricing_read on public.sofa_combo_pricing
  using ((select public.is_internal())
         or ((select public.is_carres_or_seller()) and (select public.is_through_carres_api())));

alter policy special_addons_read on public.special_addons
  using ((select public.is_internal())
         or ((select public.is_carres_or_seller()) and (select public.is_through_carres_api())));

alter policy purchasing_settings_read on public.purchasing_settings
  using ((select public.is_internal())
         or ((select public.is_carres_or_seller()) and (select public.is_through_carres_api())));

alter policy ost_dealer_read on public.order_supplier_threads
  using ((select public.is_carres_or_seller())
         and (select public.is_through_carres_api())
         and exists (select 1
                       from public.orders o
                      where o.id = order_supplier_threads.order_id
                        and o.dealer_id = (select public.app_dealer_id())));

-- Every policy that lets a signed-in account READ one of the five tables must
-- now be one of: internal roles, the principal, or "through the Carres API".
-- A policy added later that forgets the condition fails here on the next file
-- that touches these tables, and in scripts/check-open-access.sql.
do $check$
declare
  still text;
begin
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
    into still
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('product_skus', 'catalog_fabrics', 'sofa_combo_pricing', 'special_addons', 'purchasing_settings')
     and p.cmd in ('SELECT', 'ALL')
     and p.permissive = 'PERMISSIVE'
     and not (
           p.qual ~ 'is_through_carres_api\(\)'
        or p.qual ~ '^\s*\(?\s*\(?\s*SELECT\s+(public\.)?is_(internal|principal)\(\)'
     );
  if still is not null then
    raise exception 'A read policy on a product table answers a store without the Carres API: %', still;
  end if;

  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = 'order_supplier_threads'
                    and p.policyname = 'ost_dealer_read' and p.qual ~ 'is_through_carres_api\(\)') then
    raise exception 'ost_dealer_read does not ask whether the request came through the Carres API';
  end if;
end
$check$;
