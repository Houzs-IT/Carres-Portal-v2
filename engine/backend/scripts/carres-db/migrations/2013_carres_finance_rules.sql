-- Carres engine database: Chew's Finance rules that are settings, not code (16 Nov 2026;
-- docs/finance/MASTER.md §0.0).
--
-- WHY. Chew's chart, posting roles and item groups were loaded into this database on 16 Nov 2026 from Finance
-- (old) (they name staff and directors, so they are not in this public repository). Three more rules are plain
-- settings, kept here so they are applied by the engine deploy and reviewable:
--   1 The Finance role may approve a payment voucher (ruling 8). Houzs gives approving only to Managing Director
--     and full-access roles. The person who prepared a voucher still may not check it (backend carres/pv-preparer.ts).
--   2 A voucher's bank charges post to 902-0000 BANK CHARGES (ruling 1). The BANK_CHARGES role is new
--     (backend acc/rules.ts); without a row it keeps Houzs's 900-B001, which in Chew's chart is a roadshow booth
--     account. Written only when 902-0000 is on the chart.
--   3 The Performance P&L keeps every expense as booked: no fixed operating-expense rate (ruling 7; Houzs's
--     default is 16% of sales in place of 900-O001, an account Chew's chart does not have).
--
-- RE-RUN: safe; a second run changes nothing it already set. No row count is asserted.
-- REVERSAL: Team > Roles & Permissions for 1; delete the BANK_CHARGES row of scm.acc_account_roles for 2;
--           set scm.acc_company_settings.performance_opex_rate_bp back for 3.

-- 1 . The Finance role approves
update public.roles
   set permissions = (
         select jsonb_agg(p order by p)::text
           from (select jsonb_array_elements_text(coalesce(permissions, '[]')::jsonb) as p
                 union
                 select 'scm.payment_voucher.approve') s
       )
 where name = 'Finance'
   and not (coalesce(permissions, '[]')::jsonb ? 'scm.payment_voucher.approve');

-- 2 . Bank charges on 902-0000
insert into scm.acc_account_roles (company_id, role, account_code)
select a.company_id, 'BANK_CHARGES', a.account_code
  from scm.accounts a
 where a.account_code = '902-0000' and a.is_active
on conflict (company_id, role) do nothing;

-- 3 . No fixed operating-expense rate on the Performance P&L
insert into scm.acc_company_settings (company_id, performance_opex_rate_bp, updated_at, updated_by)
select c.id, 0, now(), 'migration 2013 (Chew 2026-11-16)'
  from public.companies c
 where c.code = 'HOUZS'
on conflict (company_id) do update
   set performance_opex_rate_bp = 0, updated_at = now(), updated_by = excluded.updated_by
 where scm.acc_company_settings.performance_opex_rate_bp is distinct from 0;
