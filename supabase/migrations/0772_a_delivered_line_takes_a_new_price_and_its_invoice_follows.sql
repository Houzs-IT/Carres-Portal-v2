-- 0772_a_delivered_line_takes_a_new_price_and_its_invoice_follows.sql
-- ===========================================================================
-- Price after DO follows Houzs (YH, chat, 3 Nov 2026: "all follow houzs").
--
-- Houzs: a holder of `scm.so.edit_price_after_do` may change the unit price
-- of any SO line a live Delivery Order carries; qty, product and spec stay
-- frozen. The DO line follows, and so does every live Sales Invoice billing
-- it, issued or not: its totals, paid status and revenue entry are re-derived.
-- Refused through a DO with a live Delivery Return. A reason goes on the SO
-- history.
-- [code: Houzs-ERP backend/src/scm/routes/mfg-sales-orders.ts:6798-6870,
--        backend/src/scm/shared/so-after-do-edit.ts:25-31]
--
-- In Carres:
--   · a DO stores no price; its lines are read from order_lines (0356:28-66),
--     so updating order_lines.unit_price IS the DO following;
--   · paid status is worked out live from order_lines (order-money.ts:38-49);
--   · an invoice stores one amount (0001:409). It moves by the line's change
--     (new - old) x qty, and an issued invoice's revenue entry is reversed and
--     posted again from the new amount (gl_reverse, then
--     _sales_invoice_to_ledger, as the void trigger in 0466:711-739 does).
--
-- Overturned Carres rules (Houzs wins, Mr Lim, WhatsApp, 22 Oct 2026; Jess was
-- not part of that ruling):
--   · unit_price is a Class A contract field whose amendment is refused (0334);
--   · an issued invoice is corrected only by void and replace (0429).
--
-- Who may: principal, or the Payment Approver duty holder (or their dated
-- cover), the Carres duty that already corrects money documents (0429:236-249).
-- Houzs has no discount on this door that Carres can map: Carres lines carry no
-- discount (0716:85), so only the unit price moves.
-- ===========================================================================

begin;

create or replace function public.order_line_price_after_do(
  p_line_id uuid,
  p_unit_price numeric,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_duty jsonb := public.workspace_resolve_duty('payment_approver', null);
  v_line order_lines;
  v_order orders;
  v_delta numeric(12,2);
  v_inv invoices;
  v_entry uuid;
  v_invoices text[] := '{}';
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- an unassigned duty resolves a NULL actor: coalesce, or the refusal leaks.
  if not (coalesce(public.app_role() = 'principal', false)
          or (v_uid is not null
              and coalesce(nullif(v_duty->>'actor_user_id', '')::uuid = v_uid, false))) then
    raise exception 'forbidden' using errcode = '42501', detail = 'not_price_after_do';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'unit price must be zero or more' using errcode = '22023', detail = 'invalid_price';
  end if;

  select * into v_line from order_lines where id = p_line_id for update;
  if not found then
    raise exception 'line not found' using errcode = '22023', detail = 'line_not_found';
  end if;
  select * into v_order from orders where id = v_line.order_id for update;

  if not exists (select 1 from ops_delivery_orders d
                  where d.order_id = v_order.id and d.voided_at is null) then
    raise exception 'this order has no live Delivery Order' using errcode = '22023', detail = 'no_delivery_order';
  end if;
  if exists (select 1 from delivery_returns r
               join ops_delivery_orders d on d.id = r.delivery_order_id and d.voided_at is null
              where r.order_id = v_order.id) then
    raise exception 'a Delivery Return exists on this order' using errcode = '22023', detail = 'delivery_returned';
  end if;

  v_delta := round((p_unit_price - v_line.unit_price) * v_line.qty, 2);
  if v_delta = 0 then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  update order_lines set unit_price = p_unit_price where id = v_line.id;

  for v_inv in
    select * from invoices
     where order_id = v_order.id and kind = 'sales' and voided_at is null
     for update
  loop
    if v_inv.amount + v_delta < 0 then
      raise exception 'the invoice % would go below zero', coalesce(v_inv.invoice_no, v_inv.id::text)
        using errcode = '22023', detail = 'invoice_below_zero';
    end if;
    update invoices set amount = amount + v_delta where id = v_inv.id;
    if v_inv.status = 'issued' and v_inv.invoice_no is not null then
      select e.id into v_entry from gl_entries e
       where e.source_type = 'SALES_INVOICE' and e.source_doc_no = v_inv.invoice_no
         and e.posted and not e.reversed;
      if v_entry is not null then
        perform public.gl_reverse(v_entry, 'Invoice ' || v_inv.invoice_no || ' repriced after DO');
        perform public._sales_invoice_to_ledger(v_inv.invoice_no);
      end if;
    end if;
    v_invoices := v_invoices || coalesce(v_inv.invoice_no, 'draft');
  end loop;

  insert into order_history (order_id, text, by_role, by_user_id)
  values (v_order.id,
          format('Price changed after DO · %s · RM %s → RM %s%s', v_line.sku, v_line.unit_price, p_unit_price,
                 case when v_reason is null then '' else ': ' || v_reason end),
          coalesce(public.app_role()::text, 'system'), v_uid);

  insert into audit_log (role, actor_text, action, ref)
  values (coalesce(public.app_role()::text, 'system'),
          coalesce((select name from app_users where id = v_uid), 'System'),
          format('Repriced %s on order #%s after DO: RM %s → RM %s', v_line.sku, v_order.so, v_line.unit_price, p_unit_price),
          v_order.id::text);

  return jsonb_build_object('ok', true, 'invoices', to_jsonb(v_invoices));
end;
$fn$;

revoke execute on function public.order_line_price_after_do(uuid, numeric, text) from public, anon;
grant execute on function public.order_line_price_after_do(uuid, numeric, text) to authenticated;

commit;
