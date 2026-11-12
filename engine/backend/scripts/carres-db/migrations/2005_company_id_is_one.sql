-- Carres engine database: the one company row must be id 1, code 'HOUZS', and stay that way.
--
-- WHY. Houzs's code hard-wires company id 1 in places: the binding model (src/scm/lib/binding-mode.ts,
-- HARD_BOUND_COMPANY_ID = 1) and the chart-of-accounts import (frontend ChartOfAccounts.tsx, companyId: 1).
-- Step 0001 inserts the company without an explicit id, so on a fresh database it gets 1 from the identity,
-- but nothing held it there. This step stops the run (so `apply.mjs --ci` and the engine deploy stop) when
-- the row is not exactly one company with id 1 and code 'HOUZS', and afterwards refuses any change of that
-- row's id or code and its deletion (delete-and-insert would hand out id 2).
-- RE-RUN: safe (the check reads only; the function and trigger are replaced).
-- REVERSAL: DROP TRIGGER IF EXISTS companies_carres_id_is_one ON public.companies;
--           DROP FUNCTION IF EXISTS public.companies_carres_id_is_one();

DO $$
DECLARE
  v_count int;
  v_id bigint;
  v_code text;
BEGIN
  SELECT count(*) INTO v_count FROM public.companies;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Carres engine: expected exactly one company, found %', v_count;
  END IF;
  SELECT id, code INTO v_id, v_code FROM public.companies;
  IF v_code <> 'HOUZS' OR v_id <> 1 THEN
    RAISE EXCEPTION 'Carres engine: the company must be id 1 with code HOUZS, found id % code %', v_id, v_code;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.companies_carres_id_is_one() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.id = 1 THEN
      RAISE EXCEPTION 'Carres engine: the company (id 1, code HOUZS) may not be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.id = 1 AND (NEW.id <> OLD.id OR NEW.code <> OLD.code) THEN
    RAISE EXCEPTION 'Carres engine: the company id (1) and code (HOUZS) may not change';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS companies_carres_id_is_one ON public.companies;
CREATE TRIGGER companies_carres_id_is_one
  BEFORE UPDATE OF id, code OR DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_carres_id_is_one();
