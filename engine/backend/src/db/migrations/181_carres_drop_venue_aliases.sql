-- Carres: drop the Houzs venue-alias triggers from the D1 test mirror.
--
-- WHY. Migration 141 folded "PJ Showroom" (and its spellings) into "2990s PJ", a
-- 2990 showroom name, on projects.venue and project_venues.name. The engine runs
-- for Carres, whose real showroom is named "PJ Showroom" and which has no venue
-- aliases, so the test mirror must leave the name alone, the same way the Carres
-- database does after carres-db migration 2007_carres_no_venue_aliases.sql and the
-- same way canonical-venue.ts does with its empty VENUE_CANONICAL_MAP.
-- RE-RUN: safe (DROP TRIGGER IF EXISTS).
DROP TRIGGER IF EXISTS trg_projects_canonicalize_venue_ins;
DROP TRIGGER IF EXISTS trg_projects_canonicalize_venue_upd;
DROP TRIGGER IF EXISTS trg_project_venues_canonicalize_name_ins;
DROP TRIGGER IF EXISTS trg_project_venues_canonicalize_name_upd;
