-- Carres engine database: the Supplier Platform (owner, 15 Nov 2026).
--
-- WHY. A supplier signs in to pages of its own and sees ONLY what Carres shares with it: the Sales Orders that carry
-- its goods (so its warehouse can plan stock), the pickup requests Carres raises, and, for its Finance people, the
-- subscription money it has a share in. Carres collects the goods at the supplier's warehouse.
--
-- THE OWNER'S SECURITY RULE: a supplier's login must never be a way into the Carres database or system.
-- How this step keeps it:
--   * Supplier people are rows in carres_supplier_users. They are NOT rows in public.users (engine staff) and NOT
--     Supabase Auth users, so they hold no engine session, no portal login and no database credential. Their bearer
--     token is looked up ONLY in carres_supplier_sessions, by the supplier routes (src/carres/supplier/).
--   * A session token and a set-password link are stored only as their SHA-256. The token itself exists in the
--     supplier's browser alone, so a copy of this database signs nobody in.
--   * Every table here has row level security ON with no policy, and anon / authenticated lose their table grants,
--     so Supabase's data API reads nothing. scm_engine owns the tables (scripts/carres-db/engine-owns-all.sql runs
--     after every apply) and the Worker is the only reader.
--   * What a supplier may read is decided HERE, in the two functions at the bottom: they name every column that
--     leaves the database. No price, cost, margin, payment, phone, email, remark or staff name is in them, and a
--     line's specification leaves without its add-on note and without the word that it was given free.
--   * PUBLIC, anon and authenticated lose EXECUTE on the two functions, so the data API offers them to no outside
--     caller. The engine's own role runs them.
--
-- RE-RUN: safe (IF NOT EXISTS / CREATE OR REPLACE throughout).
-- REVERSAL: DROP FUNCTION public.carres_supplier_scope_orders(uuid), public.carres_supplier_scope_items(uuid);
--           DROP TABLE public.carres_pickup_request_lines, public.carres_pickup_requests,
--             public.carres_pickup_request_counters, public.carres_supplier_events, public.carres_supplier_links,
--             public.carres_supplier_sessions, public.carres_supplier_users, public.carres_supplier_access_scope,
--             public.carres_supplier_access;

-- ── 1. Supplier Access (Settings › Supplier Access) ─────────────────────────────────────────────────────────────
-- One row per supplier that may sign in. Nothing is shared until `enabled` is true.
CREATE TABLE IF NOT EXISTS public.carres_supplier_access (
  supplier_id        uuid PRIMARY KEY REFERENCES scm.suppliers(id) ON DELETE RESTRICT,
  enabled            boolean NOT NULL DEFAULT false,
  -- Share the orders that carry the items bound to this supplier (Supplier › Items), the narrowest scope.
  own_items          boolean NOT NULL DEFAULT false,
  -- This supplier is paid a share of each subscription month collected (docs/rental/MASTER.md §0). Subscription
  -- plans do not name their supplier yet, so the share belongs to ONE supplier: the index below allows one.
  subscription_share boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         bigint REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS carres_supplier_access_one_subscription_supplier
  ON public.carres_supplier_access ((true)) WHERE subscription_share;

-- What the supplier's orders are picked by. An order is shared when at least one of its lines matches one row:
--   category  value = the product category (MATTRESS, SOFA ...)
--   model     value = scm.product_models.id
--   sku       value = the item code on the order line (scm.mfg_products.code)
CREATE TABLE IF NOT EXISTS public.carres_supplier_access_scope (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id uuid NOT NULL REFERENCES public.carres_supplier_access(supplier_id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('category', 'model', 'sku')),
  value       text NOT NULL CHECK (btrim(value) <> ''),
  UNIQUE (supplier_id, kind, value)
);

-- ── 2. Supplier people, their sessions and set-password links ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.carres_supplier_users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id   uuid NOT NULL REFERENCES public.carres_supplier_access(supplier_id) ON DELETE RESTRICT,
  email         text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  -- The two roles the owner named: Warehouse and Operation, and Finance. A person holds one or both.
  can_operation boolean NOT NULL DEFAULT true,
  can_finance   boolean NOT NULL DEFAULT false,
  -- PBKDF2 (services/auth.ts hashPassword). NULL until the person sets one through their link.
  password_hash text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carres_supplier_users_has_a_role CHECK (can_operation OR can_finance)
);
CREATE UNIQUE INDEX IF NOT EXISTS carres_supplier_users_email_key ON public.carres_supplier_users (email);
CREATE INDEX IF NOT EXISTS carres_supplier_users_supplier_idx ON public.carres_supplier_users (supplier_id);

