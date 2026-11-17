-- Carres engine database: the Owner role also approves product requests and payment backdate requests (owner
-- decision 17 Nov 2026, "Give both to Owner").
--
-- WHY. At Houzs these two approvals sit with Purchaser (scm.product_request.approve) and Logistic
-- (scm.payment.backdate.approve). No Carres account holds either role, so a new product request notified nobody:
-- productRequestNotify.ts sends only to roles that list the key by name, never to "*". (The backdate notice already
-- reaches "*" holders by its own rule; naming the key adds nobody new and is deduplicated there.)
--
-- WHAT. Adds the two keys to the role named "Owner", keeping "*" and every key already there (2018 added Houzs's
-- eight). No other role, user or page access is touched.
--
-- RE-RUN: safe; a second run changes nothing. No row count is asserted.
-- REVERSAL: remove the two keys from the Owner role on Access & Roles or by hand.

update public.roles r
   set permissions = (
         select jsonb_agg(k order by k)::text
           from (
             select distinct k
               from (
                 select jsonb_array_elements_text(coalesce(nullif(r.permissions, '')::jsonb, '[]'::jsonb)) as k
                 union all
                 select unnest(array['scm.product_request.approve', 'scm.payment.backdate.approve'])
               ) all_keys
           ) merged
       )
 where r.name = 'Owner'
   and not (coalesce(nullif(r.permissions, '')::jsonb, '[]'::jsonb)
            ?& array['scm.product_request.approve', 'scm.payment.backdate.approve']);
