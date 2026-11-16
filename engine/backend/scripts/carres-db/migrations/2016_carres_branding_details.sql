-- Carres engine database: Carres's company details in Settings > Branding (owner, 16 Nov 2026: "logo和letterhead
-- 之前也是upload了的" - the details were already given once, in the Carres portal's company profile).
--
-- WHY. Migration 0004 left Branding blank except the name "Carres", so every printed document (Sales Order,
-- Delivery Order, invoices) carried no registration number, address or phone. The portal already holds them.
--
-- WHAT. Writes the portal's company profile into the engine's branding row: legal name, SSM number, address with
-- postcode, and the phone (also as the customer-service phone). A field someone has already filled in Settings >
-- Branding is kept; only blank fields, and the placeholder name "Carres", are filled. Email, website, payment
-- details and the two logos are left as they are: the logo is a file, uploaded in Settings > Branding.
--
-- RE-RUN: safe; a second run changes nothing. No row count is asserted.
-- REVERSAL: clear the fields in Settings > Branding, or
--           UPDATE public.app_settings SET value = (value::jsonb || '{"companyName":"Carres","registrationNo":"",
--             "address":"","postcode":"","phone":"","csPhone":""}'::jsonb)::text WHERE key = 'branding';

do $branding$
declare
  seed jsonb := jsonb_build_object(
    'companyName', 'CARRES SDN. BHD.',
    'registrationNo', '202401055306 (1601150-X)',
    'address', 'E-28-02 & E-28-03, MENARA SUEZCAP 2, KL GATEWAY, NO. 2, JALAN KERINCHI, GERBANG KERINCHI LESTARI, 59200 KUALA LUMPUR',
    'postcode', '59200',
    'phone', '011-6133 8862',
    'csPhone', '011-6133 8862'
  );
  cur jsonb;
  kept jsonb;
begin
  select case when coalesce(value, '') = '' then '{}'::jsonb else value::jsonb end
    into cur
    from public.app_settings
   where key = 'branding';

  if cur is null then
    insert into public.app_settings (key, value) values ('branding', seed::text);
    return;
  end if;

  -- What is already filled in wins, except the 0004 placeholder name.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    into kept
    from jsonb_each(cur) as e(k, v)
   where v <> to_jsonb(''::text)
     and v <> 'null'::jsonb
     and not (k = 'companyName' and v = to_jsonb('Carres'::text));

  update public.app_settings
     set value = (cur || seed || kept)::text
   where key = 'branding'
     and value is distinct from (cur || seed || kept)::text;
end
$branding$;
