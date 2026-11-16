-- Carres engine database: Carres's card machines, each on its own clearing account, an approval code on every
-- card payment, and customer credit notes on 520-0000 (Chew, 16 Nov 2026; docs/finance/MASTER.md §0.0 rulings 4
-- and 9, §0 "How money is recorded", §3.1).
--
-- WHY. The engine came with Houzs's merchant list (MBB, CIMB, Public, HLB, RHB, Bank Islam, BSN, Alliance, AmBank,
-- Pinelabs, AEON, HSBC) and no card company set up, so every card payment would post to the "machine not known"
-- account. Carres has five machines: PBB, GHL, HLBB, MBB and AhaPay. A card payment's proof is its approval code;
-- Houzs lets a payment be saved without one.
--
-- WHAT.
--   1 Sales Order payment "Merchant" list (Settings > SO Maintenance): PBB, GHL, HLBB, MBB, AhaPay active, in that
--     order; every other merchant row switched off (rows are kept, so nothing that names them breaks).
--   2 Card companies (Finance > Merchant reports setup): one per machine, each on its own clearing account
--     (315-1000 PBB, 315-2000 GHL, 315-3000 HLBB, 315-4000 MBB, 315-6000 AhaPay), its charges on 902-0000 BANK
--     CHARGES, paid out into 310-2000 HONG LEONG BANK. Statement formats are left for Finance to set when a sample
--     report is in hand. "Public" and "HLB" are kept as other names of PBB and HLBB, the words Houzs's list used.
--     Written only when those accounts are on the chart.
--   3 The database refuses a card payment (method merchant or installment) on a Sales Order or a Sales Invoice
--     without an approval code, whichever door saves it. An existing row is checked only when its method or code
--     is changed. Cheque stays under Online: it posts to the bank either way.
--   4 A customer credit note line that names no account posts to 520-0000 DISCOUNT ALLOWED (the SALES_RETURNS role;
--     Houzs's is 510-0000 RETURN INWARDS). An invoiced order is refunded through such a note, not by cancelling
--     its invoice (backend carres/credited-refund.ts). Written only when 520-0000 is on the chart.
--
-- RE-RUN: safe; a second run changes nothing it already set. No row count is asserted.
-- REVERSAL: switch the merchant rows back in SO Maintenance; drop the two triggers and
--           scm.carres_card_payment_needs_code(); delete the five card companies; set SALES_RETURNS back to 510-0000.

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres card machines: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;

-- 1 . The Merchant list on a Sales Order payment
insert into scm.so_dropdown_options (company_id, category, value, label, sort_order, active)
select c.id, 'payment_merchant', v.value, v.label, v.sort_order, true
  from public.companies c
 cross join (values ('PBB', 'PBB', 1), ('GHL', 'GHL', 2), ('HLBB', 'HLBB', 3), ('MBB', 'MBB', 4), ('AhaPay', 'AhaPay', 5))
       as v(value, label, sort_order)
 where c.code = 'HOUZS'
on conflict (company_id, category, value) do update
   set label = excluded.label, sort_order = excluded.sort_order, active = true;

update scm.so_dropdown_options o
   set active = false
  from public.companies c
 where c.code = 'HOUZS' and o.company_id = c.id and o.category = 'payment_merchant'
   and o.value not in ('PBB', 'GHL', 'HLBB', 'MBB', 'AhaPay')
   and o.active;

-- 2 . One card company per machine, on its own clearing account
insert into scm.acc_acquirer_config (code, display_name, so_names, is_active)
values ('PBB', 'PBB', array['Public'], true),
       ('GHL', 'GHL', '{}', true),
       ('HLBB', 'HLBB', array['HLB'], true),
       ('MBB', 'MBB', '{}', true),
       ('AHAPAY', 'AhaPay', '{}', true)
on conflict (code) do nothing;

insert into scm.acc_company_acquirers (company_id, acquirer_code, transit_account_code, fee_account_code, bank_account_code, is_active)
select c.id, v.code, v.transit, '902-0000', '310-2000', true
  from public.companies c
 cross join (values ('PBB', '315-1000'), ('GHL', '315-2000'), ('HLBB', '315-3000'), ('MBB', '315-4000'), ('AHAPAY', '315-6000'))
       as v(code, transit)
 where c.code = 'HOUZS'
   and exists (select 1 from scm.accounts a where a.company_id = c.id and a.account_code = v.transit and a.is_active)
   and exists (select 1 from scm.accounts a where a.company_id = c.id and a.account_code = '902-0000' and a.is_active)
   and exists (select 1 from scm.accounts a where a.company_id = c.id and a.account_code = '310-2000' and a.is_active)
on conflict (company_id, acquirer_code) do nothing;

-- 3 . No card payment without its approval code
create or replace function scm.carres_card_payment_needs_code() returns trigger
language plpgsql as $fn$
begin
  if lower(coalesce(new.method, '')) in ('merchant', 'installment')
     and coalesce(btrim(new.approval_code), '') = ''
     and (tg_op = 'INSERT'
          or new.method is distinct from old.method
          or new.approval_code is distinct from old.approval_code) then
    raise exception 'A card payment needs its approval code. Type the code printed on the card terminal receipt.'
      using errcode = '23514';
  end if;
  return new;
end
$fn$;

drop trigger if exists carres_card_payment_needs_code on scm.mfg_sales_order_payments;
create trigger carres_card_payment_needs_code
  before insert or update of method, approval_code on scm.mfg_sales_order_payments
  for each row execute function scm.carres_card_payment_needs_code();

drop trigger if exists carres_card_payment_needs_code on scm.sales_invoice_payments;
create trigger carres_card_payment_needs_code
  before insert or update of method, approval_code on scm.sales_invoice_payments
  for each row execute function scm.carres_card_payment_needs_code();

-- 4 . Customer credit notes default to 520-0000 DISCOUNT ALLOWED
insert into scm.acc_account_roles (company_id, role, account_code)
select a.company_id, 'SALES_RETURNS', a.account_code
  from scm.accounts a
  join public.companies c on c.id = a.company_id and c.code = 'HOUZS'
 where a.account_code = '520-0000' and a.is_active
on conflict (company_id, role) do update set account_code = excluded.account_code, updated_at = now()
 where scm.acc_account_roles.account_code is distinct from excluded.account_code;
