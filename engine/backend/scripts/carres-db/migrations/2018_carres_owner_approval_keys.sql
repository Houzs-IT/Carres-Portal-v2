-- Carres engine database: the Owner role names the approvals it signs, as Houzs's Owner role does (owner decision
-- 17 Nov 2026, "Yes, same as Houzs").
--
-- WHY. Approval notices (SO amendment lanes, PO amendment, stock in, stock transfer, agreement, fair approval) go to
-- whoever's ROLE lists the key by name; the "*" wildcard is deliberately not counted
-- (backend/src/services/permissionHolders.ts). Carres's Owner role held only "*", so the four Owner accounts could
-- approve everything but were never told anything was waiting, and a price amendment notified nobody at all.
-- Houzs's Owner role carries "*" plus these eight keys (copied in 2010_carres_team.sql's role list).
--
-- WHAT. Adds the eight keys to the role named "Owner", keeping "*" and anything already there. No other role,
-- no user, no page access is touched. carres/sso.ts finds the full-access role by "*", which stays.
--
-- RE-RUN: safe; a second run changes nothing. No row count is asserted.
-- REVERSAL: set the Owner role's permissions back to '["*"]' on Access & Roles or by hand.

update public.roles r
   set permissions = (
         select jsonb_agg(k order by k)::text
           from (
             select distinct k
               from (
                 select jsonb_array_elements_text(coalesce(nullif(r.permissions, '')::jsonb, '[]'::jsonb)) as k
                 union all
                 select unnest(array[
                   'agreement.approve',
                   'projects.approve',
                   'scm.amendment.approve_delivery',
                   'scm.amendment.approve_lines',
                   'scm.amendment.approve_price',
                   'scm.po_amendment.approve',
                   'stock_in.approve',
                   'stock_transfer.approve'
                 ])
               ) all_keys
           ) merged
       )
 where r.name = 'Owner'
   and not (coalesce(nullif(r.permissions, '')::jsonb, '[]'::jsonb) ?& array[
         'agreement.approve',
         'projects.approve',
         'scm.amendment.approve_delivery',
         'scm.amendment.approve_lines',
         'scm.amendment.approve_price',
         'scm.po_amendment.approve',
         'stock_in.approve',
         'stock_transfer.approve'
       ]);
