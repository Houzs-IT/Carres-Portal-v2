-- Carres engine database: the supplier pages, second step (owner, 16 and 17 Nov 2026).
--
-- WHY. The owner redesigned the pages a supplier signs in to (supp.carresofficial.com). Three things change here:
--   * A supplier's own admin adds the company's people and sets, person by person, what each may see and press
--     (carres_supplier_users.perms). Carres still turns a supplier on, decides what it is shared and adds its first
--     person in Settings › Supplier Access; a person Carres adds holds every permission of their department.
--   * An admin may give a new person a password instead of an invite email, and ask them to choose their own at
--     their first sign-in (must_change_password).
--   * On an accepted pickup the supplier may mark the goods collected, with the Delivery Order Carres signed (a PDF
--     kept in the engine's private file store; only its key and name are here), and may ASK Carres to move the day
--     or to cancel. An ask changes nothing until Carres approves it (owner, 17 Nov 2026): Carres books its lorry for
--     the day it asked for, so a supplier cannot move or drop a pickup on its own. Carres's answer to the latest ask
--     is kept so the supplier can read it.
--
-- Nothing here widens what a supplier reads: the supplier's answers still name every field they carry
-- (src/carres/supplier/pickups.ts forSupplier, src/carres/supplier/people.ts), and the tables keep row level
-- security on with no policy (migration 2012).
--
-- RE-RUN: safe (ADD COLUMN IF NOT EXISTS, constraints and indexes only when missing; the backfill fills only
-- permissions that are still empty).
-- REVERSAL: ALTER TABLE public.carres_pickup_requests
--             DROP CONSTRAINT IF EXISTS carres_pickup_requests_ask_shape,
--             DROP CONSTRAINT IF EXISTS carres_pickup_requests_answer_shape,
--             DROP CONSTRAINT IF EXISTS carres_pickup_requests_do_shape,
--             DROP COLUMN ask_kind, DROP COLUMN ask_date, DROP COLUMN ask_at, DROP COLUMN ask_by, DROP COLUMN ask_by_name,
--             DROP COLUMN answer_kind, DROP COLUMN answer_approved, DROP COLUMN answer_date, DROP COLUMN answer_at,
--             DROP COLUMN answer_by, DROP COLUMN answer_by_name, DROP COLUMN answer_reason,
--             DROP COLUMN previous_expected_date, DROP COLUMN date_changed_at, DROP COLUMN cancelled_by_supplier,
--             DROP COLUMN collected_by_supplier_user, DROP COLUMN collected_by_supplier_name,
--             DROP COLUMN do_key, DROP COLUMN do_name, DROP COLUMN do_size, DROP COLUMN do_uploaded_at;
--           DROP INDEX IF EXISTS public.carres_pickup_requests_open_ask_idx;
--           ALTER TABLE public.carres_supplier_users DROP CONSTRAINT IF EXISTS carres_supplier_users_perms_shape,
--             DROP COLUMN perms, DROP COLUMN must_change_password;
--           (A Delivery Order file already stored stays in the file store under carres-supplier-do/.)

-- ── 1. A supplier person's permissions ──────────────────────────────────────────────────────────────────────────
-- {"operation": [...], "finance": [...]}: the keys a person holds in each department they belong to. The key names
-- are the platform's own (src/carres/supplier/perms.ts); a department the person does not belong to holds none.
ALTER TABLE public.carres_supplier_users ADD COLUMN IF NOT EXISTS perms jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.carres_supplier_users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carres_supplier_users_perms_shape') THEN
    ALTER TABLE public.carres_supplier_users
      ADD CONSTRAINT carres_supplier_users_perms_shape CHECK (jsonb_typeof(perms) = 'object');
  END IF;
END $$;

-- Everyone who could sign in before this step keeps what they had: every page and button of their department.
UPDATE public.carres_supplier_users
   SET perms = jsonb_build_object(
         'operation', CASE WHEN can_operation
           THEN '["v_orders","v_forecast","v_pickups","a_accept","a_collect","a_date","a_cancel","a_export","a_users"]'::jsonb
           ELSE '[]'::jsonb END,
         'finance', CASE WHEN can_finance
           THEN '["v_coll","v_month","d_names","d_share","d_bad","a_export","a_stmt","a_users"]'::jsonb
           ELSE '[]'::jsonb END)
 WHERE perms = '{}'::jsonb;

-- ── 2. A pickup request: the supplier's ask, Carres's answer, the day it moved from, the collection by the supplier
--       and its Delivery Order ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.carres_pickup_requests
  -- The ask that waits for Carres: move the pickup to ask_date, or cancel it. One at a time.
  ADD COLUMN IF NOT EXISTS ask_kind    text CHECK (ask_kind IN ('date', 'cancel')),
  ADD COLUMN IF NOT EXISTS ask_date    date,
  ADD COLUMN IF NOT EXISTS ask_at      timestamptz,
  ADD COLUMN IF NOT EXISTS ask_by      bigint REFERENCES public.carres_supplier_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ask_by_name text,
  -- Carres's answer to the LATEST ask. Cleared when the supplier asks again.
  ADD COLUMN IF NOT EXISTS answer_kind     text CHECK (answer_kind IN ('date', 'cancel')),
  ADD COLUMN IF NOT EXISTS answer_approved boolean,
  ADD COLUMN IF NOT EXISTS answer_date     date,
  ADD COLUMN IF NOT EXISTS answer_at       timestamptz,
  ADD COLUMN IF NOT EXISTS answer_by       bigint REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS answer_by_name  text,
  ADD COLUMN IF NOT EXISTS answer_reason   text,
  -- The day an approved move came FROM, and when it was approved.
  ADD COLUMN IF NOT EXISTS previous_expected_date date,
  ADD COLUMN IF NOT EXISTS date_changed_at        timestamptz,
  -- Cancelled because the supplier asked and Carres approved.
  ADD COLUMN IF NOT EXISTS cancelled_by_supplier boolean NOT NULL DEFAULT false,
  -- The supplier's person who marked the goods collected (Carres's own record of a collection stays in collected_by).
  ADD COLUMN IF NOT EXISTS collected_by_supplier_user bigint REFERENCES public.carres_supplier_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collected_by_supplier_name text,
  -- The Delivery Order Carres signed, uploaded by the supplier when it marked the goods collected. do_key is the
  -- file's key in the engine's private file store; the file itself is never in the database.
  ADD COLUMN IF NOT EXISTS do_key         text,
  ADD COLUMN IF NOT EXISTS do_name        text,
  ADD COLUMN IF NOT EXISTS do_size        integer,
  ADD COLUMN IF NOT EXISTS do_uploaded_at timestamptz;

