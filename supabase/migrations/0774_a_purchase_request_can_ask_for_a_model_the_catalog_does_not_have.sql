-- 0774_a_purchase_request_can_ask_for_a_model_the_catalog_does_not_have.sql
-- ===========================================================================
-- Product Requests follow Houzs (YH, chat, 3 Nov 2026: "all follow houzs").
--
-- Houzs: a request line names an existing SKU, or the Model the requester
-- wants, by name. The Purchaser approves the request, then builds the Model +
-- SKU for each new-Model line, then raises the PO.
-- [code: Houzs-ERP backend/src/scm/shared/product-request.ts:6-13,63-79;
--        backend/src/scm/routes/product-requests.ts:604,711,761,829]
--
-- In Carres the Manual Purchase request is that request (purchase_requests +
-- purchase_demands). A demand must name a catalog SKU (0401:57-64), so a
-- proposed model waits beside the request in purchase_request_new_models.
-- When the Purchasing Approver has built it in the Catalog, they link its SKU
-- here; that makes the demand line, approved at its asked qty. No PO line may
-- be issued for a request while one of its new models is not built.
--
-- Overturned Carres rule (Houzs wins, Mr Lim, WhatsApp, 22 Oct 2026; Jess was
-- not part of that ruling): every Manual Purchase line is a catalog SKU
-- (0401:57-64, purchasing_create_demand).
-- ===========================================================================

begin;

create table if not exists public.purchase_request_new_models (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.purchase_requests(id) on delete cascade,
  model_name  text not null check (length(btrim(model_name)) between 1 and 160),
  spec        text check (spec is null or length(spec) <= 500),
  qty         int  not null check (qty >= 1),
  asked_by    uuid references public.app_users(id),
  asked_at    timestamptz not null default now(),
  sku         text references public.product_skus(sku),
  demand_id   uuid references public.purchase_demands(id),
  built_by    uuid references public.app_users(id),
  built_at    timestamptz
);
create index if not exists purchase_request_new_models_request_idx
  on public.purchase_request_new_models (request_id);

alter table public.purchase_request_new_models enable row level security;
revoke all on public.purchase_request_new_models from anon;
drop policy if exists purchase_request_new_models_read on public.purchase_request_new_models;
create policy purchase_request_new_models_read on public.purchase_request_new_models
  for select to authenticated
  using (coalesce((select public.app_role())::text in ('operation', 'principal'), false));

-- The requester's ask, while the request still waits for its decision.
create or replace function public.purchasing_request_ask_new_model(
  p_request_id uuid,
  p_model_name text,
  p_spec       text,
  p_qty        int
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_req purchase_requests%rowtype;
  v_id  uuid;
begin
  if not coalesce(public.app_role()::text in ('operation', 'principal'), false) then
    raise exception 'not permitted' using errcode = '42501', detail = 'not_operation';
  end if;
  select * into v_req from purchase_requests where id = p_request_id for update;
  if not found then
    raise exception 'unknown request' using errcode = '22023', detail = 'unknown_request';
  end if;
  if v_req.withdrawn_at is not null or v_req.refused_at is not null or v_req.approved_at is not null then
    raise exception 'this request is already decided' using errcode = '22023', detail = 'request_decided';
  end if;
  if nullif(btrim(coalesce(p_model_name, '')), '') is null then
    raise exception 'name the model' using errcode = '22023', detail = 'model_name_required';
  end if;
  if p_qty is null or p_qty < 1 then
    raise exception 'qty must be at least 1' using errcode = '22023', detail = 'invalid_qty';
  end if;

  insert into purchase_request_new_models (request_id, model_name, spec, qty, asked_by)
  values (p_request_id, btrim(p_model_name), nullif(btrim(coalesce(p_spec, '')), ''), p_qty,
          (select u.id from app_users u where u.id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$fn$;

-- The Purchasing Approver links the SKU they built; the demand line follows.
create or replace function public.purchasing_request_model_built(
  p_new_model_id uuid,
  p_sku          text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_gate   text := (select public.purchasing_approver_gate());
  v_model  purchase_request_new_models%rowtype;
  v_req    purchase_requests%rowtype;
  v_demand uuid;
begin
  select * into v_model from purchase_request_new_models where id = p_new_model_id for update;
  if not found then
    raise exception 'unknown new model' using errcode = '22023', detail = 'unknown_new_model';
  end if;
  if v_model.built_at is not null then
    raise exception 'this model is already built' using errcode = '22023', detail = 'model_already_built';
  end if;
  select * into v_req from purchase_requests where id = v_model.request_id for update;
  if v_req.approved_at is null or v_req.withdrawn_at is not null or v_req.refused_at is not null then
    raise exception 'approve the request first' using errcode = '22023', detail = 'request_not_approved';
  end if;

  -- purchasing_create_demand checks the SKU, derives its supplier and
  -- inherits the header's purpose and destination.
  v_demand := (public.purchasing_create_demand(
    btrim(coalesce(p_sku, '')), v_model.qty, v_req.destination_id, v_req.required_by,
    v_model.model_name || coalesce(' · ' || v_model.spec, ''), v_req.purpose, v_req.id) ->> 'id')::uuid;
  update purchase_demands set approved_qty = v_model.qty where id = v_demand;

  update purchase_request_new_models
     set sku = btrim(p_sku), demand_id = v_demand, built_at = now(),
         built_by = (select u.id from app_users u where u.id = auth.uid())
   where id = v_model.id;
  return v_demand;
end;
$fn$;

-- No PO line for a request that still waits on a model.
create or replace function public.po_line_waits_for_new_models()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.demand_id is not null and exists (
    select 1 from purchase_demands d
      join purchase_request_new_models m on m.request_id = d.request_id and m.built_at is null
     where d.id = new.demand_id) then
    raise exception 'a new model on this request is not built yet'
      using errcode = '22023', detail = 'model_not_built';
  end if;
  return new;
end;
$fn$;

drop trigger if exists po_line_waits_for_new_models on public.purchase_order_lines;
create trigger po_line_waits_for_new_models
  before insert on public.purchase_order_lines
  for each row execute function public.po_line_waits_for_new_models();

revoke all on function public.purchasing_request_ask_new_model(uuid, text, text, int) from public, anon;
revoke all on function public.purchasing_request_model_built(uuid, text) from public, anon;
revoke all on function public.po_line_waits_for_new_models() from public, anon;
grant execute on function public.purchasing_request_ask_new_model(uuid, text, text, int) to authenticated;
grant execute on function public.purchasing_request_model_built(uuid, text) to authenticated;

commit;
