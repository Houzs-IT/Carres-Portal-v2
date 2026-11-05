-- 0762 — A Service Case can be archived off the list, and brought back.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- Jess was not part of this decision.
-- Follows Houzs backend/src/services/assr.ts:1140-1180 (bulk archive / unarchive set
-- archived_at and archived_by; the list reads archived_at IS NULL unless the Archived
-- filter is on). Archiving only tidies the list: the case keeps its stage and history.
-- Additive. Rollback at foot.

alter table public.service_cases
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

comment on column public.service_cases.archived_at is
  '0762: set when staff archive the case off the list (Houzs assr.ts:1140). Null = on the list.';

-- ROLLBACK (manual):
--   alter table public.service_cases drop column if exists archived_at, drop column if exists archived_by;
