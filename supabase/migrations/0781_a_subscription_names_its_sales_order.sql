-- =============================================================================
-- 0781 · A subscription names its Sales Order
--
-- Owner (Loo): 19 Nov 2026, "suppose is link". The Supplier Platform's Finance
-- page shows each subscription order with its Sales Order number
-- (ERP-ARCHITECTURE §6.6: "agreement and SO number"), and a supplier knows a
-- Sales Order by the number on its Sales Orders page: the engine's
-- (CR-SO-YYMM-NNN).
--
-- WHAT IS TRUE BEFORE THIS FILE
--   An agreement knows only the portal order it was sold through
--   (order_id -> orders.so), so the Finance answer reads "SO-1291", or nothing
--   ("Not linked"), never the Sales Order the supplier sees.
--
-- WHAT THIS CHANGES
--   One column on the agreement: the engine Sales Order it was sold on. The
--   Finance answer (apps/api/src/routes/engine-supplier-finance.ts) reads it
--   first and falls back to the portal order. Nothing else reads it.
--
-- WHAT IT DOES NOT DO
--   Nothing writes it yet. A subscription Sales Order made in the engine and
--   the agreement signed in the portal are two paths that do not meet
--   (carry-forward `subscription-so-link-writer`). Existing rows stay NULL; no
--   policy, grant or function changes. A column with no default rewrites no
--   row, and the CHECK has only NULLs to read.
-- =============================================================================

ALTER TABLE public.rental_agreements ADD COLUMN IF NOT EXISTS so_doc_no text;
ALTER TABLE public.rental_agreements ADD CONSTRAINT rental_agreements_so_doc_no_shape
  CHECK (so_doc_no IS NULL OR so_doc_no ~ '^[A-Z0-9]+-SO-[0-9]{4}-[0-9]{3,}$');
COMMENT ON COLUMN public.rental_agreements.so_doc_no IS
  'The engine Sales Order (CR-SO-YYMM-NNN) this subscription was sold on. Read by the Supplier Platform Finance answer.';
