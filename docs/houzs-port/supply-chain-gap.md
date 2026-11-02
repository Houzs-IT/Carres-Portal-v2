# Supply Chain: Houzs vs Carres gap list

Measured 2 Nov 2026 against Houzs `origin/main` 3780e1757 and Carres `origin/main`.
Houzs pages live in `frontend/src/pages/scm-v2/` [code: Houzs-ERP origin/main].

Rule for this port: Houzs wins over a written Carres rule, as long as staff can open SO, PO and DO
[Mr Lim, WhatsApp, 22 Oct 2026]. Jess was not part of that ruling.

Status words: **yes** = Carres has it · **partly** = Carres has some of it · **no** = Carres does not have it.
The list is ordered by business value: opening SO, PO and DO comes first.

## 1. Open and work SO, PO and DO

| Houzs feature | Carres | Where in Carres | Notes |
|---|---|---|---|
| SO list, detail, create, amend | yes | `apps/web/src/pages/operation/` SO register and detail | Ported by the 22 Oct to 2 Nov Houzs port PRs [my guess from PR titles, not walked] |
| SO Copy as new | yes | #2193 | |
| PO list, detail, create, amend, cancel request | yes | `apps/web/src/pages/operation/purchase-orders/` | |
| PO Copy as new | **partly → PR #2202** | `PurchaseOrdersPage.tsx`, `pos.ts GET /:id/copy-seed` | Draft. The PO note is not copied: Carres keeps it only in the audit log [code: supabase/migrations/0573_a_purchase_order_may_be_issued_without_a_recorded_price.sql:306] |
| Customer Consignment Copy as new | **partly → PR #2202** | `CustomerConsignment.tsx` | Draft |
| DO list, detail, returns, load scan | yes | `apps/web/src/pages/operation/DeliveryOrderPage.tsx` and siblings | |
| GRN, Purchase Invoices, Purchase Returns | yes | purchasing pages | |

## 2. Delivery and fleet

| Houzs feature | Carres | Where in Carres | Notes |
|---|---|---|---|
| Last Mile lorry cards (Houzs #5094 → #5107) | **partly → PR #2205** | `OperationFleet.tsx FleetDayPage` | Was a table. Draft PR adds cards, stop DO No and delivery result |
| DP Orders, edit a pending order's date, carrier and slot (Houzs 675aebbcc) | yes | `DeliveryPlanning.tsx:332` row action `Schedule` | The address belongs to the SO in Carres, so it is not edited here [my guess on intent] |
| Transfer to a 3PL warehouse (Houzs 675aebbcc) | yes | warehouse `kind` own / logistics_partner [code: supabase/migrations/0027_warehouses_kind.sql:29] | Stock Transfer can target a partner warehouse |
| Delivery Maintenance (coverage, residence rules, lorries) | yes | `DeliveryPlanning.tsx:347 CoverageFleet` | |
| Auto-schedule, Trips, Zones, Rate Cards, Fleet, Fleet Health, Live Map, Capacity, Crew Leave | yes | `DeliveryPlanning.tsx`, `OperationFleet.tsx`, migrations 0724, 0725 | |
| Logistics Cost (`LogisticsCost.tsx`) | no | none found | Needs cost per trip per lorry; no table holds it yet [my guess] |
| Logistics P&L (`LogisticsPnl.tsx`) | no | none found | Depends on Logistics Cost |

## 3. Purchasing

| Houzs feature | Carres | Where in Carres | Notes |
|---|---|---|---|
| Purchase consignment | yes | #2127, #2134 | |
| PO from an approved product request (Houzs fb2fd8e3e) | no | none | Carres has no Product Requests module at all. Building it is a new module, not a port of one button |
| Supplier bindings and CSV import (`AddSupplierBinding.tsx`) | partly | `apps/web/src/pages/catalog/components/SupplierOffers.tsx` | Carres records supplier offers per SKU; no CSV import found |
| Price after DO (`PriceAfterDoModal.tsx`) | no | none found | Carres lets a PO be issued without a price (0573); a later price form is not built [my guess, not checked line by line] |
| Payment vouchers (`PaymentVoucher*.tsx`) | partly | `apps/web/src/lib/payables-queries.ts`, `lib/pdf/payment-voucher-template.tsx`, #2199 | Finance owns this in Carres (Chew). Not compared screen by screen |

## 4. Stock and warehouse

| Houzs feature | Carres | Where in Carres | Notes |
|---|---|---|---|
| Warehouses, racks, stock card, loading list | yes | Stock pages | |
| Stock adjust, transfer, take | yes | Stock pages | |
| MRP | yes | ported | |
| Cross-company racks | not applicable | | Carres has no company scoping |

## 5. Catalog and reports

| Houzs feature | Carres | Where in Carres | Notes |
|---|---|---|---|
| Sofa Price 3 and 4 by leather (Houzs ca0c384dc) | no | tiers stop at PRICE_3 [code: supabase/migrations/0179_sofa_combo_pricing.sql], [code: supabase/migrations/0202_catalog_fabrics.sql] | Needs a migration across catalog and POS pricing, plus a price owner's say on the tiers |
| Product Profit (`ProductProfit.tsx`) | no | none found | A report over SO price minus PO cost. Read-only, no new table [my guess] |
| Sales Invoices | yes | ported | |

## Next to build, in order

1. Product Profit report: read-only, no SQL, high value to the owner.
2. Price after DO: closes the 0573 "no price yet" PO gap.
3. Supplier offer CSV import.
4. Sofa Price 3 and 4: needs a migration and a pricing decision first.
5. Logistics Cost, then Logistics P&L: needs a cost table.
6. Product Requests: a new module; plan it before building.