CREATE TABLE IF NOT EXISTS public.carres_supplier_sessions (
  token_hash   text PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES public.carres_supplier_users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX IF NOT EXISTS carres_supplier_sessions_user_idx ON public.carres_supplier_sessions (user_id);
CREATE INDEX IF NOT EXISTS carres_supplier_sessions_expiry_idx ON public.carres_supplier_sessions (expires_at);

-- A one-time link that lets the person choose a password ('setup' for a new person, 'reset' after that).
CREATE TABLE IF NOT EXISTS public.carres_supplier_links (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES public.carres_supplier_users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('setup', 'reset')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS carres_supplier_links_user_idx ON public.carres_supplier_links (user_id);

-- Who signed in, who failed to, and every change made through the platform. Failed sign-ins are counted from here,
-- per email, so the lock does not depend on a cache. `ip` is a record of where a try came from when the request
-- says; nothing is counted by it.
CREATE TABLE IF NOT EXISTS public.carres_supplier_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  kind             text NOT NULL,
  supplier_id      uuid,
  supplier_user_id bigint,
  staff_user_id    bigint,
  subject          text,
  ip               text,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS carres_supplier_events_subject_idx ON public.carres_supplier_events (kind, subject, at DESC);
CREATE INDEX IF NOT EXISTS carres_supplier_events_supplier_idx ON public.carres_supplier_events (supplier_id, at DESC);

-- ── 3. Pickup requests ──────────────────────────────────────────────────────────────────────────────────────────
-- Carres asks to collect goods (REQUESTED), the supplier accepts (ACCEPTED), Carres records the collection
-- (COLLECTED). Carres may cancel before collection. A request records a notice and its answer; it moves no stock:
-- goods still enter Carres's books through the Purchase Order and its goods receipt.
CREATE TABLE IF NOT EXISTS public.carres_pickup_request_counters (
  period  text PRIMARY KEY,
  last_no integer NOT NULL
);

CREATE TABLE IF NOT EXISTS public.carres_pickup_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no        text NOT NULL UNIQUE,
  supplier_id       uuid NOT NULL REFERENCES scm.suppliers(id) ON DELETE RESTRICT,
  expected_date     date NOT NULL,
  expected_time     text CHECK (expected_time IS NULL OR expected_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  note              text,
  status            text NOT NULL DEFAULT 'REQUESTED'
                      CHECK (status IN ('REQUESTED', 'ACCEPTED', 'COLLECTED', 'CANCELLED')),
  requested_by      bigint REFERENCES public.users(id) ON DELETE SET NULL,
  requested_by_name text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  accepted_by       bigint REFERENCES public.carres_supplier_users(id) ON DELETE SET NULL,
  accepted_by_name  text,
  accepted_at       timestamptz,
  collected_by      bigint REFERENCES public.users(id) ON DELETE SET NULL,
  collected_by_name text,
  collected_at      timestamptz,
  cancelled_by      bigint REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_by_name text,
  cancelled_at      timestamptz,
  cancel_reason     text,
  CONSTRAINT carres_pickup_requests_status_shape CHECK (
    (status <> 'ACCEPTED'  OR accepted_at  IS NOT NULL) AND
    (status <> 'COLLECTED' OR collected_at IS NOT NULL) AND
    (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS carres_pickup_requests_supplier_idx
  ON public.carres_pickup_requests (supplier_id, status, expected_date);

-- One row per Sales Order line asked for. The words (item, unit, quantity) are kept as they read when the request was
-- sent, so a later edit of the order does not rewrite what the supplier accepted.
CREATE TABLE IF NOT EXISTS public.carres_pickup_request_lines (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id  uuid NOT NULL REFERENCES public.carres_pickup_requests(id) ON DELETE CASCADE,
  so_doc_no   text NOT NULL,
  so_item_id  uuid NOT NULL REFERENCES scm.mfg_sales_order_items(id) ON DELETE RESTRICT,
  item_code   text NOT NULL,
  description text,
  spec        text,
  model_name  text,
  uom         text NOT NULL,
  qty         integer NOT NULL CHECK (qty > 0),
  -- False once the request is cancelled, so the line can be asked for again.
  open        boolean NOT NULL DEFAULT true
);
-- A Sales Order line sits on one live request at a time: it cannot be asked for twice.
CREATE UNIQUE INDEX IF NOT EXISTS carres_pickup_request_lines_one_open_per_so_line
  ON public.carres_pickup_request_lines (so_item_id) WHERE open;
CREATE INDEX IF NOT EXISTS carres_pickup_request_lines_request_idx ON public.carres_pickup_request_lines (request_id);
CREATE INDEX IF NOT EXISTS carres_pickup_request_lines_so_idx ON public.carres_pickup_request_lines (so_doc_no);

-- ── 4. Closed to the data API ───────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'carres_supplier_access', 'carres_supplier_access_scope', 'carres_supplier_users', 'carres_supplier_sessions',
    'carres_supplier_links', 'carres_supplier_events', 'carres_pickup_request_counters', 'carres_pickup_requests',
    'carres_pickup_request_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- ── 5. What a supplier may read: the ONE definition of its scope and of the columns that leave ──────────────────
-- The order lines shared with a supplier. Returns nothing while its access is off. Every caller (the supplier's order
-- list, order page, forecast, and the pickup request picker on the Carres side) reads lines through this function,
-- so "which lines" has one answer. The columns are the whole list a supplier may see of a line: no price, no cost.
--
-- THE SPECIFICATION (spec) is the line's second description cut short. That text is built as
-- "<size / colour / heights ...> / SPECIAL: <add-ons + the salesperson's free-text note> / FREE · <campaign>"
-- (src/scm/shared/variant-summary.ts: SPECIAL and FREE always come last). The note is free text and FREE says the
-- line cost the customer nothing; a supplier reads neither a note nor a price signal, so the text is cut at the
-- first of the two. What is left is what the goods are.
CREATE OR REPLACE FUNCTION public.carres_supplier_scope_items(p_supplier uuid)
RETURNS TABLE (
  so_item_id  uuid,
  doc_no      text,
  line_no     integer,
  item_code   text,
  description text,
  spec        text,
  category    text,
  model_id    uuid,
  model_code  text,
  model_name  text,
  uom         text,
  qty         integer
)
LANGUAGE sql STABLE
AS $$
  SELECT i.id,
         i.doc_no,
         i.line_no,
         i.item_code,
         i.description,
         nullif(btrim(regexp_replace(coalesce(i.description2, ''), '(^| / )(SPECIAL: |FREE( · |$)).*$', '', 'i')), ''),
         upper(coalesce(p.category::text, i.item_group, '')),
         p.model_id,
         m.model_code,
         m.name,
         coalesce(nullif(btrim(i.uom), ''), 'UNIT'),
         i.qty
    FROM scm.mfg_sales_order_items i
    JOIN public.carres_supplier_access a ON a.supplier_id = p_supplier AND a.enabled
    LEFT JOIN LATERAL (
      SELECT mp.category, mp.model_id
        FROM scm.mfg_products mp
       WHERE mp.code = i.item_code
       ORDER BY (mp.company_id IS NOT DISTINCT FROM i.company_id) DESC, mp.updated_at DESC NULLS LAST
       LIMIT 1
    ) p ON true
    LEFT JOIN scm.product_models m ON m.id = p.model_id
   WHERE NOT coalesce(i.cancelled, false)
     AND coalesce(i.qty, 0) > 0
     AND (
          EXISTS (SELECT 1 FROM public.carres_supplier_access_scope s
                   WHERE s.supplier_id = p_supplier AND s.kind = 'category'
                     AND s.value = upper(coalesce(p.category::text, i.item_group, '')))
       OR EXISTS (SELECT 1 FROM public.carres_supplier_access_scope s
                   WHERE s.supplier_id = p_supplier AND s.kind = 'model' AND s.value = p.model_id::text)
       OR EXISTS (SELECT 1 FROM public.carres_supplier_access_scope s
                   WHERE s.supplier_id = p_supplier AND s.kind = 'sku' AND s.value = i.item_code)
       OR (a.own_items AND EXISTS (SELECT 1 FROM scm.supplier_material_bindings b
                                    WHERE b.supplier_id = p_supplier AND b.item_code = i.item_code))
     )
$$;

-- The Sales Orders shared with a supplier: every order that is past Draft and carries at least one shared line.
-- These columns are the whole list a supplier may see of an order. The owner allowed the customer's name and
-- address (15 Nov 2026); the phone, email, money, payment, remarks and staff stay inside.
CREATE OR REPLACE FUNCTION public.carres_supplier_scope_orders(p_supplier uuid)
RETURNS TABLE (
  doc_no                 text,
  so_date                date,
  status                 text,
  sale_type              text,
  processing_date        date,
  customer_delivery_date date,
  customer_name          text,
  address1               text,
  address2               text,
  postcode               text,
  city                   text,
  customer_state         text,
  created_at             timestamptz,
  line_count             integer,
  unit_count             integer
)
LANGUAGE sql STABLE
AS $$
  SELECT so.doc_no,
         so.so_date,
         so.status::text,
         so.sale_type,
         so.processing_date,
         coalesce(so.amended_delivery_date, so.customer_delivery_date),
         so.debtor_name,
         coalesce(nullif(btrim(so.delivery_address1), ''), so.address1),
         CASE WHEN nullif(btrim(so.delivery_address1), '') IS NOT NULL THEN so.delivery_address2 ELSE so.address2 END,
         so.postcode,
         so.city,
         so.customer_state,
         so.created_at,
         x.line_count,
         x.unit_count
    FROM scm.mfg_sales_orders so
    JOIN (
      SELECT it.doc_no, count(*)::integer AS line_count, coalesce(sum(it.qty), 0)::integer AS unit_count
        FROM public.carres_supplier_scope_items(p_supplier) it
       GROUP BY it.doc_no
    ) x ON x.doc_no = so.doc_no
   WHERE so.status::text <> 'DRAFT'
$$;

-- ── 6. The two functions are closed to outside callers ──────────────────────────────────────────────────────────
-- A function in public can be run by anyone unless that is taken away, and the data API offers every function it
-- may run. Both run with the caller's own rights, so an outsider would already be stopped at the tables; this
-- takes the door away too. The engine's role keeps EXECUTE (scripts/carres-db/engine-owns-all.sql grants it again
-- after every apply).
REVOKE ALL ON FUNCTION public.carres_supplier_scope_items(uuid), public.carres_supplier_scope_orders(uuid) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.carres_supplier_scope_items(uuid), public.carres_supplier_scope_orders(uuid) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scm_engine') THEN
    GRANT EXECUTE ON FUNCTION public.carres_supplier_scope_items(uuid), public.carres_supplier_scope_orders(uuid) TO scm_engine;
  END IF;
END $$;
