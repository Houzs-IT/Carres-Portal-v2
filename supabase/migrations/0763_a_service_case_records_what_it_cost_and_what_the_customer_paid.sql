-- 0763 — A Service Case records what the customer is charged and what the supplier side cost.
--
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): clear Carres rules, implement Houzs.
-- Jess was not part of this decision.
-- Follows Houzs backend/src/db/migrations/037_assr_settings_and_costs.sql (customer_amount,
-- po_amount) and frontend/src/pages/ServiceCases.tsx:7253-7465 (Cost tracking panel:
-- both amounts, gross margin, supplier invoice ref). Houzs's Cost Notes is Carres's
-- existing incurred_charges.
--
-- RECORDS ONLY: nothing here posts to the ledger, bills the customer or pays a supplier.
-- Finance (Chew) owns those; these columns are the case's own note of the numbers.
--
--   customer_amount       what the customer is charged for this case (RM, at least 0)
--   supplier_cost_amount  what the supplier side cost Carres (Houzs po_amount; RM, at least 0)
--   supplier_invoice_ref  the supplier's invoice number (at most 120 characters)
-- Additive. Rollback at foot.

alter table public.service_cases
  add column if not exists customer_amount      numeric(12,2),
  add column if not exists supplier_cost_amount numeric(12,2),
  add column if not exists supplier_invoice_ref text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sc_customer_amount_not_negative') then
    alter table public.service_cases add constraint sc_customer_amount_not_negative
      check (customer_amount is null or customer_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_supplier_cost_amount_not_negative') then
    alter table public.service_cases add constraint sc_supplier_cost_amount_not_negative
      check (supplier_cost_amount is null or supplier_cost_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sc_supplier_invoice_ref_length') then
    alter table public.service_cases add constraint sc_supplier_invoice_ref_length
      check (supplier_invoice_ref is null or char_length(supplier_invoice_ref) <= 120);
  end if;
end $$;

-- ROLLBACK (manual):
--   alter table public.service_cases
--     drop constraint if exists sc_customer_amount_not_negative,
--     drop constraint if exists sc_supplier_cost_amount_not_negative,
--     drop constraint if exists sc_supplier_invoice_ref_length,
--     drop column if exists customer_amount, drop column if exists supplier_cost_amount,
--     drop column if exists supplier_invoice_ref;
