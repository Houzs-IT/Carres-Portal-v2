-- Carres engine database: venue names are never renamed to a Houzs/2990 name.
--
-- WHY. 0001 carried Houzs's scm.canonicalize_venue(), which folds "PJ Showroom" (and
-- "pj-showroom", "pjshowroom", "2990 pj" ...) into "2990s PJ", a 2990 showroom name.
-- It runs in BEFORE INSERT/UPDATE triggers on scm.mfg_sales_orders.venue,
-- scm.warehouses.venue_name, public.projects.venue and public.project_venues.name.
-- Carres's real showroom is the PJ-HQ warehouse named "PJ Showroom", and the Carres
-- SO Showroom picker saves that name as the order venue, so every Carres showroom
-- order, the warehouse itself and project venues would be renamed to a 2990 name.
-- Carres has no venue aliases (canonical-venue.ts VENUE_CANONICAL_MAP is empty).
--
-- WHAT. Replace the function with the same signature and the same blank handling
-- (NULL stays NULL, blank returns its input untouched), but no alias branches: a
-- non-blank venue comes back trimmed and otherwise unchanged. The four triggers keep
-- calling it and need no change. No data is rewritten (every row today is test data).
-- RE-RUN: safe (CREATE OR REPLACE FUNCTION).
-- REVERSAL: re-run 0001's definition of scm.canonicalize_venue(text).

CREATE OR REPLACE FUNCTION scm.canonicalize_venue(input text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  trimmed text;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  trimmed := btrim(input);
  IF trimmed = '' THEN RETURN input; END IF;
  -- Carres has no venue aliases: trimmed, otherwise unchanged.
  RETURN trimmed;
END $function$;
