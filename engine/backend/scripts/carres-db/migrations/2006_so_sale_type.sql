-- Carres engine database: a Sales Order is an Outright sale or a Subscription (owner ruling 12 Nov 2026).
--
-- WHY. Carres sells furniture outright and on subscription (rent-to-own, docs/rental/MASTER.md). The owner
-- ruled that every Sales Order says which, chosen on the SO form (default Outright), shown on the SO list,
-- detail and PDF. This step only records the type; subscription billing is not built here.
--
-- WHAT. scm.mfg_sales_orders.sale_type, text NOT NULL DEFAULT 'outright', limited to 'outright' and
-- 'subscription'. Every existing order reads as outright (the default fills them as the column is added).
-- The list reads scm.mfg_sales_orders_with_payment_totals, which names its columns one by one, so the view is
-- replaced with the same columns plus sale_type at the end (CREATE OR REPLACE may only append columns).
-- RE-RUN: safe (ADD COLUMN IF NOT EXISTS; the constraint is added only when missing; the view is replaced).
-- REVERSAL: recreate the view without sale_type (0001's definition), then
--           ALTER TABLE scm.mfg_sales_orders DROP CONSTRAINT IF EXISTS mfg_sales_orders_sale_type_check,
--             DROP COLUMN IF EXISTS sale_type;

ALTER TABLE scm.mfg_sales_orders ADD COLUMN IF NOT EXISTS sale_type text NOT NULL DEFAULT 'outright';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mfg_sales_orders_sale_type_check'
       AND conrelid = 'scm.mfg_sales_orders'::regclass
  ) THEN
    ALTER TABLE scm.mfg_sales_orders
      ADD CONSTRAINT mfg_sales_orders_sale_type_check CHECK (sale_type IN ('outright', 'subscription'));
  END IF;
END $$;

CREATE OR REPLACE VIEW scm.mfg_sales_orders_with_payment_totals AS
 SELECT so.doc_no,
    so.transfer_to,
    so.so_date,
    so.branding,
    so.debtor_code,
    so.debtor_name,
    so.agent,
    so.sales_location,
    so.ref,
    so.venue,
    so.venue_id,
    so.address1,
    so.address2,
    so.address3,
    so.address4,
    so.phone,
    so.mattress_sofa_sen,
    so.bedframe_sen,
    so.accessories_sen,
    so.others_sen,
    so.mattress_sofa_cost_sen,
    so.bedframe_cost_sen,
    so.accessories_cost_sen,
    so.others_cost_sen,
    so.service_sen,
    so.service_cost_sen,
    so.local_total_sen,
    so.balance_sen,
    so.total_cost_sen,
    so.total_revenue_sen,
    so.total_margin_sen,
    so.margin_pct_basis,
    so.line_count,
    so.fabric_tier_addon_sen,
    so.delivery_fee_sen,
    so.cross_category_source_doc_no,
    so.currency,
    so.status,
    so.remark2,
    so.remark3,
    so.remark4,
    so.note,
    so.proceeded_at,
    so.sales_exemption_expiry,
    so.customer_id,
    so.customer_state,
    so.customer_country,
    so.customer_po_image_b64,
    so.customer_so_no,
    so.hub_id,
    so.hub_name,
    so.customer_delivery_date,
    so.processing_date,
    so.linked_do_doc_no,
    so.ship_to_address,
    so.bill_to_address,
    so.install_to_address,
    so.subtotal_sen,
    so.overdue,
    so.email,
    so.customer_type,
    so.salesperson_id,
    so.city,
    so.postcode,
    so.building_type,
    so.emergency_contact_name,
    so.emergency_contact_phone,
    so.emergency_contact_relationship,
    so.target_date,
    so.signature_b64,
    so.slip_key,
    so.slip_state,
    so.payment_method,
    so.installment_months,
    so.merchant_provider,
    so.approval_code,
    so.payment_date,
    so.deposit_sen,
    so.paid_sen,
    so.created_at,
    so.created_by,
    so.updated_at,
    so.priority_rank,
    so.priority_set_at,
    so.priority_set_by,
    so.priority_reason,
    so.allocation_warehouse_id,
    so.slip_image_key,
    so.receipt_image_key,
    so.delivery_state,
    so.possession_date,
    so.house_type,
    so.replacement_disposal,
    so.referral,
    so.amend_date_from_customer,
    so.amended_delivery_date,
    so.amend_reason,
    so.revision,
    so.company_id,
    COALESCE(p.paid_total, (0)::bigint) AS paid_total_sen,
    (so.local_total_sen - COALESCE(p.paid_total, (0)::bigint)) AS balance_sen_live,
    so.on_hold,
    so.hold_reason,
    so.held_at,
    so.held_by,
    so.collaborator_staff_ids,
    so.access_staff_ids,
    so.open_to_all,
    so.sale_type
   FROM (scm.mfg_sales_orders so
     LEFT JOIN ( SELECT mfg_sales_order_payments.so_doc_no,
            sum(mfg_sales_order_payments.amount_sen) AS paid_total
           FROM scm.mfg_sales_order_payments
          GROUP BY mfg_sales_order_payments.so_doc_no) p ON ((p.so_doc_no = so.doc_no)));
