-- 2015 · Carres: customer debtors split by channel (Chew, Finance owner, 2026-11-16:
--        「我还是觉得需要分欠款户口，这样对账全部都比较容易」; Finance MASTER §0.0 ruling 2).
--
-- WHAT
--   A customer's invoice, payment, deposit invoice, credit / debit note, refund and money moved between orders
--   post on the debtor control of the ORDER's channel (backend carres/channel-ar.ts):
--     Subscription order (Sale type Subscription)  →  300-3000 SUBSCRIPTION DEBTORS   (role AR_SUBSCRIPTION)
--     every other order, or no order               →  300-1000 SHOWROOM DEBTORS       (role AR_SHOWROOM)
--   A read that fails books on AR (300-0000 TRADE DEBTORS), where the aging and Self-check still show it.
--   Dealer debtors (300-2000, one account per dealer) wait for dealer orders, which no one can make yet.
--   Each role is written only when its account is on the chart and active.
--
-- RE-RUN: safe; a second run changes nothing it already set. No row count is asserted.
-- REVERSAL: delete the AR_SHOWROOM and AR_SUBSCRIPTION role rows; posting returns to 300-0000 alone.

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres channel debtors: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;

insert into scm.acc_account_roles (company_id, role, account_code)
select a.company_id, r.role, a.account_code
  from (values ('AR_SHOWROOM', '300-1000'), ('AR_SUBSCRIPTION', '300-3000')) as r(role, account_code)
  join scm.accounts a on a.account_code = r.account_code and a.is_active
  join public.companies c on c.id = a.company_id and c.code = 'HOUZS'
on conflict (company_id, role) do update set account_code = excluded.account_code, updated_at = now()
 where scm.acc_account_roles.account_code is distinct from excluded.account_code;
