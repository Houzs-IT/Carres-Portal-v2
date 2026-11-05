-- 0770_a_sales_order_line_keeps_the_cost_it_was_priced_at.sql
-- ===========================================================================
-- Product Profit follows Houzs (YH, chat, 3 Nov 2026: "all follow houzs").
-- Houzs writes the unit cost on the sales order line when the line is priced
-- and Product Profit reads that cost, not today's catalog cost
-- [code: Houzs-ERP backend/src/acc/performance-pnl.ts:137-142,
--        backend/src/acc/product-profit.ts:119].
--
-- Carres order_lines has no cost (0001). The cost lives in its own table
-- so the order_lines grants (dealers and delivery partners read their lines,
-- 0227) never show a cost: only the principal reads it, as with
-- product_skus.cost (0175).
--
-- The cost is copied from product_skus.cost when a line is inserted and again
-- when its sku or unit_price changes (the line is priced again). A sku with no
-- cost writes NULL, so the report shows the line as having no cost.
-- Lines placed before this migration have no row; the report falls back to
-- the catalog cost for them.
-- ===========================================================================

begin;

create table public.order_line_costs (
  order_line_id uuid primary key references public.order_lines(id) on delete cascade,
  unit_cost     numeric(12,2),
  priced_at     timestamptz not null default now()
);

alter table public.order_line_costs enable row level security;
revoke all on public.order_line_costs from anon;

create policy order_line_costs_principal_read on public.order_line_costs
  for select to authenticated
  using ((select public.app_role()) = 'principal');

create or replace function public.order_line_keeps_its_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.order_line_costs (order_line_id, unit_cost, priced_at)
  select new.id, (select s.cost from public.product_skus s where s.sku = new.sku), now()
  on conflict (order_line_id) do update
    set unit_cost = excluded.unit_cost, priced_at = excluded.priced_at;
  return new;
end;
$$;

revoke execute on function public.order_line_keeps_its_cost() from public, anon, authenticated;

create trigger order_line_keeps_its_cost
  after insert or update of sku, unit_price on public.order_lines
  for each row execute function public.order_line_keeps_its_cost();

commit;
