-- The engine's built-in system staff row (as The Conts migration 0048): documents are stamped with it, so no
-- sales order saves without it. The id is fixed in the engine's code.
-- Then the company details people see, blank until set in Settings > Branding (no other company's details).
-- REVERSAL: DELETE FROM scm.staff WHERE id = '00000000-0000-4000-8000-000000000001';
--           DELETE FROM public.app_settings WHERE key = 'branding';
INSERT INTO scm.staff (id, staff_code, name, role, initials, color, active)
VALUES ('00000000-0000-4000-8000-000000000001', 'SYSTEM', 'Carres', 'super_admin', 'CR', '#8a6a2f', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('branding', jsonb_build_object(
  'companyName', 'Carres', 'registrationNo', '', 'address', '', 'postcode', '', 'phone', '', 'email', '',
  'website', '', 'logoR2Key', '', 'printLogoR2Key', '', 'csPhone', '', 'csEmail', '',
  'customerPaymentDetails', '', 'debtorPaymentDetails', '', 'debtorInvoiceTerms', ''
)::text)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
