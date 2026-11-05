-- 0771_a_sofa_fabric_can_be_price_4_full_leather.sql
-- ===========================================================================
-- Sofa Price 3/4 by leather follows Houzs (YH, chat, 3 Nov 2026: "all follow
-- houzs"). Houzs adds PRICE_4 to the fabric tier: Price 3 is Half Leather,
-- Price 4 Full Leather; bedframe stays at three tiers
-- [code: Houzs-ERP backend/src/db/migrations-pg/20261028T1600_scm_fabric_price_tier_p4.sql:16,
--        docs/modules/fabric-tracking.md:28].
--
-- Carres keeps the tier on catalog_fabrics.sofa_tier (0202:42). Only that
-- CHECK widens. bedframe_tier, sofa_fabrics.tier (0176) and
-- sofa_combo_pricing.tier (0179) stay at three, as Houzs keeps its combo
-- selling tiers at P1..P3 [code: Houzs-ERP backend/src/scm/routes/pos-sofa-combos.ts:28].
-- PRICE_4 adds no selling delta, as in Houzs (fabric-tier-addon.ts:27).
--
-- The CHECK is found by its column, not by a guessed name.
-- ===========================================================================

begin;

do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.catalog_fabrics'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%sofa_tier%'
  loop
    execute format('alter table public.catalog_fabrics drop constraint %I', c);
  end loop;
end
$$;

alter table public.catalog_fabrics
  add constraint catalog_fabrics_sofa_tier_check
  check (sofa_tier in ('PRICE_1', 'PRICE_2', 'PRICE_3', 'PRICE_4'));

commit;