DO $$
BEGIN
  -- An ask waits only on an accepted request, and a move always names its day.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carres_pickup_requests_ask_shape') THEN
    ALTER TABLE public.carres_pickup_requests ADD CONSTRAINT carres_pickup_requests_ask_shape CHECK (
      (ask_kind IS NULL AND ask_date IS NULL AND ask_at IS NULL)
      OR (ask_kind IS NOT NULL AND status = 'ACCEPTED' AND ask_at IS NOT NULL AND (ask_kind = 'date') = (ask_date IS NOT NULL))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carres_pickup_requests_answer_shape') THEN
    ALTER TABLE public.carres_pickup_requests ADD CONSTRAINT carres_pickup_requests_answer_shape CHECK (
      (answer_kind IS NULL) = (answer_at IS NULL) AND (answer_kind IS NULL) = (answer_approved IS NULL)
    );
  END IF;
  -- A Delivery Order belongs to collected goods, and has its name with it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carres_pickup_requests_do_shape') THEN
    ALTER TABLE public.carres_pickup_requests ADD CONSTRAINT carres_pickup_requests_do_shape CHECK (
      (do_key IS NULL) = (do_name IS NULL) AND (do_key IS NULL OR status = 'COLLECTED')
    );
  END IF;
END $$;

-- Carres's list of requests waiting for its answer.
CREATE INDEX IF NOT EXISTS carres_pickup_requests_open_ask_idx
  ON public.carres_pickup_requests (supplier_id) WHERE ask_kind IS NOT NULL;
