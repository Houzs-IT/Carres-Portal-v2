-- 0753 · Projects slice 4: Sales Orders at a fair.
--
-- Weisiang's decision (Mr Lim, 2026-10-22, via YH): clear Carres rules, implement Houzs.
-- Jess was not part of this decision. Follows Houzs scm.mfg_sales_orders.project_id
-- (migrations-pg/0146_scm_so_project_id.sql). An order belongs to at most one project.
-- Operation links and unlinks through one guarded door, so it gains no broad update right
-- on orders and no other order column can change here. Nothing dropped or deleted.

alter table public.orders add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists orders_project_idx on public.orders (project_id) where project_id is not null;
comment on column public.orders.project_id is
  '0753 (Houzs SO project_id): the fair, exhibition or roadshow this order was sold at. Set only by project_link_order.';

-- Link an order to a project, or unlink it with p_project = null.
create or replace function public.project_link_order(p_order uuid, p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_operation() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and archived_at is null) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  update public.orders set project_id = p_project where id = p_order;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.project_link_order(uuid, uuid) from public, anon;
grant execute on function public.project_link_order(uuid, uuid) to authenticated;
