# Supply Chain: Houzs vs Carres gap list

Measured 2 Nov 2026, statuses updated 3 Nov 2026, against Houzs `origin/main` 3780e1757 and Carres `origin/main`.
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
| Logistics Cost (`LogisticsCost.tsx`) | no, **paused** | none found | Paused by YH, 3 Nov 2026 ("pause lorry cost"). When it resumes: Houzs reads costs from the books: Finance ticks which accounts feed each Logistics row on the Chart of Accounts, plus Houzs regions and fair setup trips [code: Houzs-ERP frontend/src/pages/scm-v2/LogisticsCost.tsx:13]. In Carres that is Chew's Finance module |
| Logistics P&L (`LogisticsPnl.tsx`) | no, **paused** | none found | Paused with Logistics Cost (YH, 3 Nov 2026). Built on Logistics Cost, plus a transport income share of DO value (Houzs starts at 3%) [code: Houzs-ERP frontend/src/pages/scm-v2/LogisticsPnl.tsx:10] |

## 3. Purchasing

| Houzs feature | Carres | Where in Carres | Notes |
|---|---|---|---|
| Purchase consignment | yes | #2127, #2134 | |
| PO from an approved product request (Houzs fb2fd8e3e) | **partly → PR #2233** | Manual Purchase request, `RequestNewModels.tsx`, migration 0774 | Draft. A request can ask for a model the catalog does not have; the Purchasing Approver builds it and links its SKU; no PO while one waits. Not done: consignment path, Sales raising, Houzs applications |
| Supplier bindings and CSV import (`SupplierBindingsCsv.tsx`) | **partly → PR #2210** | `apps/web/src/pages/catalog/components/SupplierOffers.tsx`, Supplier detail › Items | Draft adds price list download and import. Sofa per-height prices left out |
| Price after DO (`PriceAfterDoModal.tsx`) | **yes → PR #2226** | DO page line `Change price`, migration 0772 | Draft. Principal or Payment Approver; the order's invoices move and an issued one is reposted [code: Houzs-ERP frontend/src/pages/scm-v2/PriceAfterDoModal.tsx:18] |
| Payment vouchers (`PaymentVoucher*.tsx`) | **partly → PR #2229** | `PaymentVouchers.tsx`, #2199, migration 0773 | Draft adds removing a file until checked and reading the bill on a direct voucher. Not done: merged print bundle (needs a PDF merge library), bank charge and FX (Chew names the account) |

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
| Sofa Price 3 and 4 by leather (Houzs ca0c384dc) | **yes → PR #2225** | migration 0771, `fabric-tier.ts`, fabric CSV | Draft. Sofa fabrics take PRICE_4 (full leather); bedframes stay at 3 tiers. The catalog keeper sets which fabrics are PRICE_4 |
| Product Profit (`ProductProfit.tsx`) | **yes → PR #2209** | Principal › Sales analysis › Products, migration 0770 | Draft. Each SO line keeps the cost it was priced at, as Houzs does |
| Sales Invoices | yes | ported | |

## Decisions

YH, 3 Nov 2026: "decision all follow houzs, i repeat, all follow houzs". Items 1, 2, 4 and 5 below were built that way (PRs #2226, #2225, #2233, #2209). Logistics Cost and P&L are paused (YH, 3 Nov 2026).

Still needs someone outside code:
1. **Which fabrics are PRICE_4 (full leather).** The catalog keeper sets them; no fabric is PRICE_4 today.
2. **Voucher bank charge and foreign currency.** Chew names the account and the ledger rule.
3. **Product request raised by Sales.** Jess says which Carres role raises a purchase request besides Operation.
4. **Logistics Cost and P&L.** Paused. When resumed, Chew names the accounts and regions.
