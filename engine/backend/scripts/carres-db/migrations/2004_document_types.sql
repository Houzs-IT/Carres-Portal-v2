-- Carres engine database: Houzs's default document types, which the structure-only copy (step 0002) left out
-- because Houzs's own setup steps INSERTed them. Settings > Documents listed nothing, and an announcement, memo,
-- SOP, warning or notice had no type to number under ([DEPT]-[TYPE]-[YYMM]-[NNNN], e.g. OPS-MEMO-2611-0001).
-- Rows exactly as Houzs seeds them:
--   ANN  Houzs step 20260906T1417 · MEMO 20260908T0300 · SOP, WARN, NTC 20260909T0800
--   RTN  20260924T2300 (the Service Case supplier return's reference number)
-- Attachment optional and active, as in Houzs; Settings > Documents changes either. An existing row is left alone.
-- REVERSAL: DELETE FROM public.document_types WHERE code IN ('ANN', 'MEMO', 'SOP', 'WARN', 'NTC', 'RTN')
--             AND code NOT IN (SELECT DISTINCT type_code FROM public.document_refs);

INSERT INTO public.document_types (code, label, attachment_required, is_active, created_at)
VALUES
  ('ANN',  'Announcement',                 0, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('MEMO', 'Memo',                         0, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('SOP',  'Standard operating procedure', 0, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('WARN', 'Warning',                      0, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('NTC',  'Notice',                       0, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('RTN',  'Supplier Return',              0, 1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (code) DO NOTHING;
