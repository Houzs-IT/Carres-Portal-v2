-- Carres engine database: the starting rows the engine's code needs, which the structure-only copy (step 0001/0002)
-- left out because Houzs's own setup steps INSERTed them (found in the 11 Nov 2026 test run).
--
-- 1. The stock re-check lock (Houzs step 0174). Every re-check of "stock set aside for an order" claims this one row
--    first; with no row the claim matches nothing, the code reads that as "another re-check is running", queues a
--    retry for a scheduled job Carres does not run, and every order line stays "not ready" after its goods arrive.
-- 2. Houzs's explicit "off" switches for the write freeze and the AutoCount write-back (steps 0272, 0277).
-- 3. The Service Case product categories, in their final Houzs state (steps 0112 then 0254): the case form's
--    "Product category" list was empty.
-- REVERSAL: DELETE FROM scm.stock_allocation_recompute_lock WHERE lock_key = 'GLOBAL';
--           DELETE FROM scm.app_config WHERE key IN ('scm.write_freeze', 'scm.autocount_writeback');
--           DELETE FROM public.assr_product_categories
--             WHERE slug IN ('mattress', 'bed_frame', 'sofa', 'pillow_bolster', 'accessories', 'dining');

INSERT INTO scm.stock_allocation_recompute_lock (lock_key) VALUES ('GLOBAL') ON CONFLICT (lock_key) DO NOTHING;

INSERT INTO scm.app_config (key, value, description) VALUES
  ('scm.write_freeze', 'off', NULL),
  ('scm.autocount_writeback', 'off', 'ERP -> AutoCount write-back. Off in Carres: there is no AutoCount.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.assr_product_categories (slug, name, sort_order) VALUES
  ('mattress',       'Mattress',          10),
  ('bed_frame',      'Bed Frame',         20),
  ('sofa',           'Sofa',              30),
  ('pillow_bolster', 'Pillow / Bolster',  40),
  ('accessories',    'Accessories',       50)
ON CONFLICT (slug) DO NOTHING;
UPDATE public.assr_product_categories SET name = 'Bedframe', sort_order = 10 WHERE slug = 'bed_frame';
UPDATE public.assr_product_categories SET sort_order = 20 WHERE slug = 'sofa';
UPDATE public.assr_product_categories SET sort_order = 30 WHERE slug = 'mattress';
INSERT INTO public.assr_product_categories (slug, name, sort_order) VALUES ('dining', 'Dining', 40)
ON CONFLICT (slug) DO UPDATE SET name = 'Dining', sort_order = 40, active = 1;
UPDATE public.assr_product_categories SET sort_order = 50 WHERE slug = 'accessories';
UPDATE public.assr_product_categories SET active = 0 WHERE slug = 'pillow_bolster';
