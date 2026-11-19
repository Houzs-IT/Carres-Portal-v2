-- 2020 · Carres: SKU costs follow the suppliers' current quotations (Chew, Finance owner, 2026-11-19:
--        「好，开始补」; Dorsettloft is the main supplier of 9038 and 9055: 「好，Dorsettloft 为主」).
--
-- WHY
--   The costs loaded on 13 Nov came from the old AutoCount SKU master, priced before the suppliers' 2026 increases.
--   AutoCount's Purchase Invoice Detail Listing (2 Jan – 28 Sep 2026) shows every one of these suppliers already
--   invoicing at the quoted prices, with no discount:
--     Nice Future     quotation LC/22042026            invoiced at it from June–July 2026
--     Dorsettloft     price list (B&C)                 invoiced at it from 23 May 2026
--     Armani          price list 06.10.26 (B&C)        July–August invoices already at it
--     Hookka          quotation 300-C, 24 Sep 2026     billed by Ohana Studio at Price 2 since May 2026
--
-- WHAT
--   Supplier bindings (scm.supplier_material_bindings) and the SKU cost (scm.mfg_products) of the quoted SKUs:
--     MATTRESS   unit price = the quote; SKU cost_price_sen and base_price_sen = the same.
--                FORTE and SONIC are not on the quote: their invoiced prices (unchanged all year) fill the 0 cost.
--     BEDFRAME   Ohana binding {"P2": Price 2}; Fab2 and Fab3 both cost Price 2 (Chew 2026-11-19). The SKU cost is
--                Ohana's, the dearest supplier (NB's bindings are left as they are).
--     SOFA       one cost per seat size in the P2 cell, the engine's cost tier: the B&C column for Armani and
--                Dorsettloft, the P2 column Hookka prints. The SKU's seat_height_prices cost grid is the dearest
--                supplier's whole set (the engine's derive rule; a tie goes to the main supplier). A stored retail
--                price on the grid is kept.
--                9038 and 9055 get Dorsettloft bindings and Dorsettloft becomes their main supplier; Armani stays
--                bound so a PO can still pick it.
--     COMBOS     the set prices (1+2+3, 2L, 3L, 2+1) of scm.sofa_combo_pricing for the same models; the generic row
--                (no supplier) takes the dearest supplier's price per seat size. 9038 and 9055 get Dorsettloft rows
--                copied from their generic row.
--   Nothing is deleted. No new SKU is made. History tables are not written (the engine does not read them yet).
--   Not on any quote and left as they were: Armani 9038 2NA, 9015, 9023; Dorsettloft 8017, 8027; 5531 1+L set.
--
-- RE-RUN: safe; a second run writes the same values. No row count is asserted.
-- REVERSAL: restore the bindings, SKU costs and combo prices from a backup taken before this migration; the
--           Dorsettloft 9038/9055 bindings and combo rows it added can be deleted, and Armani set back as main.

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres supplier quote costs: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;

