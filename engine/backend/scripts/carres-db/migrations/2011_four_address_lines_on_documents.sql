-- Carres engine database: Delivery Orders, Sales Invoices, Delivery Returns and the consignment
-- Delivery Order / Return carry the same FOUR address lines as the Sales Order (owner bug, 14 Nov 2026).
--
-- WHY. A Sales Order, a customer (acc_debtors), a DP order and a consignment order each store address1..4,
-- but the documents cut from them stored only address1 and address2. The SO -> DO conversion kept line 2
-- and joined lines 3 and 4 into line 2 ONLY when line 2 was empty, so an order that used lines 2, 3 and 4
-- lost lines 3 and 4 on the Delivery Order, and then on the invoice, the return and every printed document
-- made from it. The goods went to an incomplete address.
--
-- WHAT. Nullable address3 and address4 text columns on the five document tables. Existing rows keep their
-- two lines and read null for 3 and 4; every reader prints only the non-empty lines, so an old two-line
-- document looks exactly as before. No view reads these documents' address columns (v_do_outstanding and
-- v_si_outstanding name their columns and carry no address), so no view is rebuilt.
-- RE-RUN: safe (ADD COLUMN IF NOT EXISTS).
-- REVERSAL: ALTER TABLE <each table> DROP COLUMN IF EXISTS address3, DROP COLUMN IF EXISTS address4;
--           (only after the application stops reading them; lines 3 and 4 written since are lost).

ALTER TABLE scm.delivery_orders              ADD COLUMN IF NOT EXISTS address3 text, ADD COLUMN IF NOT EXISTS address4 text;
ALTER TABLE scm.sales_invoices               ADD COLUMN IF NOT EXISTS address3 text, ADD COLUMN IF NOT EXISTS address4 text;
ALTER TABLE scm.delivery_returns             ADD COLUMN IF NOT EXISTS address3 text, ADD COLUMN IF NOT EXISTS address4 text;
ALTER TABLE scm.consignment_delivery_orders  ADD COLUMN IF NOT EXISTS address3 text, ADD COLUMN IF NOT EXISTS address4 text;
ALTER TABLE scm.consignment_delivery_returns ADD COLUMN IF NOT EXISTS address3 text, ADD COLUMN IF NOT EXISTS address4 text;