create temp table _cost_b (code text, supplier_code text, unit_sen int, matrix jsonb, main boolean, supplier_sku text) on commit drop;
insert into _cost_b values
  ('9036-1S', '400-A001', 0, '{"24":{"P2":78200},"30":{"P2":82800}}'::jsonb, null, 'AM9036 (1S)'),
  ('9036-2S', '400-A001', 0, '{"24":{"P2":112200},"30":{"P2":118800}}'::jsonb, null, 'AM9036 (2S)'),
  ('9036-3S', '400-A001', 0, '{"24":{"P2":149600},"30":{"P2":158400}}'::jsonb, null, 'AM9036 (3S)'),
  ('9036-1NA', '400-A001', 0, '{"24":{"P2":55000},"30":{"P2":55000}}'::jsonb, null, 'AM9036 (1NA)'),
  ('9038-1S', '400-A001', 0, '{"24":{"P2":78200},"30":{"P2":82800}}'::jsonb, false, 'AM9038 (1S)'),
  ('9038-2S', '400-A001', 0, '{"24":{"P2":112200},"30":{"P2":118800}}'::jsonb, false, 'AM9038 (2S)'),
  ('9038-3S', '400-A001', 0, '{"24":{"P2":149600},"30":{"P2":158400}}'::jsonb, false, 'AM9038 (3S)'),
  ('9038-1NA', '400-A001', 0, '{"24":{"P2":55000},"30":{"P2":55000}}'::jsonb, false, 'AM9038 (1NA)'),
  ('9038-1A(RHF)', '400-A001', 0, '{"24":{"P2":58000},"30":{"P2":61000}}'::jsonb, false, 'AM9038 (1A(RHF))'),
  ('9038-2A(LHF)', '400-A001', 0, '{"24":{"P2":105000},"30":{"P2":111000}}'::jsonb, false, 'AM9038 (2A(LHF))'),
  ('9038-2A(RHF)', '400-A001', 0, '{"24":{"P2":105000},"30":{"P2":111000}}'::jsonb, false, 'AM9038 (2A(RHF))'),
  ('9038-L(LHF)', '400-A001', 0, '{"24":{"P2":105000},"30":{"P2":110000}}'::jsonb, false, 'AM9038 (L(LHF))'),
  ('9038-L(RHF)', '400-A001', 0, '{"24":{"P2":105000},"30":{"P2":110000}}'::jsonb, false, 'AM9038 (L(RHF))'),
  ('9038-CNR', '400-A001', 0, '{"24":{"P2":83000},"30":{"P2":83000}}'::jsonb, false, 'AM9038 (CNR)'),
  ('9038-1S', '400-0003', 0, '{"24":{"P2":78200},"30":{"P2":84000}}'::jsonb, true, 'DSL9038 (1S)'),
  ('9038-2S', '400-0003', 0, '{"24":{"P2":112200},"30":{"P2":120500}}'::jsonb, true, 'DSL9038 (2S)'),
  ('9038-3S', '400-0003', 0, '{"24":{"P2":149600},"30":{"P2":160600}}'::jsonb, true, 'DSL9038 (3S)'),
  ('9038-1NA', '400-0003', 0, '{"24":{"P2":55000},"30":{"P2":55000}}'::jsonb, true, 'DSL9038 (1NA)'),
  ('9038-1A(RHF)', '400-0003', 0, '{"24":{"P2":58000},"30":{"P2":60000}}'::jsonb, true, 'DSL9038 (1A(RHF))'),
  ('9038-2A(LHF)', '400-0003', 0, '{"24":{"P2":106000},"30":{"P2":110000}}'::jsonb, true, 'DSL9038 (2A(LHF))'),
  ('9038-2A(RHF)', '400-0003', 0, '{"24":{"P2":106000},"30":{"P2":110000}}'::jsonb, true, 'DSL9038 (2A(RHF))'),
  ('9038-2NA', '400-0003', 0, '{"24":{"P2":96000},"30":{"P2":100000}}'::jsonb, true, 'DSL9038 (2NA)'),
  ('9038-L(LHF)', '400-0003', 0, '{"24":{"P2":105000},"30":{"P2":110000}}'::jsonb, true, 'DSL9038 (L(LHF))'),
  ('9038-L(RHF)', '400-0003', 0, '{"24":{"P2":105000},"30":{"P2":110000}}'::jsonb, true, 'DSL9038 (L(RHF))'),
  ('9038-CNR', '400-0003', 0, '{"24":{"P2":84000},"30":{"P2":84000}}'::jsonb, true, 'DSL9038 (CNR)'),
  ('9050-2S', '400-A001', 0, '{"24":{"P2":132000},"26":{"P2":138600},"28":{"P2":138600},"30":{"P2":138600},"32":{"P2":145200},"35":{"P2":151800}}'::jsonb, null, 'AM9050 (2S)'),
  ('9050-3S', '400-A001', 0, '{"24":{"P2":176000},"26":{"P2":184800},"28":{"P2":184800},"30":{"P2":184800},"32":{"P2":193600},"35":{"P2":202400}}'::jsonb, null, 'AM9050 (3S)'),
  ('9050-2A(LHF)', '400-A001', 0, '{"24":{"P2":140000},"26":{"P2":150000},"28":{"P2":150000},"30":{"P2":150000},"32":{"P2":160000},"35":{"P2":166000}}'::jsonb, null, 'AM9050 (2A(LHF))'),
  ('9050-2A(RHF)', '400-A001', 0, '{"24":{"P2":140000},"26":{"P2":150000},"28":{"P2":150000},"30":{"P2":150000},"32":{"P2":160000},"35":{"P2":166000}}'::jsonb, null, 'AM9050 (2A(RHF))'),
  ('9050-L(LHF)', '400-A001', 0, '{"24":{"P2":120000},"26":{"P2":120000},"28":{"P2":120000},"30":{"P2":120000},"32":{"P2":125000},"35":{"P2":130000}}'::jsonb, null, 'AM9050 (L(LHF))'),
  ('9050-L(RHF)', '400-A001', 0, '{"24":{"P2":120000},"26":{"P2":120000},"28":{"P2":120000},"30":{"P2":120000},"32":{"P2":125000},"35":{"P2":130000}}'::jsonb, null, 'AM9050 (L(RHF))'),
  ('9053-2S', '400-A001', 0, '{"24":{"P2":108900},"30":{"P2":115500}}'::jsonb, null, 'AM9053 (2S)'),
  ('9053-3S', '400-A001', 0, '{"24":{"P2":145200},"30":{"P2":154000}}'::jsonb, null, 'AM9053 (3S)'),
  ('9055-1S', '400-A001', 0, '{"24":{"P2":80500},"26":{"P2":85100},"28":{"P2":85100},"30":{"P2":87400}}'::jsonb, false, 'AM9055 (1S)'),
  ('9055-2S', '400-A001', 0, '{"24":{"P2":115500},"26":{"P2":122100},"28":{"P2":122100},"30":{"P2":125400}}'::jsonb, false, 'AM9055 (2S)'),
  ('9055-3S', '400-A001', 0, '{"24":{"P2":154000},"26":{"P2":162800},"28":{"P2":162800},"30":{"P2":167200}}'::jsonb, false, 'AM9055 (3S)'),
  ('9055-1NA', '400-A001', 0, '{"24":{"P2":50000},"26":{"P2":55000},"28":{"P2":55000},"30":{"P2":55000}}'::jsonb, false, 'AM9055 (1NA)'),
  ('9055-2A(LHF)', '400-A001', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":121000}}'::jsonb, false, 'AM9055 (2A(LHF))'),
  ('9055-2A(RHF)', '400-A001', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":121000}}'::jsonb, false, 'AM9055 (2A(RHF))'),
  ('9055-L(LHF)', '400-A001', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":115000}}'::jsonb, false, 'AM9055 (L(LHF))'),
  ('9055-L(RHF)', '400-A001', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":115000}}'::jsonb, false, 'AM9055 (L(RHF))'),
  ('9055-1S', '400-0003', 0, '{"24":{"P2":80500},"26":{"P2":86300},"28":{"P2":86300},"30":{"P2":92000}}'::jsonb, true, 'DSL9055 (1S)'),
  ('9055-2S', '400-0003', 0, '{"24":{"P2":115500},"26":{"P2":123800},"28":{"P2":123800},"30":{"P2":132000}}'::jsonb, true, 'DSL9055 (2S)'),
  ('9055-3S', '400-0003', 0, '{"24":{"P2":154000},"26":{"P2":165000},"28":{"P2":165000},"30":{"P2":176000}}'::jsonb, true, 'DSL9055 (3S)'),
  ('9055-1NA', '400-0003', 0, '{"24":{"P2":50000},"26":{"P2":55000},"28":{"P2":55000},"30":{"P2":55000}}'::jsonb, true, 'DSL9055 (1NA)'),
  ('9055-2A(LHF)', '400-0003', 0, '{"24":{"P2":110000},"26":{"P2":120000},"28":{"P2":120000},"30":{"P2":120000}}'::jsonb, true, 'DSL9055 (2A(LHF))'),
  ('9055-2A(RHF)', '400-0003', 0, '{"24":{"P2":110000},"26":{"P2":120000},"28":{"P2":120000},"30":{"P2":120000}}'::jsonb, true, 'DSL9055 (2A(RHF))'),
  ('9055-L(LHF)', '400-0003', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":116000}}'::jsonb, true, 'DSL9055 (L(LHF))'),
  ('9055-L(RHF)', '400-0003', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":116000}}'::jsonb, true, 'DSL9055 (L(RHF))'),
  ('9079-2S', '400-A001', 0, '{"24":{"P2":108900},"28":{"P2":118800}}'::jsonb, null, 'AM9079 (2S)'),
  ('8019-1S', '400-0003', 0, '{"30":{"P2":81700}}'::jsonb, null, 'DSL8019 (1S)'),
  ('8019-2S', '400-0003', 0, '{"30":{"P2":117200}}'::jsonb, null, 'DSL8019 (2S)'),
  ('8019-3S', '400-0003', 0, '{"30":{"P2":156200}}'::jsonb, null, 'DSL8019 (3S)'),
  ('8022-1S', '400-0003', 0, '{"32":{"P2":81700}}'::jsonb, null, 'DSL8022 (1S)'),
  ('8022-2S', '400-0003', 0, '{"32":{"P2":117200}}'::jsonb, null, 'DSL8022 (2S)'),
  ('8022-3S', '400-0003', 0, '{"32":{"P2":156200}}'::jsonb, null, 'DSL8022 (3S)'),
  ('8075-2S', '400-0003', 0, '{"24":{"P2":105600},"28":{"P2":115500}}'::jsonb, null, 'DSL8075 (2S)'),
  ('8075-3S', '400-0003', 0, '{"24":{"P2":140800},"28":{"P2":154000}}'::jsonb, null, 'DSL8075 (3S)'),
  ('5531-1S', '400-O001', 0, '{"24":{"P2":76073},"26":{"P2":87400},"28":{"P2":82593},"30":{"P2":82593},"32":{"P2":86940},"35":{"P2":95634}}'::jsonb, null, 'HK5531 (1S)'),
  ('5531-2S', '400-O001', 0, '{"24":{"P2":109148},"26":{"P2":125400},"28":{"P2":118503},"30":{"P2":124740},"32":{"P2":130977},"35":{"P2":137214}}'::jsonb, null, 'HK5531 (2S)'),
  ('5531-3S', '400-O001', 0, '{"24":{"P2":145530},"26":{"P2":167200},"28":{"P2":158004},"30":{"P2":166320},"32":{"P2":174636},"35":{"P2":182952}}'::jsonb, null, 'HK5531 (3S)'),
  ('5531-1A(LHF)', '400-O001', 0, '{"24":{"P2":61425},"26":{"P2":70000},"28":{"P2":66150},"30":{"P2":66150},"32":{"P2":70875},"35":{"P2":75600}}'::jsonb, null, 'HK5531 (1A(LHF))'),
  ('5531-1A(RHF)', '400-O001', 0, '{"24":{"P2":61425},"26":{"P2":70000},"28":{"P2":66150},"30":{"P2":66150},"32":{"P2":70875},"35":{"P2":75600}}'::jsonb, null, 'HK5531 (1A(RHF))'),
  ('5531-L(LHF)', '400-O001', 0, '{"24":{"P2":99225},"26":{"P2":110000},"28":{"P2":103950},"30":{"P2":109620},"32":{"P2":113400},"35":{"P2":118125}}'::jsonb, null, 'HK5531 (L(LHF))'),
  ('5531-L(RHF)', '400-O001', 0, '{"24":{"P2":99225},"26":{"P2":110000},"28":{"P2":103950},"30":{"P2":109620},"32":{"P2":113400},"35":{"P2":118125}}'::jsonb, null, 'HK5531 (L(RHF))'),
  ('5535-1S', '400-O001', 0, '{"24":{"P2":76200},"26":{"P2":81000},"28":{"P2":81000},"30":{"P2":81000},"32":{"P2":86000},"35":{"P2":91000}}'::jsonb, null, 'HK5535 (1S)'),
  ('5535-2S', '400-O001', 0, '{"24":{"P2":111600},"26":{"P2":118400},"28":{"P2":118400},"30":{"P2":118400},"32":{"P2":128000},"35":{"P2":138000}}'::jsonb, null, 'HK5535 (2S)'),
  ('5535-3S', '400-O001', 0, '{"24":{"P2":150400},"26":{"P2":159500},"28":{"P2":159500},"30":{"P2":159500},"32":{"P2":170000},"35":{"P2":180000}}'::jsonb, null, 'HK5535 (3S)'),
  ('5535-2A(LHF)', '400-O001', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":110000},"32":{"P2":120000},"35":{"P2":130000}}'::jsonb, null, 'HK5535 (2A(LHF))'),
  ('5535-2A(RHF)', '400-O001', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":110000},"32":{"P2":120000},"35":{"P2":130000}}'::jsonb, null, 'HK5535 (2A(RHF))'),
  ('5535-L(LHF)', '400-O001', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":110000},"32":{"P2":120000},"35":{"P2":125000}}'::jsonb, null, 'HK5535 (L(LHF))'),
  ('5535-L(RHF)', '400-O001', 0, '{"24":{"P2":105000},"26":{"P2":110000},"28":{"P2":110000},"30":{"P2":110000},"32":{"P2":120000},"35":{"P2":125000}}'::jsonb, null, 'HK5535 (L(RHF))'),
  ('5539-2S', '400-O001', 0, '{"24":{"P2":109148},"26":{"P2":125400},"28":{"P2":118503},"30":{"P2":124740},"32":{"P2":130977},"35":{"P2":137214}}'::jsonb, null, 'HK5539 (2S)'),
  ('SOLACE SOFTCLOUD MATT (SK)', '400-MS01', 234650, null, null, null),
  ('SOLACE SOFTCLOUD MATT (K)', '400-MS01', 180500, null, null, null),
  ('SOLACE SOFTCLOUD MATT (Q)', '400-MS01', 150600, null, null, null),
  ('SOLACE FIRMCARE MATT (SK)', '400-MS01', 202150, null, null, null),
  ('SOLACE FIRMCARE MATT (K)', '400-MS01', 155500, null, null, null),
  ('SOLACE FIRMCARE MATT (Q)', '400-MS01', 129600, null, null, null),
  ('HAVEN SOFTCLOUD MATT (SK)', '400-MS01', 162370, null, null, null),
  ('HAVEN SOFTCLOUD MATT (K)', '400-MS01', 124900, null, null, null),
  ('HAVEN SOFTCLOUD MATT (Q)', '400-MS01', 104100, null, null, null),
  ('HAVEN FIRMCARE MATT (SK)', '400-MS01', 162370, null, null, null),
  ('HAVEN FIRMCARE MATT (K)', '400-MS01', 124900, null, null, null),
  ('HAVEN FIRMCARE MATT (Q)', '400-MS01', 104100, null, null, null),
  ('MERIDIAN SOFTCLOUD MATT (SK)', '400-MS01', 146900, null, null, null),
  ('MERIDIAN SOFTCLOUD MATT (K)', '400-MS01', 113000, null, null, null),
  ('MERIDIAN SOFTCLOUD MATT (Q)', '400-MS01', 94280, null, null, null),
  ('MERIDIAN FIRMCARE MATT (SK)', '400-MS01', 146900, null, null, null),
  ('MERIDIAN FIRMCARE MATT (K)', '400-MS01', 113000, null, null, null),
  ('MERIDIAN FIRMCARE MATT (Q)', '400-MS01', 94280, null, null, null),
  ('BREEZE SOFTCLOUD MATT (SK)', '400-MS01', 135200, null, null, null),
  ('BREEZE SOFTCLOUD MATT (K)', '400-MS01', 104000, null, null, null),
  ('BREEZE SOFTCLOUD MATT (Q)', '400-MS01', 87000, null, null, null),
  ('BREEZE SOFTCLOUD MATT (SS)', '400-MS01', 67860, null, null, null),
  ('BREEZE SOFTCLOUD MATT (S)', '400-MS01', 60000, null, null, null),
  ('BREEZE FIRMCARE MATT (SK)', '400-MS01', 135200, null, null, null),
  ('BREEZE FIRMCARE MATT (K)', '400-MS01', 104000, null, null, null),
  ('BREEZE FIRMCARE MATT (Q)', '400-MS01', 87000, null, null, null),
  ('BREEZE FIRMCARE MATT (SS)', '400-MS01', 67860, null, null, null),
  ('BREEZE FIRMCARE MATT (S)', '400-MS01', 60000, null, null, null),
  ('LUMI SOFTCLOUD MATT (SK)', '400-MS01', 108550, null, null, null),
  ('LUMI SOFTCLOUD MATT (K)', '400-MS01', 83500, null, null, null),
  ('LUMI SOFTCLOUD MATT (Q)', '400-MS01', 69600, null, null, null),
  ('LUMI SOFTCLOUD MATT (SS)', '400-MS01', 54280, null, null, null),
  ('LUMI SOFTCLOUD MATT (S)', '400-MS01', 48000, null, null, null),
  ('LUMI FIRMCARE MATT (SK)', '400-MS01', 108550, null, null, null),
  ('LUMI FIRMCARE MATT (K)', '400-MS01', 83500, null, null, null),
  ('LUMI FIRMCARE MATT (Q)', '400-MS01', 69600, null, null, null),
  ('LUMI FIRMCARE MATT (SS)', '400-MS01', 54280, null, null, null),
  ('LUMI FIRMCARE MATT (S)', '400-MS01', 48000, null, null, null),
  ('NATURALEX FIRMCARE MATT (K)', '400-MS01', 199500, null, null, null),
  ('NATURALEX FIRMCARE MATT (Q)', '400-MS01', 166500, null, null, null),
  ('NATURALEX FIRMCARE MATT (S)', '400-MS01', 110000, null, null, null),
  ('NATURALEX SOFTCLOUD MATT (K)', '400-MS01', 175500, null, null, null),
  ('NATURALEX SOFTCLOUD MATT (Q)', '400-MS01', 146500, null, null, null),
  ('NATURALEX SOFTCLOUD MATT (S)', '400-MS01', 98500, null, null, null),
  ('FORTE MATT (SK)', '400-MS01', 91650, null, null, null),
  ('FORTE MATT (K)', '400-MS01', 70500, null, null, null),
  ('FORTE MATT (Q)', '400-MS01', 59000, null, null, null),
  ('FORTE MATT (SS)', '400-MS01', 46100, null, null, null),
  ('FORTE MATT (S)', '400-MS01', 40800, null, null, null),
  ('SONIC MATT (K)', '400-MS01', 70500, null, null, null),
  ('CODY-(K)', '400-O001', 55000, '{"P2":55000}'::jsonb, null, null),
  ('CODY-(Q)', '400-O001', 42500, '{"P2":42500}'::jsonb, null, null),
  ('CODY-(S)', '400-O001', 39500, '{"P2":39500}'::jsonb, null, null),
  ('CODY-(SS)', '400-O001', 40750, '{"P2":40750}'::jsonb, null, null),
  ('JAGER-(K)', '400-O001', 43000, '{"P2":43000}'::jsonb, null, null),
  ('JAGER-(Q)', '400-O001', 30500, '{"P2":30500}'::jsonb, null, null),
  ('JAGER-(S)', '400-O001', 27500, '{"P2":27500}'::jsonb, null, null),
  ('JAGER-(SS)', '400-O001', 28750, '{"P2":28750}'::jsonb, null, null),
  ('REGAL (A)-(K)', '400-O001', 70000, '{"P2":70000}'::jsonb, null, null),
  ('REGAL (A)-(Q)', '400-O001', 57500, '{"P2":57500}'::jsonb, null, null),
  ('REGAL (A)-(S)', '400-O001', 48500, '{"P2":48500}'::jsonb, null, null),
  ('REGAL (A)-(SS)', '400-O001', 53750, '{"P2":53750}'::jsonb, null, null),
  ('TRION (A)-(K)', '400-O001', 83000, '{"P2":83000}'::jsonb, null, null),
  ('TRION (A)-(Q)', '400-O001', 72500, '{"P2":72500}'::jsonb, null, null),
  ('TRION (A)-(SS)', '400-O001', 68750, '{"P2":68750}'::jsonb, null, null),
  ('2010(A)-(K)', '400-O001', 83000, '{"P2":83000}'::jsonb, null, null),
  ('2010(A)-(Q)', '400-O001', 72500, '{"P2":72500}'::jsonb, null, null),
  ('2010(A)-(SS)', '400-O001', 68750, '{"P2":68750}'::jsonb, null, null),
  ('DIVAN ONLY-(K)', '400-O001', 45000, '{"P2":45000}'::jsonb, null, null),
  ('DIVAN ONLY-(Q)', '400-O001', 32500, '{"P2":32500}'::jsonb, null, null),
  ('DIVAN ONLY-(S)', '400-O001', 29500, '{"P2":29500}'::jsonb, null, null),
  ('DIVAN ONLY-(SS)', '400-O001', 30750, '{"P2":30750}'::jsonb, null, null);

create temp table _cost_p (code text, cost_sen int, base_sen int, seat jsonb) on commit drop;
insert into _cost_p values
  ('9036-1NA', 55000, null, '[{"height":"24","tier":"PRICE_2","priceSen":55000},{"height":"30","tier":"PRICE_2","priceSen":55000}]'::jsonb),
  ('9036-1S', 78200, null, '[{"height":"24","tier":"PRICE_2","priceSen":78200},{"height":"30","tier":"PRICE_2","priceSen":82800}]'::jsonb),
  ('9036-2S', 112200, null, '[{"height":"24","tier":"PRICE_2","priceSen":112200},{"height":"30","tier":"PRICE_2","priceSen":118800}]'::jsonb),
  ('9036-3S', 149600, null, '[{"height":"24","tier":"PRICE_2","priceSen":149600},{"height":"30","tier":"PRICE_2","priceSen":158400}]'::jsonb),
  ('9038-1A(RHF)', 58000, null, '[{"height":"24","tier":"PRICE_2","priceSen":58000},{"height":"30","tier":"PRICE_2","priceSen":61000}]'::jsonb),
  ('9038-1NA', 55000, null, '[{"height":"24","tier":"PRICE_2","priceSen":55000},{"height":"30","tier":"PRICE_2","priceSen":55000}]'::jsonb),
  ('9038-1S', 78200, null, '[{"height":"24","tier":"PRICE_2","priceSen":78200},{"height":"30","tier":"PRICE_2","priceSen":84000}]'::jsonb),
  ('9038-2A(LHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"30","tier":"PRICE_2","priceSen":111000}]'::jsonb),
  ('9038-2A(RHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"30","tier":"PRICE_2","priceSen":111000}]'::jsonb),
  ('9038-2NA', 96000, null, '[{"height":"24","tier":"PRICE_2","priceSen":96000},{"height":"30","tier":"PRICE_2","priceSen":100000}]'::jsonb),
  ('9038-2S', 112200, null, '[{"height":"24","tier":"PRICE_2","priceSen":112200},{"height":"30","tier":"PRICE_2","priceSen":120500}]'::jsonb),
  ('9038-3S', 149600, null, '[{"height":"24","tier":"PRICE_2","priceSen":149600},{"height":"30","tier":"PRICE_2","priceSen":160600}]'::jsonb),
  ('9038-CNR', 84000, null, '[{"height":"24","tier":"PRICE_2","priceSen":84000},{"height":"30","tier":"PRICE_2","priceSen":84000}]'::jsonb),
  ('9038-L(LHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"30","tier":"PRICE_2","priceSen":110000}]'::jsonb),
  ('9038-L(RHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"30","tier":"PRICE_2","priceSen":110000}]'::jsonb),
  ('9050-2A(LHF)', 140000, null, '[{"height":"24","tier":"PRICE_2","priceSen":140000},{"height":"26","tier":"PRICE_2","priceSen":150000},{"height":"28","tier":"PRICE_2","priceSen":150000},{"height":"30","tier":"PRICE_2","priceSen":150000},{"height":"32","tier":"PRICE_2","priceSen":160000},{"height":"35","tier":"PRICE_2","priceSen":166000}]'::jsonb),
  ('9050-2A(RHF)', 140000, null, '[{"height":"24","tier":"PRICE_2","priceSen":140000},{"height":"26","tier":"PRICE_2","priceSen":150000},{"height":"28","tier":"PRICE_2","priceSen":150000},{"height":"30","tier":"PRICE_2","priceSen":150000},{"height":"32","tier":"PRICE_2","priceSen":160000},{"height":"35","tier":"PRICE_2","priceSen":166000}]'::jsonb),
  ('9050-2S', 132000, null, '[{"height":"24","tier":"PRICE_2","priceSen":132000},{"height":"26","tier":"PRICE_2","priceSen":138600},{"height":"28","tier":"PRICE_2","priceSen":138600},{"height":"30","tier":"PRICE_2","priceSen":138600},{"height":"32","tier":"PRICE_2","priceSen":145200},{"height":"35","tier":"PRICE_2","priceSen":151800}]'::jsonb),
  ('9050-3S', 176000, null, '[{"height":"24","tier":"PRICE_2","priceSen":176000},{"height":"26","tier":"PRICE_2","priceSen":184800},{"height":"28","tier":"PRICE_2","priceSen":184800},{"height":"30","tier":"PRICE_2","priceSen":184800},{"height":"32","tier":"PRICE_2","priceSen":193600},{"height":"35","tier":"PRICE_2","priceSen":202400}]'::jsonb),
  ('9050-L(LHF)', 120000, null, '[{"height":"24","tier":"PRICE_2","priceSen":120000},{"height":"26","tier":"PRICE_2","priceSen":120000},{"height":"28","tier":"PRICE_2","priceSen":120000},{"height":"30","tier":"PRICE_2","priceSen":120000},{"height":"32","tier":"PRICE_2","priceSen":125000},{"height":"35","tier":"PRICE_2","priceSen":130000}]'::jsonb),
  ('9050-L(RHF)', 120000, null, '[{"height":"24","tier":"PRICE_2","priceSen":120000},{"height":"26","tier":"PRICE_2","priceSen":120000},{"height":"28","tier":"PRICE_2","priceSen":120000},{"height":"30","tier":"PRICE_2","priceSen":120000},{"height":"32","tier":"PRICE_2","priceSen":125000},{"height":"35","tier":"PRICE_2","priceSen":130000}]'::jsonb),
  ('9053-2S', 108900, null, '[{"height":"24","tier":"PRICE_2","priceSen":108900},{"height":"30","tier":"PRICE_2","priceSen":115500}]'::jsonb),
  ('9053-3S', 145200, null, '[{"height":"24","tier":"PRICE_2","priceSen":145200},{"height":"30","tier":"PRICE_2","priceSen":154000}]'::jsonb),
  ('9055-1NA', 50000, null, '[{"height":"24","tier":"PRICE_2","priceSen":50000},{"height":"26","tier":"PRICE_2","priceSen":55000},{"height":"28","tier":"PRICE_2","priceSen":55000},{"height":"30","tier":"PRICE_2","priceSen":55000}]'::jsonb),
  ('9055-1S', 80500, null, '[{"height":"24","tier":"PRICE_2","priceSen":80500},{"height":"26","tier":"PRICE_2","priceSen":86300},{"height":"28","tier":"PRICE_2","priceSen":86300},{"height":"30","tier":"PRICE_2","priceSen":92000}]'::jsonb),
  ('9055-2A(LHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":110000},{"height":"30","tier":"PRICE_2","priceSen":121000}]'::jsonb),
  ('9055-2A(RHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":110000},{"height":"30","tier":"PRICE_2","priceSen":121000}]'::jsonb),
  ('9055-2S', 115500, null, '[{"height":"24","tier":"PRICE_2","priceSen":115500},{"height":"26","tier":"PRICE_2","priceSen":123800},{"height":"28","tier":"PRICE_2","priceSen":123800},{"height":"30","tier":"PRICE_2","priceSen":132000}]'::jsonb),
  ('9055-3S', 154000, null, '[{"height":"24","tier":"PRICE_2","priceSen":154000},{"height":"26","tier":"PRICE_2","priceSen":165000},{"height":"28","tier":"PRICE_2","priceSen":165000},{"height":"30","tier":"PRICE_2","priceSen":176000}]'::jsonb),
  ('9055-L(LHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":110000},{"height":"30","tier":"PRICE_2","priceSen":116000}]'::jsonb),
  ('9055-L(RHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":110000},{"height":"30","tier":"PRICE_2","priceSen":116000}]'::jsonb),
  ('9079-2S', 108900, null, '[{"height":"24","tier":"PRICE_2","priceSen":108900},{"height":"28","tier":"PRICE_2","priceSen":118800}]'::jsonb),
  ('8019-1S', 81700, null, '[{"height":"30","tier":"PRICE_2","priceSen":81700}]'::jsonb),
  ('8019-2S', 117200, null, '[{"height":"30","tier":"PRICE_2","priceSen":117200}]'::jsonb),
  ('8019-3S', 156200, null, '[{"height":"30","tier":"PRICE_2","priceSen":156200}]'::jsonb),
  ('8022-1S', 81700, null, '[{"height":"32","tier":"PRICE_2","priceSen":81700}]'::jsonb),
  ('8022-2S', 117200, null, '[{"height":"32","tier":"PRICE_2","priceSen":117200}]'::jsonb),
  ('8022-3S', 156200, null, '[{"height":"32","tier":"PRICE_2","priceSen":156200}]'::jsonb),
  ('8075-2S', 105600, null, '[{"height":"24","tier":"PRICE_2","priceSen":105600},{"height":"28","tier":"PRICE_2","priceSen":115500}]'::jsonb),
  ('8075-3S', 140800, null, '[{"height":"24","tier":"PRICE_2","priceSen":140800},{"height":"28","tier":"PRICE_2","priceSen":154000}]'::jsonb),
  ('5531-1A(LHF)', 61425, null, '[{"height":"24","tier":"PRICE_2","priceSen":61425},{"height":"26","tier":"PRICE_2","priceSen":70000},{"height":"28","tier":"PRICE_2","priceSen":66150},{"height":"30","tier":"PRICE_2","priceSen":66150},{"height":"32","tier":"PRICE_2","priceSen":70875},{"height":"35","tier":"PRICE_2","priceSen":75600}]'::jsonb),
  ('5531-1A(RHF)', 61425, null, '[{"height":"24","tier":"PRICE_2","priceSen":61425},{"height":"26","tier":"PRICE_2","priceSen":70000},{"height":"28","tier":"PRICE_2","priceSen":66150},{"height":"30","tier":"PRICE_2","priceSen":66150},{"height":"32","tier":"PRICE_2","priceSen":70875},{"height":"35","tier":"PRICE_2","priceSen":75600}]'::jsonb),
  ('5531-1S', 76073, null, '[{"height":"24","tier":"PRICE_2","priceSen":76073},{"height":"26","tier":"PRICE_2","priceSen":87400},{"height":"28","tier":"PRICE_2","priceSen":82593},{"height":"30","tier":"PRICE_2","priceSen":82593},{"height":"32","tier":"PRICE_2","priceSen":86940},{"height":"35","tier":"PRICE_2","priceSen":95634}]'::jsonb),
  ('5531-2S', 109148, null, '[{"height":"24","tier":"PRICE_2","priceSen":109148},{"height":"26","tier":"PRICE_2","priceSen":125400},{"height":"28","tier":"PRICE_2","priceSen":118503},{"height":"30","tier":"PRICE_2","priceSen":124740},{"height":"32","tier":"PRICE_2","priceSen":130977},{"height":"35","tier":"PRICE_2","priceSen":137214}]'::jsonb),
  ('5531-3S', 145530, null, '[{"height":"24","tier":"PRICE_2","priceSen":145530},{"height":"26","tier":"PRICE_2","priceSen":167200},{"height":"28","tier":"PRICE_2","priceSen":158004},{"height":"30","tier":"PRICE_2","priceSen":166320},{"height":"32","tier":"PRICE_2","priceSen":174636},{"height":"35","tier":"PRICE_2","priceSen":182952}]'::jsonb),
  ('5531-L(LHF)', 99225, null, '[{"height":"24","tier":"PRICE_2","priceSen":99225},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":103950},{"height":"30","tier":"PRICE_2","priceSen":109620},{"height":"32","tier":"PRICE_2","priceSen":113400},{"height":"35","tier":"PRICE_2","priceSen":118125}]'::jsonb),
  ('5531-L(RHF)', 99225, null, '[{"height":"24","tier":"PRICE_2","priceSen":99225},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":103950},{"height":"30","tier":"PRICE_2","priceSen":109620},{"height":"32","tier":"PRICE_2","priceSen":113400},{"height":"35","tier":"PRICE_2","priceSen":118125}]'::jsonb),
  ('5535-1S', 76200, null, '[{"height":"24","tier":"PRICE_2","priceSen":76200},{"height":"26","tier":"PRICE_2","priceSen":81000},{"height":"28","tier":"PRICE_2","priceSen":81000},{"height":"30","tier":"PRICE_2","priceSen":81000},{"height":"32","tier":"PRICE_2","priceSen":86000},{"height":"35","tier":"PRICE_2","priceSen":91000}]'::jsonb),
  ('5535-2A(LHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":110000},{"height":"30","tier":"PRICE_2","priceSen":110000},{"height":"32","tier":"PRICE_2","priceSen":120000},{"height":"35","tier":"PRICE_2","priceSen":130000}]'::jsonb),
  ('5535-2A(RHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":110000},{"height":"30","tier":"PRICE_2","priceSen":110000},{"height":"32","tier":"PRICE_2","priceSen":120000},{"height":"35","tier":"PRICE_2","priceSen":130000}]'::jsonb),
  ('5535-2S', 111600, null, '[{"height":"24","tier":"PRICE_2","priceSen":111600},{"height":"26","tier":"PRICE_2","priceSen":118400},{"height":"28","tier":"PRICE_2","priceSen":118400},{"height":"30","tier":"PRICE_2","priceSen":118400},{"height":"32","tier":"PRICE_2","priceSen":128000},{"height":"35","tier":"PRICE_2","priceSen":138000}]'::jsonb),
  ('5535-3S', 150400, null, '[{"height":"24","tier":"PRICE_2","priceSen":150400},{"height":"26","tier":"PRICE_2","priceSen":159500},{"height":"28","tier":"PRICE_2","priceSen":159500},{"height":"30","tier":"PRICE_2","priceSen":159500},{"height":"32","tier":"PRICE_2","priceSen":170000},{"height":"35","tier":"PRICE_2","priceSen":180000}]'::jsonb),
  ('5535-L(LHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":110000},{"height":"30","tier":"PRICE_2","priceSen":110000},{"height":"32","tier":"PRICE_2","priceSen":120000},{"height":"35","tier":"PRICE_2","priceSen":125000}]'::jsonb),
  ('5535-L(RHF)', 105000, null, '[{"height":"24","tier":"PRICE_2","priceSen":105000},{"height":"26","tier":"PRICE_2","priceSen":110000},{"height":"28","tier":"PRICE_2","priceSen":110000},{"height":"30","tier":"PRICE_2","priceSen":110000},{"height":"32","tier":"PRICE_2","priceSen":120000},{"height":"35","tier":"PRICE_2","priceSen":125000}]'::jsonb),
  ('5539-2S', 109148, null, '[{"height":"24","tier":"PRICE_2","priceSen":109148},{"height":"26","tier":"PRICE_2","priceSen":125400},{"height":"28","tier":"PRICE_2","priceSen":118503},{"height":"30","tier":"PRICE_2","priceSen":124740},{"height":"32","tier":"PRICE_2","priceSen":130977},{"height":"35","tier":"PRICE_2","priceSen":137214}]'::jsonb),
  ('SOLACE SOFTCLOUD MATT (SK)', 234650, 234650, null),
  ('SOLACE SOFTCLOUD MATT (K)', 180500, 180500, null),
  ('SOLACE SOFTCLOUD MATT (Q)', 150600, 150600, null),
  ('SOLACE FIRMCARE MATT (SK)', 202150, 202150, null),
  ('SOLACE FIRMCARE MATT (K)', 155500, 155500, null),
  ('SOLACE FIRMCARE MATT (Q)', 129600, 129600, null),
  ('HAVEN SOFTCLOUD MATT (SK)', 162370, 162370, null),
  ('HAVEN SOFTCLOUD MATT (K)', 124900, 124900, null),
  ('HAVEN SOFTCLOUD MATT (Q)', 104100, 104100, null),
  ('HAVEN FIRMCARE MATT (SK)', 162370, 162370, null),
  ('HAVEN FIRMCARE MATT (K)', 124900, 124900, null),
  ('HAVEN FIRMCARE MATT (Q)', 104100, 104100, null),
  ('MERIDIAN SOFTCLOUD MATT (SK)', 146900, 146900, null),
  ('MERIDIAN SOFTCLOUD MATT (K)', 113000, 113000, null),
  ('MERIDIAN SOFTCLOUD MATT (Q)', 94280, 94280, null),
  ('MERIDIAN FIRMCARE MATT (SK)', 146900, 146900, null),
  ('MERIDIAN FIRMCARE MATT (K)', 113000, 113000, null),
  ('MERIDIAN FIRMCARE MATT (Q)', 94280, 94280, null),
  ('BREEZE SOFTCLOUD MATT (SK)', 135200, 135200, null),
  ('BREEZE SOFTCLOUD MATT (K)', 104000, 104000, null),
  ('BREEZE SOFTCLOUD MATT (Q)', 87000, 87000, null),
  ('BREEZE SOFTCLOUD MATT (SS)', 67860, 67860, null),
  ('BREEZE SOFTCLOUD MATT (S)', 60000, 60000, null),
  ('BREEZE FIRMCARE MATT (SK)', 135200, 135200, null),
  ('BREEZE FIRMCARE MATT (K)', 104000, 104000, null),
  ('BREEZE FIRMCARE MATT (Q)', 87000, 87000, null),
  ('BREEZE FIRMCARE MATT (SS)', 67860, 67860, null),
  ('BREEZE FIRMCARE MATT (S)', 60000, 60000, null),
  ('LUMI SOFTCLOUD MATT (SK)', 108550, 108550, null),
  ('LUMI SOFTCLOUD MATT (K)', 83500, 83500, null),
  ('LUMI SOFTCLOUD MATT (Q)', 69600, 69600, null),
  ('LUMI SOFTCLOUD MATT (SS)', 54280, 54280, null),
  ('LUMI SOFTCLOUD MATT (S)', 48000, 48000, null),
  ('LUMI FIRMCARE MATT (SK)', 108550, 108550, null),
  ('LUMI FIRMCARE MATT (K)', 83500, 83500, null),
  ('LUMI FIRMCARE MATT (Q)', 69600, 69600, null),
  ('LUMI FIRMCARE MATT (SS)', 54280, 54280, null),
  ('LUMI FIRMCARE MATT (S)', 48000, 48000, null),
  ('NATURALEX FIRMCARE MATT (K)', 199500, 199500, null),
  ('NATURALEX FIRMCARE MATT (Q)', 166500, 166500, null),
  ('NATURALEX FIRMCARE MATT (S)', 110000, 110000, null),
  ('NATURALEX SOFTCLOUD MATT (K)', 175500, 175500, null),
  ('NATURALEX SOFTCLOUD MATT (Q)', 146500, 146500, null),
  ('NATURALEX SOFTCLOUD MATT (S)', 98500, 98500, null),
  ('FORTE MATT (SK)', 91650, 91650, null),
  ('FORTE MATT (K)', 70500, 70500, null),
  ('FORTE MATT (Q)', 59000, 59000, null),
  ('FORTE MATT (SS)', 46100, 46100, null),
  ('FORTE MATT (S)', 40800, 40800, null),
  ('SONIC MATT (K)', 70500, 70500, null),
  ('CODY-(K)', 55000, 55000, null),
  ('CODY-(Q)', 42500, 42500, null),
  ('CODY-(S)', 39500, 39500, null),
  ('CODY-(SS)', 40750, 40750, null),
  ('JAGER-(K)', 43000, 43000, null),
  ('JAGER-(Q)', 30500, 30500, null),
  ('JAGER-(S)', 27500, 27500, null),
  ('JAGER-(SS)', 28750, 28750, null),
  ('REGAL (A)-(K)', 70000, 70000, null),
  ('REGAL (A)-(Q)', 57500, 57500, null),
  ('REGAL (A)-(S)', 48500, 48500, null),
  ('REGAL (A)-(SS)', 53750, 53750, null),
  ('TRION (A)-(K)', 83000, 83000, null),
  ('TRION (A)-(Q)', 72500, 72500, null),
  ('TRION (A)-(SS)', 68750, 68750, null),
  ('2010(A)-(K)', 83000, 83000, null),
  ('2010(A)-(Q)', 72500, 72500, null),
  ('2010(A)-(SS)', 68750, 68750, null),
  ('DIVAN ONLY-(K)', 45000, 45000, null),
  ('DIVAN ONLY-(Q)', 32500, 32500, null),
  ('DIVAN ONLY-(S)', 29500, 29500, null),
  ('DIVAN ONLY-(SS)', 30750, 30750, null);

create temp table _cost_c (base_model text, label text, supplier_code text, prices jsonb) on commit drop;
insert into _cost_c values
  ('9036', '1+2+3 Seater', '400-A001', '{"24":340000,"30":360000}'::jsonb),
  ('9036', '1+2+3 Seater', null, '{"24":340000,"30":360000}'::jsonb),
  ('9036', '2L', '400-A001', '{"24":199000,"30":209000}'::jsonb),
  ('9036', '2L', null, '{"24":199000,"30":209000}'::jsonb),
  ('9036', '3L', '400-A001', '{"24":254000,"30":264000}'::jsonb),
  ('9036', '3L', null, '{"24":254000,"30":264000}'::jsonb),
  ('9038', '1+2+3 Seater', '400-A001', '{"24":340000,"30":360000}'::jsonb),
  ('9038', '1+2+3 Seater', '400-0003', '{"24":340000,"30":365000}'::jsonb),
  ('9038', '1+2+3 Seater', null, '{"24":340000,"30":365000}'::jsonb),
  ('9038', '2EFL+1EFR-3S', '400-A001', '{"24":157600,"30":166400}'::jsonb),
  ('9038', '2EFL+1EFR-3S', '400-0003', '{"24":157600,"30":168600}'::jsonb),
  ('9038', '2EFL+1EFR-3S', null, '{"24":157600,"30":168600}'::jsonb),
  ('9038', '2L', '400-A001', '{"24":199000,"30":209000}'::jsonb),
  ('9038', '2L', '400-0003', '{"24":210000,"30":220000}'::jsonb),
  ('9038', '2L', null, '{"24":210000,"30":220000}'::jsonb),
  ('9038', '3L/2+1+L', '400-A001', '{"24":254000,"30":264000}'::jsonb),
  ('9038', '3L/2+1+L', '400-0003', '{"24":265000,"30":275000}'::jsonb),
  ('9038', '3L/2+1+L', null, '{"24":265000,"30":275000}'::jsonb),
  ('9055', '1+2+3 Seater', '400-A001', '{"24":350000,"26":370000,"28":370000,"30":380000}'::jsonb),
  ('9055', '1+2+3 Seater', '400-0003', '{"24":350000,"26":375000,"28":375000,"30":400000}'::jsonb),
  ('9055', '1+2+3 Seater', null, '{"24":350000,"26":375000,"28":375000,"30":400000}'::jsonb),
  ('9055', '2L / 2+ L', '400-A001', '{"24":210000,"26":220000,"28":220000,"30":230000}'::jsonb),
  ('9055', '2L / 2+ L', '400-0003', '{"24":210000,"26":220000,"28":220000,"30":230000}'::jsonb),
  ('9055', '2L / 2+ L', null, '{"24":210000,"26":220000,"28":220000,"30":230000}'::jsonb),
  ('9055', '3L', '400-A001', '{"24":260000,"26":275000,"28":275000,"30":286000}'::jsonb),
  ('9055', '3L', '400-0003', '{"24":265000,"26":275000,"28":275000,"30":285000}'::jsonb),
  ('9055', '3L', null, '{"24":265000,"26":275000,"28":275000,"30":286000}'::jsonb),
  ('8019', '1+2+3 Seater', '400-0003', '{"30":355000}'::jsonb),
  ('8019', '1+2+3 Seater', null, '{"30":355000}'::jsonb),
  ('8075', '2+L Seater', '400-0003', '{"24":185000,"28":195000}'::jsonb),
  ('8075', '2+L Seater', null, '{"24":185000,"28":195000}'::jsonb),
  ('9050', '2+L Seater', '400-A001', '{"24":220000,"26":230000,"28":230000,"30":230000,"32":240000,"35":250000}'::jsonb),
  ('9050', '2+L Seater', null, '{"24":220000,"26":230000,"28":230000,"30":230000,"32":240000,"35":250000}'::jsonb),
  ('5535', '2+L', '400-O001', '{"24":210000,"26":220000,"28":220000,"30":220000,"32":240000,"35":250000}'::jsonb),
  ('5535', '2+L', null, '{"24":210000,"26":220000,"28":220000,"30":220000,"32":240000,"35":250000}'::jsonb);

-- Every SKU, supplier and combo named above must be on file, or nothing changes.
do $check$
declare missing text;
begin
  select string_agg(distinct m.x, ', ') into missing from (
    select 'SKU ' || a.code as x
      from (select code from _cost_b union select code from _cost_p) a
     where not exists (select 1 from scm.mfg_products p join public.companies c on c.id = p.company_id and c.code = 'HOUZS'
                        where p.code = a.code)
    union all
    select 'supplier ' || s.supplier_code
      from (select supplier_code from _cost_b union select supplier_code from _cost_c where supplier_code is not null) s
     where not exists (select 1 from scm.suppliers x join public.companies c on c.id = x.company_id and c.code = 'HOUZS'
                        where x.code = s.supplier_code)
    union all
    select 'combo ' || n.base_model || ' ' || n.label
      from (select distinct base_model, label from _cost_c) n
     where not exists (select 1 from scm.sofa_combo_pricing k join public.companies c on c.id = k.company_id and c.code = 'HOUZS'
                        where k.base_model = n.base_model and k.label = n.label and k.supplier_id is null
                          and k.customer_id is null and k.deleted_at is null)
  ) m;
  if missing is not null then
    raise exception 'Carres supplier quote costs: not on file: %; nothing was changed', missing;
  end if;
end $check$;

-- 1. A supplier named main hands over from the old main first (one main per item).
update scm.supplier_material_bindings b
   set is_main_supplier = false, updated_at = now()
  from _cost_b n, public.companies c, scm.suppliers s
 where c.code = 'HOUZS' and s.company_id = c.id and s.code = n.supplier_code and n.main
   and b.company_id = c.id and b.material_kind = 'mfg_product' and b.item_code = n.code
   and b.supplier_id <> s.id and b.is_main_supplier;

-- 2. Bindings already on file take the quoted price.
update scm.supplier_material_bindings b
   set unit_price_sen = n.unit_sen, price_matrix = n.matrix,
       is_main_supplier = coalesce(n.main, b.is_main_supplier), updated_at = now()
  from _cost_b n, public.companies c, scm.suppliers s
 where c.code = 'HOUZS' and s.company_id = c.id and s.code = n.supplier_code
   and b.company_id = c.id and b.supplier_id = s.id and b.material_kind = 'mfg_product' and b.item_code = n.code
   and (b.unit_price_sen, b.price_matrix, b.is_main_supplier)
       is distinct from (n.unit_sen, n.matrix, coalesce(n.main, b.is_main_supplier));

-- 3. A quoted SKU with no binding for that supplier gets one; it is main when the SKU has no main yet.
insert into scm.supplier_material_bindings
       (company_id, supplier_id, material_kind, item_code, material_name, supplier_sku, unit_price_sen, price_matrix,
        is_main_supplier)
select c.id, s.id, 'mfg_product', n.code, p.name, coalesce(n.supplier_sku, n.code), n.unit_sen, n.matrix,
       coalesce(n.main, not exists (select 1 from scm.supplier_material_bindings o
                                     where o.company_id = c.id and o.material_kind = 'mfg_product'
                                       and o.item_code = n.code and o.is_main_supplier))
  from _cost_b n
  join public.companies c on c.code = 'HOUZS'
  join scm.suppliers s on s.company_id = c.id and s.code = n.supplier_code
  join scm.mfg_products p on p.company_id = c.id and p.code = n.code
 where not exists (select 1 from scm.supplier_material_bindings b
                    where b.company_id = c.id and b.supplier_id = s.id and b.material_kind = 'mfg_product'
                      and b.item_code = n.code);

-- 4. The SKU cost. A sofa's grid is replaced by the cost grid; a retail price stored on the old grid is kept.
update scm.mfg_products p
   set cost_price_sen = n.cost_sen,
       base_price_sen = coalesce(n.base_sen, p.base_price_sen),
       seat_height_prices = case
         when n.seat is null then p.seat_height_prices
         else n.seat || coalesce((
           select jsonb_agg(e - 'priceSen')
             from jsonb_array_elements(case when jsonb_typeof(p.seat_height_prices) = 'array'
                                            then p.seat_height_prices else '[]'::jsonb end) e
            where e ? 'sellingPriceSen'), '[]'::jsonb)
       end,
       updated_at = now()
  from _cost_p n, public.companies c
 where c.code = 'HOUZS' and p.company_id = c.id and p.code = n.code;

-- 5. Set prices on the combos already on file (supplier rows and the generic row).
update scm.sofa_combo_pricing k
   set prices_by_height = n.prices, updated_at = now()
  from _cost_c n
  join public.companies c on c.code = 'HOUZS'
  left join scm.suppliers s on s.company_id = c.id and s.code = n.supplier_code
 where k.company_id = c.id and k.deleted_at is null and k.customer_id is null
   and k.base_model = n.base_model and k.label = n.label
   and k.supplier_id is not distinct from s.id
   and k.prices_by_height is distinct from n.prices;

-- 6. A supplier with no row for a combo gets one, copied from the generic row (Dorsettloft on 9038 and 9055).
insert into scm.sofa_combo_pricing
       (company_id, base_model, modules, tier, supplier_id, prices_by_height, selling_prices_by_height,
        pwp_prices_by_height, default_free_gifts, label, effective_from, notes, created_by_name)
select c.id, g.base_model, g.modules, g.tier, s.id, n.prices, g.selling_prices_by_height,
       g.pwp_prices_by_height, g.default_free_gifts, g.label, g.effective_from, g.notes, g.created_by_name
  from _cost_c n
  join public.companies c on c.code = 'HOUZS'
  join scm.suppliers s on s.company_id = c.id and s.code = n.supplier_code
  join lateral (select * from scm.sofa_combo_pricing a
                 where a.company_id = c.id and a.base_model = n.base_model and a.label = n.label
                   and a.supplier_id is null and a.customer_id is null and a.deleted_at is null
                 order by a.created_at limit 1) g on true
 where not exists (select 1 from scm.sofa_combo_pricing k
                    where k.company_id = c.id and k.base_model = n.base_model and k.label = n.label
                      and k.supplier_id = s.id and k.customer_id is null and k.deleted_at is null);
