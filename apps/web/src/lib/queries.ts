import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationOptions, type UseQueryOptions } from "@tanstack/react-query";
import { type DeliveryHandoverKind, type GrnReceivedWith, type HandoverGoodsLine, type RecordHandoverInput, type DeliveryProofReviewRow, type DeliveryAttemptEvidenceRow, type ProofReviewInput, type LoanOfferRow, type RecordOutboundPrepInput, type CancelOrderInput, type CatalogResponse, type JumpSearchResponse, type ProductModelDto, type ProductSkuDto, type ProductModelCreateBody, type ProductModelPatchInput, type ProductSkuCreateInput, type ProductSkuPatchInput, type SkuImportRow, type SkuImportResult, type DeliveryWarehouseScheduleEvent, type SpecialAddonDto, type SpecialAddonCreateInput, type SpecialAddonPatchInput, type CatalogOptionPoolName, type CatalogPoolBatchSaveInput, type CatalogConfigHistoryDto, type CatalogFabricsBatchSaveInput, type CatalogFabricsHistoryDto, type SofaComboDto, type SofaComboCreateInput, type SofaComboPatchInput, type ServicePackage, type ServicePackageInput, type RentalPlan, type RentalPlanInput, type RentalOffer, type RentalOfferInput, type RentalOfferPatchInput, type RentalBuyPrice, type RentalBuyPriceInput, type RentalBuyPricePatchInput, type RentalOfferService, type RentalOfferServiceInput, type RentalOfferServicePatchInput, type RentalAgreementTemplate, type RecordRentalPaymentInput, type ChargeRentalInterestInput, type SettleRentalAgreementInput, type AgreementTemplateInput, type AgreementTemplatePatchInput, type RentalAgreement, type RentalStockUnit, type GuaranteeListResponse, type GuaranteeProductInput, type PosRentalPlan, type Customer, type CreateRentalAgreementInput, type SofaCompartmentDto, type SofaCompartmentCreateInput, type SofaCompartmentPatchInput, type ModelSofaCompartmentDto, type ModelSofaCompartmentInput, type SizesActiveInput, type GenerateSkusInput, type FloorConfigPatchInput, type DeliveryFeeConfigDto, type DeliveryFeeConfigPatchInput, type SpecialDeliveryFeeRuleDto, type SpecialDeliveryFeeRuleInput, type ModelDefaultFreeGiftsDto, type ModelDefaultFreeGiftsInput, type FreeItemCampaignDto, type FreeItemCampaignInput, type PwpRuleDto, type PwpRuleInput, type ProductBundleDto, type ProductBundleInput, type PwpReserveInput, type PwpCodesResponse, type PwpDiscoverResponse, type AddonCreateInput, type AddonPatchInput, type AddonDto, type FloorConfigDto, type LpRejectOrderInput, type CreateOrderInput, type RawCreateOrderInput, type DealerSelf, type FinanceRecordReceiptInput, type FinanceTopupApproveInput, type ListOperationOrdersQuery, type ListMovementsQuery, type ListPurchaseOrdersQuery, type Order, type OrdersListResponse, type OrderStatus, type OutletsListResponse, type ProcurementTabSlug, type ReceivePoWithDoInput, type AddOrderLinesInput, type EditOrderAddonInput, type SubmitOrderChangeRequestInput, type ReplaceOrderLinesInput, type OrderChangeRequestDto, type SalespersonsListResponse, type StaffListResponse, type StaffSessionResponse, type VerifyPinInput, type StaffReauthInput, type CreateStaffInput, type UpdateStaffInput, type SetStaffPinInput, type StaffDto, type EmailChangeRequestDto, type SubmitEmailChangeInput, type CreateAccountInput, type TopUpOrderInput, type CreateStripeCheckoutInput, type StripeCheckoutSessionInfo, type UpdateOrderInput, type DeliveryStop, type OpsOrderControl, type PartnerBookingWarningWire, type OpsStaffListResponse, type OrderPaymentRow, type RecordPaymentInput, type FabricTierConfigDto, type ModelFabricTierOverrideDto, type StoreChannel, type PurchasingSettingsResponse, type PoArrival, type AllocatedUnit, type WarehouseIncomingResponse, type WarehouseReceiptLine, type WarehouseReceiptRow, type WarehouseSubmitReceiptInput, type DeliveryArrangementRow, type AssignLogisticsInput, type SaveDeliveryArrangementInput, type SupplierCreateInput, type OperationWorkResponse, type DeliveryContactRow, type DeliveryCannotDeliverRow, type OperationCannotDeliverInput, type PartnerCoverage, type HandoverPoint, type PartnerServices, type ProofRules, type DeliveryTemplateRow, type DeliverySettingChangeRow } from "@carres/shared";
import { OPERATION_WORK_INCLUDE_WORKSPACE, operationWorkResponseSchema, type LogisticsCardFacts } from "@carres/shared";
import { type MonthlyDemandOrder } from "@carres/shared";
import { ApiError, apiFetch } from "./api";
import { withDepartment } from "@/pages/finance/department";
import { uploadCompartmentPhoto, uploadModelPhoto } from "./photo-upload";

export const qk = {
  purchaseRequestRelease: () => ["operation","purchasing","requests","context-release"] as const,
  poCancellations:(id:string)=>["operation","pos",id,"cancellations"] as const,
  purchaseRequestPlan: (skus: string[], proceedDate: string | null, purpose: string | null, origin: string | null = null, requestId: string | null = null) => ["operation", "purchasing", "requests", "plan", skus.join("|"), proceedDate, purpose, origin, requestId] as const,
  purchaseRequestItems: () => ["to-order", "pick-items"] as const,
  purchaseRequestContextReview: (id: string) => ["operation", "purchasing", "requests", id, "context-review"] as const,
  purchaseRequests: () => ["operation", "purchasing", "requests"] as const,
  dealers:      () => ["dealers"] as const,
  dealerSelf:   () => ["dealers", "me"] as const,
  orders:       (filters?: OrderFilters) => ["orders", filters ?? {}] as const,
  order:        (id: string) => ["orders", id] as const,
  /** 0223 — one Stripe Checkout link's status poll (collect-online modal). */
  stripeSession: (orderId: string, sessionId: string) =>
    ["orders", orderId, "stripe-session", sessionId] as const,
  catalog:      () => ["catalog"] as const,
  /** 0201 — per-pool config-history snapshots. Nested under 'catalog' so every
   *  catalog mutation's ["catalog"] prefix-invalidation refreshes it too. */
  catalogConfigHistory: (section: string) => ["catalog", "config-history", section] as const,
  outlets:      () => ["outlets"] as const,
  salespersons: (outletId?: string) => ["salespersons", outletId ?? null] as const,
  /** 0233 — staff PIN roster (GET /api/staff). Principal may scope to another
   *  store via dealerId; own-store reads pass none. Kept off the `salespersons`
   *  prefix so staff mutations that flip hasPin invalidate distinctly. */
  staff:        (dealerId?: string) => ["staff", dealerId ?? null] as const,
  /** 0240 — my store's latest email-change request (dealer principal). */
  emailChange:  () => ["email-change", "mine"] as const,
  /** 0187 (Phase 8c) — the caller's RESERVED pwp_codes (GET /api/pwp-codes/mine),
   *  feeding the POS Auto-Fill voucher rail. The reserve/free mutations invalidate
   *  this so the rail re-reads the live RESERVED set after a trigger change. */
  pwpCodesMine: () => ["pwp-codes", "mine"] as const,
  /** 0188 (Phase 8d) — cross-order AVAILABLE voucher DISCOVERY (GET
   *  /api/pwp-codes/available), keyed by the selector (phone / code) so the POS
   *  auto-suggest + manual-entry affordance cache distinctly per lookup. The
   *  stripped (no-PII) DTO. Only enabled when a selector is present + PWP is
   *  active (DORMANT carts make zero discovery traffic). */
  pwpAvailable: (sel: { phone?: string | null; code?: string | null; name?: string | null }) =>
    ["pwp-codes", "available", sel.phone ?? null, sel.code ?? null, sel.name ?? null] as const,
  pwpByOrder: (orderId: string) => ["pwp-codes", "by-order", orderId] as const,
  // 0247-0249 — Rental + Service Plan base. Blast ["rental"] to refresh the
  // whole module after a config write.
  rental: {
    config: () => ["rental", "config"] as const,
    agreements: () => ["rental", "agreements"] as const,
    units: () => ["rental", "units"] as const,
    // 0255 — the POS sell lane's stripped offer list + checkout polling.
    posPlans: () => ["rental", "pos-plans"] as const,
    // 0268 — the finance approver's credit queue.
    approvals: () => ["rental", "approvals"] as const,
    // 0538 — one calendar month across every agreement.
    month: (month: string) => ["rental", "month", month] as const,
    // 0279 — the wording in force, read by the POS before a customer signs.
    agreementTemplate: () => ["rental", "agreement-template"] as const,
    // 0281 — what has actually been collected against one agreement.
    collections: (agreementId: string) => ["rental", "collections", agreementId] as const,
    // 0300 — what paying the rest off today would cost, worked out server-side.
    settlementQuote: (agreementId: string) =>
      ["rental", "settlement-quote", agreementId] as const,
  },
  // 0261-0263 — Guarantee packages. Blast ["guarantees"] after a claim/attach
  // so the desk, the order badge and any open drawer all re-read together.
  guarantees: {
    search: (q: string, status: string) => ["guarantees", "search", q, status] as const,
    byOrder: (orderId: string) => ["guarantees", "by-order", orderId] as const,
  },
  serviceCases: {
    // Shares the ["ops","service-cases"] prefix the list page and modal already
    // invalidate, so saving a case refreshes the order drawer's Cases tab too.
    byOrder: (orderId: string) =>
      ["ops", "service-cases", "by-order", orderId] as const,
  },
  // Phase 3 — Principal admin namespace. Keys are nested under 'principal' so
  // we can selectively invalidate the whole sub-tree (e.g. after a decision
  // ripples to dealers + dashboard) without touching dealer/order caches.
  principal: {
    dashboard: () => ["principal", "dashboard"] as const,
    approvals: (filters?: ApprovalFilters) =>
      ["principal", "approvals", filters ?? {}] as const,
    dealers:   (filters?: PrincipalDealerFilters) =>
      ["principal", "dealers", filters ?? {}] as const,
    dealer:    (id: string) => ["principal", "dealers", id] as const,
    partners:  () => ["principal", "partners"] as const,
    /** Phase 10 — principal accounts admin (PrincipalAccounts page). */
    accounts:  () => ["principal", "accounts"] as const,
    /** 0240 — store email-change request queue (HQ approval). */
    emailChanges: () => ["principal", "email-changes"] as const,
    /** Phase 10 — audit log (PrincipalAudit). */
    audit:     (filters?: Record<string, unknown>) =>
      ["principal", "audit", filters ?? {}] as const,
    // 2026-05-19 — stock / orders / suppliers tabs moved to Operation
    // (qk.operation.stock / ordersFeed / suppliersOverview). Principal admit
    // is still allowed on those endpoints for oversight deep links.
  },
  // Phase 4.5 Chunk 1 — operation Partner (LP) namespace. Nested keys mirror
  // `principal` so we can blast `["partner"]` to invalidate the whole sub-tree
  // (e.g. after accept/reject RFD ripples to dashboard counts + pickups list).
  partner: {
    dashboard:  () => ["partner", "dashboard"] as const,
    pickups:    () => ["partner", "pickups"] as const,
    rfdPending: () => ["partner", "rfd-pending"] as const,
    toDeliver:  () => ["partner", "to-deliver"] as const,
    fleet:      () => ["partner", "fleet"] as const,
    /** Migration 0147 (item h, 2026-05-23) — LP "Incoming" queue: orders
     *  picked by Operation at Accept Proceed that the LP hasn't yet accepted
     *  or rejected. Polled every 15s while the page is open. */
    incoming:   () => ["partner", "incoming"] as const,
  },
  // Phase 4 — HQ operation namespace. Same nested-key strategy as `principal`
  // so M5 mutation hooks can blast `["operation"]` (or a sub-tree) on each
  // ripple — e.g. assign-partner invalidates orders + dashboard; PO receive
  // invalidates pos + warehouse + dashboard. Filter keys are typed via the
  // `List*Query` zod-derived shapes from `@carres/shared` so a wrong key fails
  // typecheck at the call site rather than silently breaking cache reads.
  operation: {
    poRoot:()=>["operation","pos"] as const,
    workspaceAssignmentHistory: (duty: string) => ["operation", "workspace-assignment-history", duty] as const,
    workActivitySettings: () => ["operation", "work-activity-settings"] as const,
    work:      () => ["operation", "work"] as const,
    /** 0136 — AutoCount-imported orders still in Inbox triage (no logistic
     *  assigned). Polled 15s while the page is open so newly-imported orders
     *  appear without manual refresh. */
    inbox: () => ["operation", "inbox"] as const,
    dashboard: () => ["operation", "dashboard"] as const,
    /** Loo 2026-05-10 — sidebar badge counts (orders awaiting + pickup-action
     *  POs). 30s refetch, kept under `operation` so a future blunt invalidate
     *  on `["operation"]` after a relevant mutation fans out here too. */
    badges:    () => ["operation", "badges"] as const,
    orders:    (filters?: operationOrderFilters) =>
      ["operation", "orders", filters ?? {}] as const,
    order:     (id: string) => ["operation", "orders", id] as const,
    /** P2 (migration 0159) — editable ops_order_control overlay for the order
     *  drawer. Nested under the order id so a blunt ["operation","orders"]
     *  invalidation after any order mutation refreshes it too. */
    orderControl: (id: string) => ["operation", "orders", id, "control"] as const,
    /** T6 (migration 0280) — the order's delivery-photo ledger + signed view
     *  urls. Nested under the order id, same blunt-invalidate family. */
    deliveryPhotos: (id: string) =>
      ["operation", "orders", id, "delivery-photos"] as const,
    /** The signed Delivery Order on file, signed for VIEWING on demand (owner
     *  ruling 2026-09-11). Keyed by the DOCUMENT, because that is the door the
     *  operator opened, even though the artefact is the order's. */
    signedDeliveryDocument: (idOrNumber: string) =>
      ["operation", "delivery-orders", idOrNumber, "signed-document"] as const,
    /** T9 (migration 0283) — what the order's carrier says about ONE candidate
     *  delivery date. Keyed by the date so picking another day is a fresh
     *  question, not a stale answer. */
    partnerBookingCheck: (id: string, date: string) =>
      ["operation", "orders", id, "partner-check", date] as const,
    /** Staff assignment pool (migration 0232) — operation accounts + pool state. */
    staff: ["operation", "staff"] as const,
    /** Balance job (migration 0184) — the multi-entry payment ledger for an
     *  order. Nested under the order id so a blunt ["operation","orders"]
     *  invalidation after any order mutation refreshes it too. */
    orderPayments: (id: string) => ["operation", "orders", id, "payments"] as const,
    /** CARD 3 — what Operations puts on the T−3 customer call: the promised
     *  deadline, the latest Stock ETA, the expected scope and what is / is not
     *  expected in. Nested under the order id so any order mutation refreshes
     *  it too. */
    orderBookingBrief: (id: string) =>
      ["operation", "orders", id, "booking-brief"] as const,
    /** Order Route is one read-only projection over facts owned by several
     * modules. The cache key stays under the order so every existing order
     * invalidation refreshes the projection without creating a new owner. */
    orderRoute: (id: string) => ["operation", "orders", id, "route"] as const,
    /** 【DELIVERY】 CARD 19 — the document word resolved to the id, keyed by
     *  the number the URL carried. */
    orderByNumber: (so: number) => ["operation", "orders", "by-number", so] as const,
    partners:  () => ["operation", "partners"] as const,
    suppliers: () => ["operation", "suppliers"] as const,
    pos:       (filters?: operationPoFilters) =>
      ["operation", "pos", filters ?? {}] as const,
    po:        (id: string) => ["operation", "pos", id] as const,
    /** The per-unit goods ids a PO minted at Issue (0153) — the PO-PDF
     *  standard's Item ID column. Nested under "pos" for blunt invalidation. */
    poUnits:   (id: string) => ["operation", "pos", id, "units"] as const,
    /** Loo 2026-05-16 — per-source-order ETA list for the PO detail modal.
     *  Nested under "pos" so a blunt `["operation","pos"]` invalidation after
     *  a PO mutation also clears these. Cheap (1-row-per-SO select), and the
     *  fetch only fires when the modal opens. */
    poSourceOrders: (id: string) =>
      ["operation", "pos", id, "source-orders"] as const,
    /** Phase 4.5 Chunk 2 (T34) — per-supplier procurement tab list. Keyed by
     *  `slug` so each tab's cache stays distinct (otherwise switching tabs
     *  would thrash the same key). Nested under `pos` so a future blunt
     *  invalidation on `["operation","pos"]` (e.g. after a CreatePO) reaches
     *  every tab too. */
    procurementTab: (slug: ProcurementTabSlug) =>
      ["operation", "pos", "tab", slug] as const,
    /** Pipeline v2 (C5.3) — SKU-level shortage feed for the "Auto-fill from
     *  awaiting stock" button on CreatePOModal. Lazy: fired only on click via
     *  the hook's `refetch()`. Nested under `pos` so future blunt
     *  invalidations on `["operation","pos"]` reach this cache too (e.g. when
     *  a PO is issued, the in_production pool changes).
     *
     *  `dls` (optional, sorted) scopes shortage to a specific so set, used by
     *  the cross-order bundle prefill flow. Sorting keeps the cache key stable
     *  across permutations of the same selection. */
    awaitingStockShortage: (dls?: number[]) =>
      dls && dls.length > 0
        ? (["operation", "pos", "awaiting-stock-shortage", [...dls].sort((a, b) => a - b)] as const)
        : (["operation", "pos", "awaiting-stock-shortage"] as const),
    /** Phase 4.5 Chunk 2 (T18/T21) — stock alerts derived from
     *  `(qty - reserved) < low_threshold`. Read by `StockAlertsTile` on the
     *  dashboard and (later) the warehouse red-dot indicator. The
     *  `SetThresholdDialog` invalidates this key on save so the tile
     *  re-derives. */
    stockAlerts: () => ["operation", "stock-alerts"] as const,
    /** `Jump to…` document lookup, keyed by the typed query. Read-only and
     *  navigate-only: nothing invalidates it, because nothing it returns can
     *  be written from the surface that shows it. */
    jump: (q: string) => ["operation", "jump", q] as const,
    /** R2 — the supplier-claim queue. Invalidated by a receive, because a
     *  receive is the thing that opens claims. */
    supplierClaims: (status: string) =>
      ["operation", "supplier-claims", status] as const,
    /** §9.6 — the Purchase Returns register. Keyed by the claim it is narrowed
     *  to, so the claim object's own view and the full register never share a
     *  cache entry and show each other's rows. */
    purchaseReturns: (claim: string | null, consignment = false) =>
      ["operation", "purchase-returns", claim ?? "all-claims", consignment ? "consignment" : "purchase"] as const,
    /** R6 — what the warehouse filed and is waiting on. Invalidated by a
     *  check-in, because a check-in IS a receive: the PO row, the claim queue
     *  and this queue all move together. */
    warehouseReceipts: (status: string) =>
      ["operation", "warehouse-receipts", status] as const,
    /** The paged GRN Register (owner correction 2026-09-06) — one key per
     *  filter/page combination, under the same invalidation root as the
     *  queue: a check-in mints the row this register must show. */
    grnRegister: (filters: Record<string, string | number | null>) =>
      ["operation", "warehouse-receipts", "grn", filters] as const,
    /** Slice B — one PO's Receiving Sessions + their event ledger. The
     *  Workspace's Summary and Activity both read this ONE call, so the two
     *  sections can never describe the same delivery differently. */
    poReceiving: (poId: string) =>
      ["operation", "pos", poId, "receiving"] as const,
    /** 0425/0426 — who may save a Receiving today, and one session's record. */
    receivingDuty: () => ["operation", "receiving-duty"] as const,
    receivingSession: (id: string) =>
      ["operation", "warehouse-receipts", "session", id] as const,
    supplierClaimPhotos: (id: string) =>
      ["operation", "supplier-claims", "photos", id] as const,
    warehouse: () => ["operation", "warehouse"] as const,
    warehouseCalendar: () => ["operation", "warehouse-schedule", "calendar"] as const,
    /** Pipeline v2 (C4) — reserve drill-down per (warehouse, sku). Nested under
     *  warehouse so future blunt invalidations on `["operation","warehouse"]`
     *  fan out to drill-down caches too. */
    reservedDrilldown: (warehouseId: string | null, sku: string | null) =>
      ["operation", "warehouse", "reserved", warehouseId ?? "null", sku ?? "null"] as const,
    movements: (filters?: MovementsFilters) =>
      ["operation", "movements", filters ?? {}] as const,
    /** 2026-05-19 — cross-warehouse stock table (OperationStock page). */
    stock: () => ["operation", "stock"] as const,
    /** 2026-05-19 — read-only cross-dealer orders feed (OperationAllOrders
     *  page). Distinct from qk.operation.orders (the kanban-driver). */
    ordersFeed: (filters?: Record<string, unknown>) =>
      ["operation", "orders-feed", filters ?? {}] as const,
    /** 2026-05-19 — supplier oversight roster (OperationSuppliers page).
     *  Distinct from qk.operation.suppliers (the CRUD list). */
    suppliersOverview: () => ["operation", "suppliers-overview"] as const,
    /** 2026-05-19 — per-supplier recent-12-PO drawer query. Nested under
     *  the parent so a blunt invalidate fans out. */
    suppliersOverviewPos: (id: string) =>
      ["operation", "suppliers-overview", id, "pos"] as const,
    /** Phase B (migration 0138) — merged annotation + activity timeline for
     *  a single order. Nested under "orders" so a blunt invalidate on
     *  `["operation","orders"]` fans out here too. */
    orderTimeline: (id: string) =>
      ["operation", "orders", id, "timeline"] as const,
    /** Phase B — recent 'escalate'-tagged annotations for Jess's exception inbox. */
    escalations: () => ["operation", "escalations"] as const,
    /** Purchase / Procurement MRP cockpit — the "what to buy today" read model
     *  (GET /api/operation/purchase/today). Nested under `operation` so a blunt
     *  invalidate on `["operation"]` after a PO mutation refreshes it too. */
    purchaseToday: () => ["operation", "purchase", "today"] as const,
    mrp: () => ["operation", "purchase", "mrp"] as const,
    /** P1 (0303) — the purchasing numbers (GET /api/operation/purchasing/settings). */
    purchasingSettings: () => ["operation", "purchasing", "settings"] as const,
    /** To Order — the Planning Workspace projection, recomputed on every read
     *  (GET /api/operation/purchase/to-order). Issuing invalidates ["operation"]. */
    toOrder: () => ["operation", "purchase", "to-order"] as const,
    /** Q3 — the Report tab's ONE read (GET /api/operation/pos/report). Nested
     *  under `pos` so any blunt PO invalidation reaches the figures too: the
     *  report stores nothing, so it must never be the last screen holding an
     *  old number. */
    poReport: () => ["operation", "pos", "report"] as const,
  },
  // Phase 5 — HQ Finance namespace. Same nested-key strategy as `principal`
  // and `operation` so mutations can blast `["finance"]` (e.g. a receipt
  // ripples to the invoice and payment registers) or a tighter sub-tree.
  finance: {
    bankStatements:   (filters?: { from?: string; to?: string; matched?: "true" | "false" }) =>
      ["finance", "bank-statements", filters ?? {}] as const,
    reconSuggest:     (bankStmtId: string) =>
      ["finance", "recon-suggest", bankStmtId] as const,
    payments:         (filters?: FinancePaymentsFilters) =>
      ["finance", "payments", filters ?? {}] as const,
    paymentRegister: () => ["finance", "payment-register"] as const,
    invoiceRegister: () => ["finance", "invoice-register"] as const,
    /** Every open storage case (the Monitor's Storage cell). */
    storageCases: () => ["finance", "storage-cases", "all"] as const,
    /** Every customer later-date request (the Monitor's pending free request). */
    laterDeliveryRequests: () => ["finance", "later-delivery-requests", "all"] as const,
    /** Settings → Payments (banks · methods · timing · storage · changes). */
    paymentSettings: () => ["finance", "payment-settings"] as const,
    /** 0489 — one order's collection owner (normal · cover · history). */
    collectionOwner: (orderId: string) => ["finance", "collection-owner", orderId] as const,
    invoices:         (filters?: FinanceInvoicesFilters) =>
      ["finance", "invoices", filters ?? {}] as const,
    refunds:          (filters?: FinanceRefundsFilters) =>
      ["finance", "refunds", filters ?? {}] as const,
  },
  // BD namespace (2026-07-19 — the BD POS reads dealer stats + audit activity;
  // the Phase-8 Inquiries key died with the ERP-style BD portal).
  bd: {
    dealers:  () => ["bd", "dealers"] as const,
    activity: (limit?: number) => ["bd", "activity", limit ?? 12] as const,
  },
  // Phase 6 — Supplier namespace. Same nested-key strategy so mutations can
  // blast `["supplier"]` (e.g. ack/start-production ripples to PO list +
  // dashboard counts) or a tighter sub-tree.
  supplier: {
    me:       () => ["supplier", "me"] as const,
    activity: (limit?: number) => ["supplier", "activity", limit ?? 6] as const,
    pos:      (bucket?: SupplierBucket) => ["supplier", "pos", bucket ?? "all"] as const,
    po:       (id: string) => ["supplier", "pos", id] as const,
    products: () => ["supplier", "products"] as const,
    demand:   () => ["supplier", "products", "demand"] as const,
  },
  // R6 — the warehouse portal's own namespace, beside supplier and partner.
  // Its two reads share one prefix so filing a count refreshes BOTH: the PO
  // leaves the incoming list (it now has an open receipt) and appears in the
  // warehouse's own list at the same moment.
  warehousePortal: {
    incoming: () => ["warehouse-portal", "incoming"] as const,
    receipts: () => ["warehouse-portal", "receipts"] as const,
  },
  // 2026-05-15 (Loo) — Supplier per-thread readiness + pickup event keys.
  // Top-level (not nested under `supplier`) because thread + pickup-event
  // reads are role-agnostic (supplier reads threads; partner+operation +
  // anyone with link reads pickup-event print payload). Mutations invalidate
  // these by their top-level prefix (`["supplierThreads"]` /
  // `["pickupEvents"]`) so the namespacing matches the invalidate calls.
  supplierThreads: {
    byPo: (poId: string) => ["supplierThreads", poId] as const,
  },
  pickupEvent: {
    print: (eventId: string) => ["pickupEvent", eventId] as const,
    byPo:  (poId: string)  => ["pickupEvents", poId] as const,
  },
  // 0219 — the Order Entry (POS form) config editor read. (The 0174 SO grid
  // that shared this prefix was deleted 2026-07-12; the key stays stable.)
  salesOrderGrid: {
    entryConfig: () => ["sales-order-grid", "entry-config"] as const,
  },
  // 0244/0245 — HR commission portal. Nested so config/assign mutations can
  // blast the whole `["hr"]` sub-tree (every month report embeds the config).
  hr: {
    report: (year: number, month: number) => ["hr", "report", year, month] as const,
    team: () => ["hr", "team"] as const,
    // HR-P4 (0269) — the employee master.
    people: () => ["hr", "people"] as const,
    // HR-P5 (0272) — commission runs
    runs: () => ["hr", "runs"] as const,
    run: (runId: string) => ["hr", "runs", runId] as const,
    runState: (year: number, month: number) =>
      ["hr", "runs", "state", year, month] as const,
    person: (employeeId: string) => ["hr", "people", employeeId] as const,
    // HR-P6 (0276) — targets + the scoreboard. Keyed on the metric too: switching
    // metric changes every number on the page, so it is a different query.
    kpi: (year: number, month: number, kpiKey: string) =>
      ["hr", "kpi", year, month, kpiKey] as const,
    // HR-P7 (0278) — people cost.
    comp: (year: number, month: number) => ["hr", "comp", year, month] as const,
  },
};


export interface OrderFilters {
  status?: OrderStatus;
  outletId?: string;
  salespersonId?: string;
  dealerId?: string;
}

// Phase 3 — Principal filter shapes. Kept tiny on purpose: the route handlers
// already do the heavy lifting; the frontend just needs stable cache keys
// keyed on whatever the user picked in the inbox / dealers list.
export interface ApprovalFilters {
  status?: "pending" | "approved" | "rejected" | "all";
  kind?: "refund" | "new_dealer" | "top_up" | "price_change" | "other";
}

export interface PrincipalDealerFilters {
  status?: "active" | "suspended" | "pending";
  search?: string;
}

// ---------------------------------------------------------------------------
// Phase 5 — Finance filter shapes (kept as plain interfaces so the qk keys
// stay structurally typed without dragging the zod schema into every cache
// key build site).
// ---------------------------------------------------------------------------
export interface FinancePaymentsFilters {
  orderId?:   string;
  dealerId?:  string;
  direction?: "in" | "out";
  from?:      string;
  to?:        string;
  limit?:     number;
}
export interface FinanceInvoicesFilters {
  status?:   "all" | "unpaid" | "partial" | "paid" | "voided";
  dealerId?: string;
  from?:     string;
  to?:       string;
  limit?:    number;
}
export interface FinanceRefundsFilters {
  status?:   "all" | "pending" | "approved" | "rejected" | "paid" | "issued" | "applied";
  dealerId?: string;
  from?:     string;
  to?:       string;
  limit?:    number;
}


// Refund row (Chunk C) — credit_note_no IS NOT NULL discriminates a credit
// note from a refund. UI label derivation:
//   credit_note_no IS NULL  + status='pending'   -> "RF pending"
//   credit_note_no IS NULL  + status='approved'  -> "RF approved"
//   credit_note_no IS NULL  + status='paid'      -> "RF paid"
//   credit_note_no NOT NULL + status='approved'  -> "CN issued"
//   credit_note_no NOT NULL + status='paid'      -> "CN applied"
export interface FinanceRefundRow {
  id:                    string;
  order_id:              string;
  dealer_id:             string | null;
  amount:                number;
  reason:                string | null;
  status:                "pending" | "approved" | "rejected" | "paid";
  approval_id:           string | null;
  approved_at:           string | null;
  paid_at:               string | null;
  credit_note_no:        string | null;
  applied_to_order_id:   string | null;
  created_at:            string;
}

export interface FinancePaymentRow {
  id:           string;
  direction:    "in" | "out";
  amount:       number;
  method:       string;
  reference:    string | null;
  paid_at:      string;
  order_id:     string | null;
  po_id:        string | null;
  refund_id:    string | null;
  receipt_url:  string | null;
  recorded_by:  string | null;
  created_at:   string;
}

// ---------------------------------------------------------------------------
// Phase 4 — operation filter shapes
// ---------------------------------------------------------------------------
// Re-exported as plain type aliases of the zod-inferred query shapes from
// @carres/shared/schemas/operation. The web side only needs these as cache-key
// values + URLSearchParams sources — no runtime parse here, the server already
// owns that boundary. Keeping the alias means a schema change in one file
// updates both the API and the React Query keys without drift.
export type operationOrderFilters = Partial<ListOperationOrdersQuery>;
export type operationPoFilters = Partial<ListPurchaseOrdersQuery>;
export type MovementsFilters = Partial<ListMovementsQuery>;
// Re-export the payment-ledger row type so consumers (OrderDetailDrawer) can pull
// it from the queries boundary alongside the payment hooks, matching the pattern
// used for the other operation detail types. (It was imported above for internal
// use but never re-exported — batch-2 build gap.)
export type { OrderPaymentRow };

function toSearch(f?: OrderFilters): string {
  if (!f) return "";
  const params = new URLSearchParams();
  if (f.status) params.set("status", f.status);
  if (f.outletId) params.set("outletId", f.outletId);
  if (f.salespersonId) params.set("salespersonId", f.salespersonId);
  if (f.dealerId) params.set("dealerId", f.dealerId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useDealerSelf(opts?: Partial<UseQueryOptions<DealerSelf>>) {
  return useQuery({
    queryKey: qk.dealerSelf(),
    queryFn: () => apiFetch<DealerSelf>("/api/dealers/me"),
    staleTime: 5 * 60_000,
    ...opts,
  });
}

export function useOrders(filters?: OrderFilters, opts?: Partial<UseQueryOptions<OrdersListResponse>>) {
  return useQuery({
    queryKey: qk.orders(filters),
    queryFn: () => apiFetch<OrdersListResponse>("/api/orders" + toSearch(filters)),
    staleTime: 30_000,
    ...opts,
  });
}

export function useOrder(id: string | null, opts?: Partial<UseQueryOptions<Order>>) {
  return useQuery({
    queryKey: qk.order(id ?? ""),
    queryFn: () => apiFetch<Order>(`/api/orders/${id}`),
    enabled: !!id,
    staleTime: 10_000,
    ...opts,
  });
}

/**
 * useCreateOrder — POST /api/orders. On success, prime the detail cache with
 * the just-created order (so the ThankYou screen can render its number
 * without a second round-trip) and invalidate the list cache so the dashboard
 * kanban picks up the new card on next mount.
 */
export function useCreateOrder(
  opts?: Partial<UseMutationOptions<Order, Error, CreateOrderInput>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, Error, CreateOrderInput>({
    mutationFn: (input) =>
      apiFetch<Order>("/api/orders", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (...args) => {
      const [order] = args;
      qc.setQueryData(qk.order(order.id), order);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      // The office create page (2026-10-22) lands back on the Sales Orders
      // Register, keyed under ["operation","orders"] with a 30s staleTime.
      void qc.invalidateQueries({ queryKey: ["operation", "orders"] });
      // Forward to caller's onSuccess if provided. Spread keeps us
      // signature-agnostic across TanStack versions.
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/**
 * useSalesAnalytics — GET /api/analytics/sales?months=N (POS-parity,
 * MAINTAIN → Sales analysis; principal only). Flattened order + line rows;
 * the page aggregates via lib/sales-analysis.
 */
export function useSalesAnalytics(
  months: number,
  opts?: Partial<UseQueryOptions<import("./sales-analysis").SalesAnalyticsResponse>>,
) {
  return useQuery<import("./sales-analysis").SalesAnalyticsResponse>({
    queryKey: ["analytics", "sales", months],
    queryFn: () =>
      apiFetch<import("./sales-analysis").SalesAnalyticsResponse>(
        `/api/analytics/sales?months=${months}`,
      ),
    staleTime: 60_000,
    ...opts,
  });
}

/**
 * useCustomerTypeProbe — GET /api/orders/customer-type?phone= (POS-parity
 * "CUSTOMER TYPE (AUTO)"). Answers whether any RLS-visible order already
 * carries this phone. Disabled until the phone looks dial-able.
 */
export function useCustomerTypeProbe(
  phone: string,
  opts?: Partial<UseQueryOptions<{ existing: boolean; matches: number }>>,
) {
  const trimmed = phone.trim();
  return useQuery<{ existing: boolean; matches: number }>({
    queryKey: ["orders", "customer-type", trimmed],
    queryFn: () =>
      apiFetch<{ existing: boolean; matches: number }>(
        `/api/orders/customer-type?phone=${encodeURIComponent(trimmed)}`,
      ),
    enabled: trimmed.length >= 8,
    staleTime: 30_000,
    ...opts,
  });
}

/** One customer distilled from RLS-visible past orders (newest order wins) —
 *  the wire shape of GET /api/orders/customer-search. `address` / `emergency`
 *  are the composed DB strings; the POS parses them back into structured
 *  fields via `customerPatchFromHit`. */
export interface CustomerSearchHit {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  addressUnknown: boolean;
  billing: string | null;
  billingSame: boolean;
  emergency: string | null;
  race: string | null;
  gender: string | null;
  birthday: string | null;
}

/**
 * useCustomerSearch — GET /api/orders/customer-search?q= (POS Full-name
 * autocomplete). Returns up to 8 distinct customers from RLS-visible past
 * orders whose name contains `q`. Disabled until 2+ chars are typed.
 */
export function useCustomerSearch(
  q: string,
  opts?: Partial<UseQueryOptions<{ customers: CustomerSearchHit[] }>>,
) {
  const trimmed = q.trim();
  return useQuery<{ customers: CustomerSearchHit[] }>({
    queryKey: ["orders", "customer-search", trimmed],
    queryFn: () =>
      apiFetch<{ customers: CustomerSearchHit[] }>(
        `/api/orders/customer-search?q=${encodeURIComponent(trimmed)}`,
      ),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
    ...opts,
  });
}

/**
 * useRawCreateOrder — POST /api/orders/raw (POS-parity, MAINTAIN → New Order).
 * Internal-only raw creation: free-form line skus + prices, no POS gates.
 * Same Order response contract as useCreateOrder.
 */
export function useRawCreateOrder(
  opts?: Partial<UseMutationOptions<Order, Error, RawCreateOrderInput>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, Error, RawCreateOrderInput>({
    mutationFn: (input) =>
      apiFetch<Order>("/api/orders/raw", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (...args) => {
      const [order] = args;
      qc.setQueryData(qk.order(order.id), order);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/**
 * useProceedOrder — POST /api/orders/:id/proceed. Atomically transitions a
 * Place order to Proceed (sent to operation). On success, primes both the
 * detail cache and invalidates the list cache so kanban + tabs reflect the
 * new bucket on next mount.
 *
 * Errors:
 *   - 422 with `{ code: ProceedBlockerCode }` — caller can read
 *     `(err as ApiError).body.code` to show the matching inline blocker hint.
 *   - 403 / 404 / 500 — generic toast.
 */
export function useProceedOrder(
  opts?: Partial<UseMutationOptions<Order, ApiError, string>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, string>({
    mutationFn: (id) => apiFetch<Order>(`/api/orders/${id}/proceed`, { method: "POST" }),
    ...opts,
    onSuccess: async (...args) => {
      const [order, mutateOrderId] = args;
      // mutateOrderId is the id we passed to mutate(id) — guaranteed to
      // match the URL param the parent's useOrder is observing.
      qc.setQueryData(qk.order(mutateOrderId), order);
      await qc.invalidateQueries({ queryKey: qk.order(mutateOrderId), exact: true });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/**
 * useUnproceedOrder — POST /api/orders/:id/unproceed (0220). Reverses the
 * sales-side Proceed marker: Proceed → Place while operation hasn't started
 * (operation_stage still 'confirmed') and the proceed date hasn't passed.
 * Mirrors useProceedOrder's cache mechanics (prime detail + invalidate list).
 *
 * Errors:
 *   - 422 with `{ error: "unproceed_blocked", code }` — code is one of
 *     wrong_status / wrong_stage / proceed_date_passed for inline copy.
 *   - 403 / 404 / 500 — generic toast.
 */
export function useUnproceedOrder(
  orderId: string,
  opts?: Partial<UseMutationOptions<Order, ApiError, void>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, void>({
    mutationFn: () =>
      apiFetch<Order>(`/api/orders/${orderId}/unproceed`, { method: "POST" }),
    ...opts,
    onSuccess: async (...args) => {
      const [order] = args;
      qc.setQueryData(qk.order(orderId), order);
      await qc.invalidateQueries({ queryKey: qk.order(orderId), exact: true });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      /* THE OFFICE READS THE SAME ORDER THROUGH ITS OWN KEY (2026-08-29).
         Add-ons are now written from `/operation/orders/so/:id` as well as
         from the POS, and both surfaces must show the change at once — a
         shared writer that refreshes one caller’s cache and not the other’s
         is how two screens start disagreeing about what was sold. */
      void qc.invalidateQueries({ queryKey: ["operation", "orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/**
 * useTopUpOrder — POST /api/orders/:id/top-up. Records an additional partial
 * payment toward the order total. On success, primes the detail cache + busts
 * the list so kanban paid pct updates on next mount.
 *
 * 422 errors carry an `already_paid` / `wrong_status` / `invalid_amount` code
 * that the caller can branch on (sonner toast text).
 */
export function useTopUpOrder(
  orderId: string,
  opts?: Partial<UseMutationOptions<Order, ApiError, TopUpOrderInput>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, TopUpOrderInput>({
    mutationFn: (input) =>
      apiFetch<Order>(`/api/orders/${orderId}/top-up`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      const [order] = args;
      // Prime the detail cache with the freshly-mutated row so the page
      // updates instantly. We key on the orderId we already have rather
      // than the response's order.id — they should always match but the
      // closure-captured value is the safer choice when callers are
      // reading the same query.
      qc.setQueryData(qk.order(orderId), order);
      // Force a refetch on the order detail too, so the cache stays
      // authoritative even if the response shape ever drifts from the
      // GET /:id shape (defense-in-depth — no observable cost when the
      // response was correct, fixes the "Windows screen out of sync"
      // bug Loo flagged on 2026-05-03).
      await qc.invalidateQueries({ queryKey: qk.order(orderId), exact: true });
      // List views (kanban / orders tabs) — invalidate so paid pct,
      // status badge, and counts refresh when reopened.
      void qc.invalidateQueries({ queryKey: ["orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** 0233 — P3 change requests: the order's submission list (POS pending
 *  banner + the ops approval panel). RLS scopes the read. */
export function useOrderChangeRequests(orderId: string) {
  return useQuery<{ requests: OrderChangeRequestDto[] }, ApiError>({
    queryKey: ["orders", orderId, "change-requests"],
    queryFn: () => apiFetch(`/api/orders/${orderId}/change-requests`),
  });
}

/** 0233 — P3: file a proceed-lane add-product submission. */
export function useSubmitOrderChangeRequest(orderId: string) {
  const qc = useQueryClient();
  return useMutation<
    { request: OrderChangeRequestDto | null },
    ApiError,
    SubmitOrderChangeRequestInput
  >({
    mutationFn: (input) =>
      apiFetch(`/api/orders/${orderId}/change-requests`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orders", orderId, "change-requests"] });
    },
  });
}

/** 0233 — P3: requester cancels a pending submission. */
export function useCancelOrderChangeRequest(orderId: string) {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, ApiError, string>({
    mutationFn: (requestId) =>
      apiFetch(`/api/orders/${orderId}/change-requests/${requestId}/cancel`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orders", orderId, "change-requests"] });
    },
  });
}

/** 0234 — P3.1: replace a PENDING request's payload in place (View → Edit). */
export function useUpdateOrderChangeRequest(orderId: string) {
  const qc = useQueryClient();
  return useMutation<
    { request: OrderChangeRequestDto | null },
    ApiError,
    { requestId: string; input: SubmitOrderChangeRequestInput }
  >({
    mutationFn: ({ requestId, input }) =>
      apiFetch(`/api/orders/${orderId}/change-requests/${requestId}/edit`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orders", orderId, "change-requests"] });
    },
  });
}

/** 0231 — Add-product P1: append server-priced lines to a Place-lane order
 *  (POST /api/orders/:id/lines). Same cache discipline as useTopUpOrder:
 *  prime the detail, refetch it, invalidate the lists. */
export function useAddOrderLines(
  orderId: string,
  opts?: Partial<UseMutationOptions<Order, ApiError, AddOrderLinesInput>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, AddOrderLinesInput>({
    mutationFn: (input) =>
      apiFetch<Order>(`/api/orders/${orderId}/lines`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      const [order] = args;
      qc.setQueryData(qk.order(orderId), order);
      await qc.invalidateQueries({ queryKey: qk.order(orderId), exact: true });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      /* ⭐ THE OFFICE READS THIS ORDER THROUGH ITS OWN KEY (YH, 2026-09-01 —
         "ensure numbers and generated SO are correct").
         `["orders"]` does not reach `["operation","orders",id]`: React Query
         matches a key by PREFIX, and the office key does not start with
         `orders`. So the Sales Order workspace never refetched after a service
         was added — the operator pressed `Add`, the panel closed, and the
         Goods table, the document preview and the Money total all went on
         showing the order without it until the page was reloaded.
         `useEditOrderAddon` and `useRemoveOrderAddon` both invalidate this key
         and both point AT THIS HOOK in their comments — "see
         `useAddOrderLines`. Both surfaces refresh, or they disagree." The
         comment described a rule this hook never followed. */
      void qc.invalidateQueries({ queryKey: ["operation", "orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** 0255 — line EDIT: replace one item (or a whole exploded sofa group) on a
 *  PLACE-lane order with a re-configured, server-re-priced version. Up-sell
 *  only (`downsell_blocked` 422 otherwise). */
export function useReplaceOrderLines(
  orderId: string,
  opts?: Partial<UseMutationOptions<Order, ApiError, ReplaceOrderLinesInput>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, ReplaceOrderLinesInput>({
    mutationFn: (input) =>
      apiFetch<Order>(`/api/orders/${orderId}/lines/replace`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      const [order] = args;
      qc.setQueryData(qk.order(orderId), order);
      await qc.invalidateQueries({ queryKey: qk.order(orderId), exact: true });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** 0258 — qty/size edit on a SERVICE add-on row (place lane direct; the
 *  proceed lane files an edit_addon change request instead). Up-sell law:
 *  qty can only stay or increase (`downsell_blocked`). */
export function useEditOrderAddon(orderId: string) {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, { addonId: string; input: EditOrderAddonInput }>({
    mutationFn: ({ addonId, input }) =>
      apiFetch<Order>(`/api/orders/${orderId}/addons/${addonId}/edit`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: async (order) => {
      qc.setQueryData(qk.order(orderId), order);
      await qc.invalidateQueries({ queryKey: qk.order(orderId), exact: true });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      /* The office reads this order through its own key — see
         `useAddOrderLines`. Both surfaces refresh, or they disagree. */
      void qc.invalidateQueries({ queryKey: ["operation", "orders"] });
    },
  });
}


/**
 * useCreateStripeCheckout — POST /api/orders/:id/stripe/checkout (0223).
 * Mints a Stripe Checkout link (QR at the counter / WhatsApp) for RM<amount>.
 * The server re-validates amount ≤ outstanding; 422 codes:
 * amount_exceeds_outstanding (body carries maxAmount) / already_paid /
 * wrong_status. 503 = Stripe keys not configured yet.
 */
export function useCreateStripeCheckout(
  orderId: string,
  opts?: Partial<UseMutationOptions<{ session: StripeCheckoutSessionInfo }, ApiError, CreateStripeCheckoutInput>>,
) {
  return useMutation<{ session: StripeCheckoutSessionInfo }, ApiError, CreateStripeCheckoutInput>({
    mutationFn: (input) =>
      apiFetch<{ session: StripeCheckoutSessionInfo }>(`/api/orders/${orderId}/stripe/checkout`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
  });
}

/**
 * useStripeCheckoutStatus — GET /api/orders/:id/stripe/checkout/:sid (0223).
 * Polls one checkout link while the collect modal is open. While the session
 * is 'open' the SERVER also live-reconciles against Stripe, so a counter
 * payment lands within one poll even before the webhook endpoint exists.
 * Callers watch data.session.status flip to 'paid' and then invalidate
 * qk.order(orderId) + ["orders"] (the RPC moved orders.paid server-side).
 */
export function useStripeCheckoutStatus(
  orderId: string,
  sessionId: string | null,
  opts?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery<{ session: StripeCheckoutSessionInfo }, ApiError>({
    queryKey: qk.stripeSession(orderId, sessionId ?? ""),
    queryFn: () =>
      apiFetch<{ session: StripeCheckoutSessionInfo }>(
        `/api/orders/${orderId}/stripe/checkout/${sessionId}`,
      ),
    enabled: !!sessionId && (opts?.enabled ?? true),
    refetchInterval: opts?.refetchInterval ?? 4000,
    refetchIntervalInBackground: false,
  });
}

/** useUpdateOrder — PATCH /api/orders/:id. Phase 2C.2 — full edit of a Place
 *  order's customer + delivery fields. Only keys present in the payload are
 *  updated; the RPC enforces that no fields → 400, status≠place → 422. */
export function useUpdateOrder(
  orderId: string,
  opts?: Partial<UseMutationOptions<Order, ApiError, UpdateOrderInput>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, UpdateOrderInput>({
    mutationFn: (input) =>
      apiFetch<Order>(`/api/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      const [order] = args;
      // Prime the detail cache with the freshly-mutated row so the page
      // updates instantly. We key on the orderId we already have rather
      // than the response's order.id — they should always match but the
      // closure-captured value is the safer choice when callers are
      // reading the same query.
      qc.setQueryData(qk.order(orderId), order);
      // Force a refetch on the order detail too, so the cache stays
      // authoritative even if the response shape ever drifts from the
      // GET /:id shape (defense-in-depth — no observable cost when the
      // response was correct, fixes the "Windows screen out of sync"
      // bug Loo flagged on 2026-05-03).
      await qc.invalidateQueries({ queryKey: qk.order(orderId), exact: true });
      // List views (kanban / orders tabs) — invalidate so paid pct,
      // status badge, and counts refresh when reopened.
      void qc.invalidateQueries({ queryKey: ["orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** useCancelOrder — POST /api/orders/:id/cancel. Phase 2C.3 — sets status to
 *  'cancelled'. Only Place orders cancelable. Reason persisted in
 *  order_history.metadata for the audit trail. */
export function useCancelOrder(
  orderId: string,
  opts?: Partial<UseMutationOptions<Order, ApiError, CancelOrderInput>>,
) {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, CancelOrderInput>({
    mutationFn: (input) =>
      apiFetch<Order>(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      const [order] = args;
      // Prime the detail cache with the freshly-mutated row so the page
      // updates instantly. We key on the orderId we already have rather
      // than the response's order.id — they should always match but the
      // closure-captured value is the safer choice when callers are
      // reading the same query.
      qc.setQueryData(qk.order(orderId), order);
      // Force a refetch on the order detail too, so the cache stays
      // authoritative even if the response shape ever drifts from the
      // GET /:id shape (defense-in-depth — no observable cost when the
      // response was correct, fixes the "Windows screen out of sync"
      // bug Loo flagged on 2026-05-03).
      await qc.invalidateQueries({ queryKey: qk.order(orderId), exact: true });
      // List views (kanban / orders tabs) — invalidate so paid pct,
      // status badge, and counts refresh when reopened.
      void qc.invalidateQueries({ queryKey: ["orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}


/**
 * Catalog bundle — models + skus + sofa fabrics + addons + floor_config.
 * staleTime: 5 min (D5). Wizard Step 2 explicitly calls `.refetch()` on mount
 * so the dealer always sees fresh prices before they pick products.
 *
 * 0075 (Loo 2026-05-09) — `admin: true` includes discontinued models so the
 * catalog admin UI can render them with a Restore toggle. Uses a distinct
 * cache key so the admin + public bundles don't collide.
 */
export function useCatalog(
  opts?: Partial<UseQueryOptions<CatalogResponse>> & { admin?: boolean },
) {
  const { admin, ...rest } = opts ?? {};
  return useQuery({
    queryKey: admin ? [...qk.catalog(), "admin"] : qk.catalog(),
    queryFn: () =>
      apiFetch<CatalogResponse>(`/api/catalog${admin ? "?admin=true" : ""}`),
    staleTime: 5 * 60_000,
    ...rest,
  });
}

export function useOutlets(opts?: Partial<UseQueryOptions<OutletsListResponse>>) {
  return useQuery({
    queryKey: qk.outlets(),
    queryFn: () => apiFetch<OutletsListResponse>("/api/outlets"),
    staleTime: 5 * 60_000,
    ...opts,
  });
}

/* ─── 0187 (Phase 8c) — PWP voucher codes (SAME-CART reserve API) ───────────── */

/**
 * usePwpCodesMine — GET /api/pwp-codes/mine. The caller's RESERVED pwp_codes,
 * feeding the POS Auto-Fill voucher rail (the cart binds a RESERVED code onto an
 * eligible reward line so the order route claims it). Self-heals on the server
 * (an owner-scoped orphan reaper runs before the read). `enabled` defaults true
 * but the POS only mounts this when a catalog with ACTIVE pwp_rules is loaded —
 * DORMANT carts pass `enabled: false` so a no-rules order makes zero reserve
 * traffic (byte-identical). Short `staleTime` so the rail reflects reserves
 * promptly; the reserve/free mutations also invalidate it.
 */
export function usePwpCodesMine(opts?: Partial<UseQueryOptions<PwpCodesResponse>>) {
  return useQuery({
    queryKey: qk.pwpCodesMine(),
    queryFn: () => apiFetch<PwpCodesResponse>("/api/pwp-codes/mine"),
    staleTime: 10_000,
    ...opts,
  });
}

/**
 * useReservePwpCode — POST /api/pwp-codes/reserve. Idempotent (sequential)
 * reconcile of ONE trigger line's RESERVED set (top-up / trim). On success,
 * invalidate `pwpCodesMine` so the Auto-Fill rail re-reads the live set. The
 * reconciler treats this as best-effort — a failed reserve just shows fewer
 * codes in the rail; it never blocks submit.
 */
export function useReservePwpCode(
  opts?: Partial<UseMutationOptions<PwpCodesResponse, ApiError, PwpReserveInput>>,
) {
  const qc = useQueryClient();
  return useMutation<PwpCodesResponse, ApiError, PwpReserveInput>({
    mutationFn: (input) =>
      apiFetch<PwpCodesResponse>("/api/pwp-codes/reserve", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.pwpCodesMine() });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/**
 * useFreePwpCode — DELETE /api/pwp-codes/reserve?cartLineKey=… Frees a removed /
 * zeroed trigger line's RESERVED codes (RESERVED only — never USED). On success,
 * invalidate `pwpCodesMine`. Best-effort — a missed free is swept by the order
 * route's Confirm-pass / the RESERVED-orphan cron.
 */
export function useFreePwpCode(
  opts?: Partial<UseMutationOptions<{ ok: boolean }, ApiError, string>>,
) {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, ApiError, string>({
    mutationFn: (cartLineKey) =>
      apiFetch<{ ok: boolean }>(
        `/api/pwp-codes/reserve?cartLineKey=${encodeURIComponent(cartLineKey)}`,
        { method: "DELETE" },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.pwpCodesMine() });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/* ─── 0188 (Phase 8d) — PWP cross-order voucher DISCOVERY ───────────────────── */

/**
 * usePwpAvailableForPhone — GET /api/pwp-codes/available?phone=…[&code=…]. The
 * cross-order voucher discovery the POS cross-order affordance reads: the customer
 * enters / has captured a phone (auto-suggest) OR a salesperson types a voucher
 * code (manual entry). The route calls the SECURITY DEFINER `pwp_discover_available`
 * which returns the STRIPPED projection (NO bound phone / owner / trigger sku) +
 * a server-computed `phoneMatches` boolean — so the raw bound phone is never sent
 * to the client (no PII / enumeration oracle). PDPA-safe by construction.
 *
 * `enabled` is gated by the caller on (PWP active AND a selector is present): with
 * no phone + no code the query is disabled (the route would 0-row anyway), so a
 * DORMANT / no-selector cart makes ZERO discovery traffic. Short `staleTime` so a
 * freshly-redeemed voucher drops out of the suggestion promptly on re-fetch.
 */
export function usePwpAvailableForPhone(
  selector: { phone?: string | null; code?: string | null; name?: string | null },
  opts?: Partial<UseQueryOptions<PwpDiscoverResponse>>,
) {
  const phone = (selector.phone ?? "").trim();
  const code = (selector.code ?? "").trim();
  // 0204 — the customer NAME rides along so the server can compute nameMatches
  // (the 2990s name+phone identity). Never a selector on its own.
  const name = (selector.name ?? "").trim();
  return useQuery({
    queryKey: qk.pwpAvailable({ phone: phone || null, code: code || null, name: name || null }),
    queryFn: () => {
      const params = new URLSearchParams();
      if (phone) params.set("phone", phone);
      if (code) params.set("code", code);
      if (name) params.set("name", name);
      return apiFetch<PwpDiscoverResponse>(
        `/api/pwp-codes/available${params.toString() ? `?${params.toString()}` : ""}`,
      );
    },
    // Default off unless a selector exists; the caller AND-gates with PWP-active.
    enabled: Boolean(phone || code),
    staleTime: 10_000,
    ...opts,
  });
}

/**
 * usePwpCodesByOrder — GET /api/pwp-codes/by-order/:orderId. The vouchers EARNED
 * on one order (carry-forward `source_order_id` = this order) — the 2990s
 * "codes printed on the SO" surface (Loo 2026-07-06): the POS ThankYou screen
 * lists them so the customer walks away with the code. Owner/dealer-scoped via
 * RLS; an order with no carried vouchers returns `{ codes: [] }`.
 */
export function usePwpCodesByOrder(
  orderId: string | null,
  opts?: Partial<UseQueryOptions<PwpCodesResponse>>,
) {
  return useQuery({
    queryKey: qk.pwpByOrder(orderId ?? ""),
    queryFn: () => apiFetch<PwpCodesResponse>(`/api/pwp-codes/by-order/${orderId}`),
    enabled: Boolean(orderId),
    staleTime: 30_000,
    ...opts,
  });
}

/**
 * 2026-05-22 (Loo) — Dealer-side create outlet. Used in the POS Staff overlay's
 * OutletsSection to add a second / third physical location after the
 * principal-seeded default outlet.
 */
export function useCreateOutlet(
  opts?: Partial<
    UseMutationOptions<
      { id: string; dealerId: string; name: string; address: string },
      ApiError,
      { name: string; address: string }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ id: string; dealerId: string; name: string; address: string }>(
        "/api/outlets",
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.outlets() });
      opts?.onSuccess?.(
        ...(args as Parameters<NonNullable<typeof opts.onSuccess>>),
      );
    },
  });
}

export function useSalespersons(
  outletId?: string,
  opts?: Partial<UseQueryOptions<SalespersonsListResponse>>,
) {
  return useQuery({
    queryKey: qk.salespersons(outletId),
    queryFn: () =>
      apiFetch<SalespersonsListResponse>(
        outletId ? `/api/salespersons?outletId=${outletId}` : "/api/salespersons",
      ),
    staleTime: 5 * 60_000,
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// 0233 — Staff PIN login (Loo 2026-07-18)
//
// Read the staff roster + tier/PIN state, and the four token-minting /
// roster-mutating calls. Verify-pin / reauth / self-token return a signed staff
// token (StaffSessionResponse) the caller stores in `useStaffSession`; the
// central fetcher then echoes it on every subsequent request. Roster mutations
// invalidate BOTH `staff` (hasPin/tier) and `salespersons` (the POS dropdowns
// read the same rows).
// ---------------------------------------------------------------------------

/** GET /api/staff — the store's staff roster + `activated`/`selfStaffId`/`storeKind`.
 *  A principal passes another store's `dealerId` (RLS-read-all for internal roles);
 *  own-store reads pass none. */
export function useStaffList(
  dealerId?: string,
  opts?: Partial<UseQueryOptions<StaffListResponse>>,
) {
  return useQuery({
    queryKey: qk.staff(dealerId),
    queryFn: () =>
      apiFetch<StaffListResponse>(
        dealerId ? `/api/staff?dealerId=${dealerId}` : "/api/staff",
      ),
    staleTime: 30_000,
    ...opts,
  });
}

/** POST /api/staff/verify-pin — tap-a-tile PIN verify. Success mints a token;
 *  errors surface via ApiError.body (bad_pin{remaining} 401 · pin_locked{lockedUntil}
 *  423 · no_pin 409) for the keypad to render. */
export function useVerifyPin(
  opts?: Partial<UseMutationOptions<StaffSessionResponse, ApiError, VerifyPinInput>>,
) {
  return useMutation<StaffSessionResponse, ApiError, VerifyPinInput>({
    mutationFn: (input) =>
      apiFetch<StaffSessionResponse>("/api/staff/verify-pin", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
  });
}

/** POST /api/staff/reauth — re-prove the STORE email+password to mint an
 *  owner-mode token (setup wizard + "Forgot PIN"). */
export function useStaffReauth(
  opts?: Partial<UseMutationOptions<StaffSessionResponse, ApiError, StaffReauthInput>>,
) {
  return useMutation<StaffSessionResponse, ApiError, StaffReauthInput>({
    mutationFn: (input) =>
      apiFetch<StaffSessionResponse>("/api/staff/reauth", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
  });
}

/** POST /api/staff/self-token — a salesperson-role login mints its own token
 *  from the linked salespersons row (409 when unlinked). */
export function useStaffSelfToken(
  opts?: Partial<UseMutationOptions<StaffSessionResponse, ApiError, void>>,
) {
  return useMutation<StaffSessionResponse, ApiError, void>({
    mutationFn: () => apiFetch<StaffSessionResponse>("/api/staff/self-token", { method: "POST" }),
    ...opts,
  });
}

/** POST /api/staff — create a staff member (tier gating is server-side). A
 *  principal provisioning ANOTHER store passes `dealerId` (query param, like the
 *  GET); own-store creates omit it and the JWT's dealer wins. */
export function useCreateStaff(
  opts?: Partial<UseMutationOptions<StaffDto, ApiError, CreateStaffInput & { dealerId?: string }>>,
) {
  const qc = useQueryClient();
  return useMutation<StaffDto, ApiError, CreateStaffInput & { dealerId?: string }>({
    mutationFn: ({ dealerId, ...input }) =>
      apiFetch<StaffDto>(`/api/staff${dealerId ? `?dealerId=${dealerId}` : ""}`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["staff"] });
      await qc.invalidateQueries({ queryKey: ["salespersons"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** PATCH /api/staff/:id — edit name/color/outlet/tier/active (server tier-gates).
 *  An internal HQ caller (principal / bd) editing ANOTHER store's member passes
 *  `dealerId` — the server resolves the target store from the query param. */
export function usePatchStaff(
  opts?: Partial<
    UseMutationOptions<StaffDto, ApiError, { id: string; patch: UpdateStaffInput; dealerId?: string }>
  >,
) {
  const qc = useQueryClient();
  return useMutation<StaffDto, ApiError, { id: string; patch: UpdateStaffInput; dealerId?: string }>({
    mutationFn: ({ id, patch, dealerId }) =>
      apiFetch<StaffDto>(`/api/staff/${id}${dealerId ? `?dealerId=${dealerId}` : ""}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["staff"] });
      await qc.invalidateQueries({ queryKey: ["salespersons"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** POST /api/staff/:id/pin — set/reset a member's 6-digit PIN (server scope-gates).
 *  An internal HQ caller (principal / bd) targeting ANOTHER store's member
 *  passes `dealerId` — without it the server's target-dealer resolve 400s. */
export function useSetStaffPin(
  opts?: Partial<
    UseMutationOptions<{ ok: true }, ApiError, { id: string; dealerId?: string } & SetStaffPinInput>
  >,
) {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, ApiError, { id: string; dealerId?: string } & SetStaffPinInput>({
    mutationFn: ({ id, pin, dealerId }) =>
      apiFetch<{ ok: true }>(`/api/staff/${id}/pin${dealerId ? `?dealerId=${dealerId}` : ""}`, {
        method: "POST",
        body: JSON.stringify({ pin }),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["staff"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

// ---------------------------------------------------------------------------
// 0240 — store-account email-change (dealer principal submits; HQ decides).
// Password change never touches these — it is client → Supabase Auth direct
// (lib/password.ts).
// ---------------------------------------------------------------------------

/** GET /api/account/email-change — my store's LATEST request (any status). */
export function useMyEmailChange(
  opts?: Partial<UseQueryOptions<{ request: EmailChangeRequestDto | null }>>,
) {
  return useQuery({
    queryKey: qk.emailChange(),
    queryFn: () => apiFetch<{ request: EmailChangeRequestDto | null }>("/api/account/email-change"),
    staleTime: 30_000,
    ...opts,
  });
}

/** POST /api/account/email-change — submit for HQ approval (password re-proof).
 *  ApiError bodies: bad_password 401 · email_in_use/same_email 422 ·
 *  pending_exists 409. */
export function useSubmitEmailChange(
  opts?: Partial<UseMutationOptions<EmailChangeRequestDto, ApiError, SubmitEmailChangeInput>>,
) {
  const qc = useQueryClient();
  return useMutation<EmailChangeRequestDto, ApiError, SubmitEmailChangeInput>({
    mutationFn: (input) =>
      apiFetch<EmailChangeRequestDto>("/api/account/email-change", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.emailChange() });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** POST /api/account/email-change/:id/cancel — withdraw my pending request. */
export function useCancelEmailChange(
  opts?: Partial<UseMutationOptions<EmailChangeRequestDto, ApiError, { id: string }>>,
) {
  const qc = useQueryClient();
  return useMutation<EmailChangeRequestDto, ApiError, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<EmailChangeRequestDto>(`/api/account/email-change/${id}/cancel`, { method: "POST" }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.emailChange() });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** GET /api/principal/accounts/email-change-requests — the HQ queue. */
export function usePrincipalEmailChanges(
  opts?: Partial<UseQueryOptions<{ requests: EmailChangeRequestDto[] }>>,
) {
  return useQuery({
    queryKey: qk.principal.emailChanges(),
    queryFn: () =>
      apiFetch<{ requests: EmailChangeRequestDto[] }>(
        "/api/principal/accounts/email-change-requests",
      ),
    ...opts,
  });
}

/** POST /api/principal/accounts/email-change-requests/:id/(approve|reject). */
export function useDecideEmailChange(
  opts?: Partial<
    UseMutationOptions<
      EmailChangeRequestDto,
      ApiError,
      { id: string; action: "approve" | "reject"; note?: string }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    EmailChangeRequestDto,
    ApiError,
    { id: string; action: "approve" | "reject"; note?: string }
  >({
    mutationFn: ({ id, action, note }) =>
      apiFetch<EmailChangeRequestDto>(
        `/api/principal/accounts/email-change-requests/${id}/${action}`,
        { method: "POST", body: JSON.stringify(note ? { note } : {}) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.principal.emailChanges() });
      // Approve changes the login email shown in the accounts table too.
      await qc.invalidateQueries({ queryKey: qk.principal.accounts() });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 3 — Principal hooks
// ---------------------------------------------------------------------------
// API contract is snake_case for dashboard / approvals / audit (the RPC
// payload is forwarded verbatim) and camelCase for the dealer list rows
// (the dealers route does the snake→camel adapter inline). We mirror that
// distinction here in the response types — no silent conversion.

/** Shape returned by GET /api/principal/dashboard.
 *  Matches `principal_dashboard_summary()` (migration 0013). */
export interface PrincipalDashboardKpis {
  total_gmv: number;
  active_orders: number;
  active_dealers: number;
  total_dealers: number;
  pending_approvals: number;
  low_stock_skus: number;
}
export interface PrincipalLeaderboardRow {
  id: string;
  name: string;
  region: string;
  status: string;
  order_count: number;
  gmv: number;
}
export interface PrincipalPendingApprovalRow {
  id: string;
  kind: string;
  title: string;
  actor: string;
  refers_to: string | null;
  amount: number | null;
  dealer_id: string | null;
  created_at: string;
}
export interface PrincipalAuditRow {
  id: string;
  role: string;
  actor_text: string;
  action: string;
  dealer_id: string | null;
  ref: string | null;
  occurred_at: string;
}
export interface PrincipalAlerts {
  suspended_dealers: number;
  low_stock: { sku: string; name: string; available: number; incoming: number }[];
}
export interface PrincipalDashboardResponse {
  kpis: PrincipalDashboardKpis;
  leaderboard: PrincipalLeaderboardRow[];
  pending_approvals: PrincipalPendingApprovalRow[];
  audit_recent: PrincipalAuditRow[];
  alerts: PrincipalAlerts;
}

/** Shape returned by GET /api/approvals (raw row from approvals table). */
export interface ApprovalRow {
  id: string;
  kind: string;
  status: "pending" | "approved" | "rejected";
  title: string;
  actor: string;
  refers_to: string | null;
  amount: number | null;
  dealer_id: string | null;
  reason: string | null;
  decided_by: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}
export interface ApprovalsListResponse {
  approvals: ApprovalRow[];
}

/** Shape returned by GET /api/principal/dealers (camelCase via inline adapter). */
export interface PrincipalDealerRow {
  id: string;
  name: string;
  region: string;
  contact: string;
  status: "active" | "suspended" | "pending" | "rejected";
  joinedDate: string;
  creditLimit: number;
  paymentTerms: string;
  depositBalance: number;
  orderCount: number;
  gmv: number;
  outstanding: number;
  /** 'showroom' = one of Carres' OWN stores; 'dealer' = an external reseller.
   *  HQ lists the two on separate pages (Loo 2026-07-19). */
  channel: StoreChannel;
  /** How many outlets hang off this account (a dealer's branches). */
  outletCount: number;
  /** 0543 — dealer code (JB1, JB2); null until Finance sets one. */
  code: string | null;
}
export interface PrincipalDealersListResponse {
  dealers: PrincipalDealerRow[];
}

/** Shape returned by GET /api/principal/dealers/:id. The `dealer` field is
 *  the raw row from `dealer_with_stats` RPC (snake_case). `recentOrders` is
 *  hand-rolled camelCase in the route. */
export interface PrincipalDealerDetailDealer {
  id: string;
  name: string;
  region: string;
  contact: string;
  status: string;
  joined_date: string;
  credit_limit: number;
  payment_terms: string;
  deposit_balance: number;
  order_count: number;
  gmv: number;
  outstanding: number;
  // 2026-05-22 (Loo) — populated by GET /api/principal/dealers/:id via a
  // second SELECT, since dealer_with_stats RPC returns only legacy columns.
  // All null-able because pre-migration-0144/0145/0146 rows may not have
  // had the editor touch them yet.
  address: string | null;
  ssm_code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  /** Same second SELECT — tells the drawer whether this is one of Carres' own
   *  showrooms (no SSM / PIC) or an external dealer. */
  channel: StoreChannel;
  /** 0543 — dealer code and optional state. */
  code: string | null;
  state: string | null;
  /** 0598 — where a commission payment goes. */
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_holder: string | null;
}
export interface PrincipalDealerRecentOrder {
  id: string;
  so: number;
  status: string;
  customerName: string;
  paid: number;
  total: number;
}
export interface PrincipalDealerDetailResponse {
  dealer: PrincipalDealerDetailDealer;
  recentOrders: PrincipalDealerRecentOrder[];
}

// === Read hooks ===

/** Dashboard summary — KPIs + leaderboard + pending approvals + audit recent
 *  + alerts. One round-trip per refresh. */
export function usePrincipalDashboard(
  opts?: Partial<UseQueryOptions<PrincipalDashboardResponse>>,
) {
  return useQuery({
    queryKey: qk.principal.dashboard(),
    queryFn: () =>
      apiFetch<PrincipalDashboardResponse>("/api/principal/dashboard"),
    staleTime: 30_000,
    ...opts,
  });
}

/** Approvals inbox — defaults to status='pending' on the server when omitted. */
export function useApprovals(
  filters: ApprovalFilters = {},
  opts?: Partial<UseQueryOptions<ApprovalsListResponse>>,
) {
  return useQuery({
    queryKey: qk.principal.approvals(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.kind) params.set("kind", filters.kind);
      const qs = params.toString();
      return apiFetch<ApprovalsListResponse>(
        `/api/approvals${qs ? `?${qs}` : ""}`,
      );
    },
    staleTime: 30_000,
    ...opts,
  });
}

/** Dealer admin list — rolled-up stats (gmv, order_count, outstanding). */
export function usePrincipalDealers(
  filters: PrincipalDealerFilters = {},
  opts?: Partial<UseQueryOptions<PrincipalDealersListResponse>>,
) {
  return useQuery({
    queryKey: qk.principal.dealers(filters),
    queryFn: () =>
      apiFetch<PrincipalDealersListResponse>("/api/principal/dealers"),
    staleTime: 30_000,
    ...opts,
  });
}

/** Dealer detail + last 8 orders. Pass `null` when no dealer is open
 *  (e.g. drawer closed) to disable the query. */
export function usePrincipalDealer(
  id: string | null,
  opts?: Partial<UseQueryOptions<PrincipalDealerDetailResponse>>,
) {
  return useQuery({
    queryKey: id ? qk.principal.dealer(id) : (["principal", "dealers", "null"] as const),
    queryFn: () =>
      apiFetch<PrincipalDealerDetailResponse>(`/api/principal/dealers/${id}`),
    enabled: !!id,
    staleTime: 10_000,
    ...opts,
  });
}

// === Mutation hooks (closure-captured ID, await invalidate) ===
//
// All four follow the Phase 2C cache-sync pattern:
//   1. The mutation hook closes over the id (e.g. `useDecideApproval(id)`)
//      so callers cannot accidentally mismatch the URL param vs the cache key
//      when reading from the same query.
//   2. `onSuccess` `await`s every invalidation BEFORE returning, so the next
//      render sees authoritative data — fixes the "Windows screen out of
//      sync" class of bugs we hit in 2C.

/** Decide an approval (approve | reject). Ripples to dashboard (KPI counts),
 *  approvals list (status flip), and dealers (new_dealer approvals turn a
 *  pending dealer active). */
export function useDecideApproval(
  approvalId: string,
  opts?: Partial<
    UseMutationOptions<
      { approval: ApprovalRow },
      ApiError,
      { status: "approved" | "rejected"; note?: string }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    { approval: ApprovalRow },
    ApiError,
    { status: "approved" | "rejected"; note?: string }
  >({
    mutationFn: (input) =>
      apiFetch<{ approval: ApprovalRow }>(
        `/api/approvals/${approvalId}/decide`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["principal", "approvals"] });
      await qc.invalidateQueries({
        queryKey: qk.principal.dashboard(),
        exact: true,
      });
      await qc.invalidateQueries({ queryKey: ["principal", "dealers"] });
      opts?.onSuccess?.(
        ...(args as Parameters<NonNullable<typeof opts.onSuccess>>),
      );
    },
  });
}

/** Invite a new dealer. Idempotent on (name, region) — server returns
 *  `idempotent: true` when the second call hits an existing pending dealer. */
export function useInviteDealer(
  opts?: Partial<
    UseMutationOptions<
      {
        dealer: PrincipalDealerDetailDealer;
        approval: ApprovalRow;
        idempotent: boolean;
      },
      ApiError,
      { name: string; region: string; contact: string }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    {
      dealer: PrincipalDealerDetailDealer;
      approval: ApprovalRow;
      idempotent: boolean;
    },
    ApiError,
    { name: string; region: string; contact: string }
  >({
    mutationFn: (input) =>
      apiFetch<{
        dealer: PrincipalDealerDetailDealer;
        approval: ApprovalRow;
        idempotent: boolean;
      }>("/api/principal/dealers/invite", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["principal", "dealers"] });
      await qc.invalidateQueries({ queryKey: ["principal", "approvals"] });
      await qc.invalidateQueries({
        queryKey: qk.principal.dashboard(),
        exact: true,
      });
      opts?.onSuccess?.(
        ...(args as Parameters<NonNullable<typeof opts.onSuccess>>),
      );
    },
  });
}

/** Suspend / reactivate a dealer. Updates dashboard suspended_dealers count
 *  via dashboard invalidate. */
export function useDealerSetStatus(
  dealerId: string,
  opts?: Partial<
    UseMutationOptions<
      { dealer: PrincipalDealerDetailDealer },
      ApiError,
      { status: "active" | "suspended"; reason?: string }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    { dealer: PrincipalDealerDetailDealer },
    ApiError,
    { status: "active" | "suspended"; reason?: string }
  >({
    mutationFn: (input) =>
      apiFetch<{ dealer: PrincipalDealerDetailDealer }>(
        `/api/principal/dealers/${dealerId}/status`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({
        queryKey: qk.principal.dealer(dealerId),
        exact: true,
      });
      await qc.invalidateQueries({ queryKey: ["principal", "dealers"] });
      await qc.invalidateQueries({
        queryKey: qk.principal.dashboard(),
        exact: true,
      });
      opts?.onSuccess?.(
        ...(args as Parameters<NonNullable<typeof opts.onSuccess>>),
      );
    },
  });
}

/**
 * 2026-05-22 (Loo) — PATCH dealer profile (name, region, address, ssm_code,
 * contact name/phone). Every field optional; the server applies a partial
 * UPDATE and recomputes the legacy `dealers.contact` text column when
 * contact_name or contact_phone changes.
 */
export function useUpdateDealer(
  dealerId: string,
  opts?: Partial<
    UseMutationOptions<
      { ok: boolean; dealer: unknown },
      ApiError,
      {
        name?: string;
        region?: string;
        address?: string;
        ssmCode?: string;
        contactName?: string;
        contactPhone?: string;
        code?: string;
        state?: string;
        bankName?: string;
        bankAccountNo?: string;
        bankAccountHolder?: string;
      }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ ok: boolean; dealer: unknown }>(
        `/api/principal/dealers/${dealerId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({
        queryKey: qk.principal.dealer(dealerId),
        exact: true,
      });
      await qc.invalidateQueries({ queryKey: ["principal", "dealers"] });
      opts?.onSuccess?.(
        ...(args as Parameters<NonNullable<typeof opts.onSuccess>>),
      );
    },
  });
}

// ===========================================================================
// Phase 10 — Principal Accounts admin
// ===========================================================================
// Closes phase-10-rotate-alpha-test-passwords HIGH carry-forward by giving
// the principal a UI surface for create / disable / re-enable / reset-password
// instead of needing direct SQL + auth.admin.updateUserById on the server.

export type AppRole =
  | "principal"
  | "dealer"
  | "salesperson"
  | "showroom"
  | "operation"
  | "supplier"
  | "partner"
  | "finance"
  | "bd"
  | "hr";

export interface AccountRow {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  title: string | null;
  status: "active" | "invited" | "disabled";
  dealerId: string | null;
  supplierId: string | null;
  partnerId: string | null;
  outletId: string | null;
  orgName: string | null;
  createdBy: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export function usePrincipalAccounts() {
  return useQuery<{ users: AccountRow[] }, ApiError>({
    queryKey: qk.principal.accounts(),
    queryFn: () => apiFetch("/api/principal/accounts"),
  });
}

export function useCreateAccount(
  opts?: Partial<
    UseMutationOptions<
      {
        id: string;
        email: string;
        name: string;
        role: AppRole;
        dealerId: string | null;
        supplierId: string | null;
        partnerId: string | null;
      },
      ApiError,
      {
        name: string;
        email: string;
        role: AppRole;
        title?: string | null;
        companyName?: string;
        region?: string;
        outletName?: string;
        address?: string;
        ssmCode?: string;
        contactName?: string;
        contactPhone?: string;
        tempPassword: string;
        // 2026-07-18 (Loo) — first staff identity + 6-digit PIN provisioned
        // with a dealer/showroom store (see createAccountInput.initialStaff).
        initialStaff?: { name: string; staffRole: "principal" | "manager" | "salesperson"; pin: string };
      }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{
        id: string;
        email: string;
        name: string;
        role: AppRole;
        dealerId: string | null;
        supplierId: string | null;
        partnerId: string | null;
      }>("/api/principal/accounts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.principal.accounts() });
      await qc.invalidateQueries({ queryKey: qk.principal.audit() });
      opts?.onSuccess?.(
        ...(args as Parameters<NonNullable<typeof opts.onSuccess>>),
      );
    },
  });
}

export function useSetAccountStatus(
  userId: string,
  opts?: Partial<
    UseMutationOptions<
      { id: string; status: "active" | "disabled" },
      ApiError,
      { status: "active" | "disabled"; reason?: string }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ id: string; status: "active" | "disabled" }>(
        `/api/principal/accounts/${userId}/status`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.principal.accounts() });
      await qc.invalidateQueries({ queryKey: qk.principal.audit() });
      opts?.onSuccess?.(
        ...(args as Parameters<NonNullable<typeof opts.onSuccess>>),
      );
    },
  });
}

export function useResetAccountPassword(
  userId: string,
  opts?: Partial<
    UseMutationOptions<
      { id: string; ok: true },
      ApiError,
      { tempPassword: string }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ id: string; ok: true }>(
        `/api/principal/accounts/${userId}/reset-password`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.principal.audit() });
      opts?.onSuccess?.(
        ...(args as Parameters<NonNullable<typeof opts.onSuccess>>),
      );
    },
  });
}


/** Row in GET /api/operation/partners. Bare `delivery_partners` row trimmed to
 *  what `DispatchModal` needs (name + zones in the option label, contact in the
 *  preview). */
export interface DeliveryPartnerRow {
  id: string;
  name: string;
  contact: string | null;
  zones: string | null;
  /** Partner's WhatsApp GROUP invite link (chat.whatsapp.com/…), for the bulk
   *  bar's Logistic ⋮ → Chase/Remind. Seeded for NETS/AL/TEOW/TT; null = not set
   *  (the review card shows "group not set", Copy still works). */
  whatsapp_group_url?: string | null;
  /** T9 (migration 0283) — the carrier's own delivery rules. OPTIONAL on the
   *  type so a browser on this build against an older Worker degrades to "no
   *  rules recorded" (silence) instead of crashing. */
  off_days?: number[] | null;
  blackout_dates?: string[] | null;
  daily_capacity?: number | null;
  booking_lead_days?: number | null;
  /** Delivery Card 03 (0411) — the carrier's own journey calendar. OPTIONAL for
   *  the same older-Worker degrade reason: absence = "not recorded" = silence. */
  pickup_days?: number[] | null;
  journey_regions?: unknown;
  surcharge_areas?: string[] | null;
}
export interface DeliveryPartnersListResponse {
  partners: DeliveryPartnerRow[];
}

/** Row in GET /api/operation/suppliers. Used by `CreatePOModal` for the
 *  supplier dropdown + auto-detect via `cat_covered`. `kind` is the supplier's
 *  fulfilment mode (own_logistics ships goods themselves; factory_pickup
 *  expects operation to dispatch a partner to the factory). */
export interface SupplierRow {
  id: string;
  name: string;
  /** The STORED identity slug (0032 — keys SUPPLIER_SOP, unique in prod). A
   *  supplier can be renamed while this stays: `Ohana` still carries `hookka`.
   *  Optional so a browser on this build against an older Worker still parses. */
  slug?: string | null;
  kind: "own_logistics" | "factory_pickup";
  cat_covered: string[];
  lead_time: string | null;
  contact: string | null;
  whatsapp_group_url: string | null;
  /** The mailto: door's address (0313 — the ONE email column). */
  contact_email?: string | null;
  /** 0383. Optional so a browser on this build against an older Worker still parses. */
  address?: string | null;
  po_send_channel?: string | null;
}
export interface SuppliersListResponse {
  suppliers: SupplierRow[];
}

/** Phase 4.5 Chunk 2 (T9) — embedded `order_supplier_threads` row shape on
 *  operation order list/detail responses. Carries the per-leg customer-side LP
 *  fields that migrated off `purchase_orders` per design spec §CQ1 option (b).
 *  One row per (order, supplier, category); a multi-supplier order spawns N
 *  threads, each with its own customer-leg LP assignment. */
export interface operationOrderThreadRow {
  id: string;
  supplier_id: string;
  category: string;
  operation_stage:
    | "placed"
    | "confirmed"
    | "in_production"
    | "ready_to_dispatch"
    | "dispatched"
    | "delivered";
  po_id: string | null;
  /** Phase 4.5 Chunk 2 customer-leg LP source (migration 0049). FE OrderCard
   *  reads this to render the LP pill; an order may have heterogeneous LPs
   *  across threads (different supplier legs picked different partners). */
  delivery_partner_id: string | null;
  /** 2026-05-18 (Loo) — partner name embed so OrderCard pill renders
   *  "via NETS" instead of "LP-{8-char UUID}". Closes the
   *  phase-4-detail-partner-name-join carry-forward. */
  delivery_partners: { id: string; name: string } | null;
  confirm_delivery_date: string | null;
  request_for_delivery_at: string | null;
  partner_accepted_at: string | null;
  partner_rejected_at: string | null;
  /** Blueprint card §7 (2026-08-16) — the PO's issue day anchors the
   *  `Assign logistics` due (within the day the PO is issued). */
  purchase_orders?: { placed_at: string | null } | null;
}

/** Row in GET /api/operation/orders. Embedded `dealers(name)` is a PostgREST
 *  nested fetch shape — the route forwards it verbatim.
 *
 *  Pipeline v2 (C1/C2): adds `'placed'` + `'confirmed'` to operation_stage
 *  and widens status to include the dealer-side `'place'` value (orders that
 *  haven't been pushed to operation yet still surface in the kanban so HQ can
 *  see what's coming).
 *
 *  Phase 4.5 Chunk 2 (T9): adds embedded `order_supplier_threads` array
 *  (PostgREST nested fetch) — exposes per-thread customer-leg LP for the
 *  OrderCard pill. The order-level `delivery_partner_id` is kept for backward
 *  compat (print-DO and other legacy callers) — but the kanban now reads from
 *  threads to honor multi-supplier scenarios. */
export interface operationOrderListRow {
  /** Immutable first request, embedded from revision 1; missing is not current-date fallback. */
  original_request?: Array<{ revision: number; snapshot: { header: { delivery_date?: string | null; delivery_date_tbd?: boolean | null } } }>;
  id: string;
  so: number;
  /**
   * ⭐ `cancelled` RESTORED 2026-09-14 (Card 23). This row type listed three
   * statuses while the canonical `OrderStatus` in `@carres/shared`
   * (`db-types.ts`), `domain.ts` and `OperationAllOrders` all list FOUR, and
   * the database stores the fourth — three cancelled orders were measured in
   * production the day this was found.
   *
   * The narrow type was not a harmless omission: it told every reader that a
   * row on this listing could never be cancelled, which is precisely why
   * Delivery's entry predicate never tested for it and cancelled orders sat on
   * Monitor telling operators to chase customers about goods nobody is
   * sending. A type that disagrees with the table teaches the wrong rule.
   */
  status: OrderStatus;
  operation_stage:
    | "placed"
    | "confirmed"
    | "in_production"
    | "ready_to_dispatch"
    | "dispatched"
    | "delivered"
    | null;
  warehouse_id: string | null;
  customer_name: string;
  /** Jess redesign step 2 — control-table row subtitle + extra columns. All
   *  optional/nullable so the kanban OrderCard + existing fixtures that don't
   *  populate them keep typechecking. */
  customer_phone?: string | null;
  /** P2 (project-orders-control-spec) — drives the AREA (KV/Outstation) tag +
   *  the suggested default carrier in the control table (apps/web/src/lib/region.ts). */
  customer_address?: string | null;
  placed_at: string;
  /** 0396 — the actual Sales → Operation handoff moment. The Sales Orders
   *  Register's `Proceed Date` (never the planned `proceed_date` below). */
  proceeded_at?: string | null;
  delivery_date: string | null;
  delivery_date_tbd?: boolean | null;
  /** Phase 11.1 (migration 0165) — salesperson-entered planned production-start
   *  ("Process") date, pairs with delivery_date. Null on pre-11.1 / AutoCount orders. */
  proceed_date?: string | null;
  /** AutoCount provenance (migration 0132/0136). source_system='autocount'
   *  drives the entry rule (AutoCount→Proceed tab, native→Placed); source_ref
   *  is the CR/TCF doc-no list shown as the ref prefix. */
  source_system?: string | null;
  source_ref?: string[] | null;
  /** Inbox-triage LP (migration 0136), a delivery_partners.id resolved to a
   *  name client-side. Shown in the 物流 cell when no formal LP is set yet. */
  ops_assigned_logistic?: string | null;
  /** Compact line embed for the 货品 items summary (control table only).
   *  `unit_price` (C5) lets the row compute what the order is worth. */
  order_lines?: {
    id?: string;
    sku: string;
    qty: number;
    unit_price?: number | string | null;
    attrs?: Record<string, unknown> | null;
    source_po?: string | null;
    /** STAGE 1 — `Model · Variant`, resolved server-side by the SAME helper
     *  the detail route uses (Law D), so a product is never named two ways.
     *  `null` = not in the catalog (every AutoCount-imported line, whose
     *  "sku" is free text); the caller then shows that text. Optional: a
     *  browser on this build against an older Worker reads it as absent and
     *  falls back the same way. */
    label?: string | null;
    /** 2026-08-24 (OTHER GOODS TALLY) — the catalog's own category word,
     *  resolved server-side through `skuCategories` (the ONE category reader,
     *  Law D), exactly as the DETAIL route has served it since PR 885. `null`
     *  = asked, the catalog holds no such SKU. Optional: an older Worker
     *  sends nothing, the classifiers fall through to the SKU parser, and the
     *  footer behaves exactly as it did before this field existed. */
    category?: string | null;
  }[];
  /** C5 (2026-07-27) — the money truth. `orders.paid` is the only figure a
   *  live payment path writes; with the add-on sum below and the line prices
   *  above it feeds the shared `orderMoney`, so the row's 🔒, the drawer and
   *  the booking gate all answer with the same number. BOTH are optional: a
   *  browser on this build against a pre-C5 Worker reads them as absent, the
   *  order's value is then UNKNOWN, and unknown holds nothing — which is
   *  exactly what shipped before this card. */
  paid?: number | string | null;
  /** 0730 — issued credit notes; `orderMoney` takes them off what is owed. */
  credited?: number | string | null;
  order_addons?: { addon_key?: string | null; qty: number; unit_price?: number | string | null }[];
  /**
   * D1 (2026-08-06) — the SKUs a real PURCHASE ORDER covers for this order,
   * linked the drawer's own way (`purchase_orders.so` or `so_refs[]`).
   *
   * Before this the list's only PO evidence was `order_lines.source_po`, which
   * ONLY the AutoCount importer writes, so the ladder read every native order
   * as "nothing ordered". Measured on production: 19 of 28 live orders were
   * covered by a real PO and 0 carried `source_po`.
   *
   * OPTIONAL on purpose, and `undefined` must behave as "we do not know",
   * never as "there is no PO": a browser on this build against a pre-D1 Worker
   * then falls back to exactly the pre-D1 answer instead of accusing.
   */
  po_skus?: string[];
  /** Purchase-order identities linked by purchase_orders.so / so_refs. */
  po_numbers?: string[];
  /**
   * DELIVERY MONITOR (2026-09-11) — the ARRIVAL facts, one entry per purchase
   * order serving this order: its status, the SKUs it still owes, OUR
   * production-days prediction (`eta_date`), the immutable
   * supplier-facing original (`official_delivery_date`) and the latest recorded
   * supplier reply. RECORDED DATES ONLY — the state and every word come from
   * the ONE shared reader (`deliveryArrivalStateOf`).
   *
   * OPTIONAL, and `undefined` must behave as "we do not know", never as "there
   * is no purchase order": a browser on this build against an older Worker
   * prints the governed absence instead of accusing a supplier.
   */
  po_arrivals?: PoArrival[];
  /**
   * DELIVERY MONITOR (2026-09-11) — the register rows physically reserved or
   * sold to THIS order, batched once for the whole page. The counting is
   * `deliveryStockReadinessOf`'s, matched under `normalizeSkuKey` — the same
   * rule `resolveUnitAllocation` applies. Optional for the same
   * degrade-do-not-crash reason as `po_arrivals`.
   */
  allocated_units?: AllocatedUnit[];
  /** Explicit incoming pieces, bound by exclusive PO source lineage. */
  incoming_units?: import("@carres/shared").IncomingLineUnit[];
  delivery_partner_id: string | null;
  /**
   * DELIVERY CARD 02 (2026-08-21) — the multi-leg Delivery Journey
   * (`orders.delivery_stops`, migration 0156). Delivery Work renders ONE ROW
   * PER LEG, because leg 1 reaching the named JB warehouse is not the event the
   * Singapore customer is waiting for. `null`/absent or a single stop means
   * single-leg and the order is one scope — which is every live order today
   * (measured 2026-08-21: 0 of 90 open orders carry a chain). Optional, so a
   * browser on this build against an older Worker simply reads every order as
   * single-leg instead of crashing.
   */
  delivery_stops?: DeliveryStop[] | null;
  /** Migration 0147 (item h, 2026-05-23) — order-level LP request/accept/reject
   *  state. Set by `operation_confirm_proceed_request_v3` when Operation
   *  picks an LP at Accept Proceed; the LP then accepts (partner_accepted_at)
   *  or rejects (partner_rejected_at + partner_rejected_reason). On reselect
   *  Operation clears the reject and writes a fresh request_for_delivery_at. */
  request_for_delivery_at: string | null;
  partner_accepted_at: string | null;
  partner_rejected_at: string | null;
  partner_rejected_reason: string | null;
  /** Joined name for the order-level LP (when delivery_partner_id is set). */
  delivery_partners: { id: string; name: string } | null;
  do_number: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  outlet_id: string | null;
  dealer_id: string;
  dealers: { name: string } | null;
  /** STAGE 1 — the register's Salesperson / Showroom fact columns. Both are
   *  name embeds off a single FK. Optional: absent on an older Worker. */
  salesperson_id?: string | null;
  salespersons?: { name: string } | null;
  outlets?: { name: string } | null;
  /**
   * STAGE 1 — the rest of the flat facts the CUSTOMER ORDER itself owns, so
   * the register's grouped column chooser can offer every one of them
   * (hidden by default). **Every field here is a column on `orders`** (or,
   * for `building_type`, a value the Sales Portal wrote into the order's own
   * `entry_data`) — nothing is another module's record, nothing is computed.
   * All optional: on an older Worker they read as absent, the column prints
   * its absence word, and nothing crashes.
   */
  customer_email?: string | null;
  customer_billing?: string | null;
  /** 0230 — the customer ticked "Billing address same as delivery". The
   *  billing COLUMN is only meaningful when this is false; when it is true the
   *  billing address IS the delivery address and `customer_billing` is empty
   *  by design, not unrecorded. */
  customer_billing_same?: boolean;
  customer_emergency?: string | null;
  customer_address_line1?: string | null;
  customer_address_line2?: string | null;
  customer_address_city?: string | null;
  customer_address_state?: string | null;
  customer_address_postcode?: string | null;
  building_type?: string | null;
  delivery_floor?: number | null;
  delivery_has_lift?: boolean | null;
  /** 2026-08-24 POS PARITY - the till asks for these at creation (0200
   *  demographics + 0104 stair carry); the register now lists them so the
   *  office can read back what the customer was asked. */
  customer_race?: string | null;
  customer_gender?: string | null;
  customer_birthday?: string | null;
  delivery_stair_items?: number | null;
  channel?: string | null;
  invoice_no?: string | null;
  invoiced_at?: string | null;
  payment_method?: string | null;
  installment_months?: number | null;
  /** Phase 4.5 Chunk 2 (T9) embedded customer-leg LP per thread. PostgREST
   *  nested fetches always return an array shape — never `null` — so this
   *  field is non-nullable. An empty array means no threads have been spawned
   *  yet (pre-confirm-proceed orders); the FE treats `[]` as "no thread state
   *  available" and omits the LP pill. */
  order_supplier_threads: operationOrderThreadRow[];
  /** D4 (2026-09-02) — this order's OWN delivery orders, embedded on the list
   *  read. The register's `DO No` column used to resolve itself against the
   *  delivery REGISTER, whose route caps at 500 rows ordered newest-first, so
   *  an older order's DO simply was not in the answer and the cell printed
   *  "No delivery order yet" as a fact. Embedded per order there is no cap to
   *  fall outside of. Optional: an older Worker that does not select it leaves
   *  the field undefined, and the register reads that as "not carried" rather
   *  than as "none exist". */
  ops_delivery_orders?: {
    do_number: string;
    leg?: number | null;
    delivery_date?: string | null;
    time_slot?: string | null;
    voided_at?: string | null;
  }[];
  /** Delivery's own record per leg (leg 0 = whole order): the carrier and the
   *  confirmed day the drawer's Delivery card and the Monitor already read. */
  ops_delivery_arrangements?: {
    leg: number | null;
    partner_id: string | null;
    confirmed_date: string | null;
    confirmed_time: string | null;
  }[];
  /** Source-owned document ledgers, including receipts allocated to this SO. */
  invoice_documents?: { id: string; invoice_no: string | null }[];
  receipt_documents?: { id: string; receipt_no: string | null }[];
  allocated_receipts?: { order_payments: { id: string; receipt_no: string | null } | null }[];
  /** Existing amendments have no governed document-number field. */
  amendment_documents?: { id: string; status?: string }[];

  /** Blueprint card §7 (2026-08-16) — the two composed Work facts: an OPEN
   *  Finance exception (0355) and a loan still out (0209/0217). Optional so an
   *  older Worker that does not select them raises nothing (UNKNOWN never
   *  accuses). */
  /** `reason` rides the read since 2026-10-06 so Monitor's `Payment` cell can
   *  print `Finance hold · {reason}` (Delivery MASTER §3). Optional: an older
   *  Worker without it prints `Finance hold`. */
  order_finance_exceptions?: { status: "open" | "cleared"; reason?: string | null }[];
  /** 0362 — the delivery payment approvals; Monitor's `Payment` cell reads
   *  `paymentApprovalOpensGate` over them for the authoritative COD line
   *  (Delivery MASTER §8.3). Optional: absent = no approval carried. */
  order_delivery_payment_approvals?: { status: string }[];
  ops_sofa_loans?: {
    status: "on_loan" | "returned";
    /** 0492 (Card 15) — the loaned Unit, for `Loan {Unit ID} · collect back on delivery day`. */
    item_id?: string | null;
    loan_note_no?: string | null;
    ops_stock_items?: { unit_code: string | null; identity_scope: string | null } | { unit_code: string | null; identity_scope: string | null }[] | null;
  }[];
  /** Phase B (migration 0138) — latest annotation snippet for kanban card.
   *  PostgREST returns all annotations; card picks newest by created_at. */
  order_annotations: { content: string; tag: string | null; created_at: string }[];
  /** The person on the order's first history row; null when none was recorded. */
  created_by_name?: string | null;
  /** Jess 2026-06-24 — the 4 operator remark fields surfaced into the list (was
   *  drawer-only) so the Orders table's Remark column can show them. From
   *  ops_order_control (1:1 via order_id); PostgREST returns the embed as a
   *  single object, or null when no overlay row exists yet. Defensively also
   *  typed as an array in case PostgREST resolves the relation as to-many. */
  ops_order_control?: opsRemarkEmbed | opsRemarkEmbed[] | null;
}

export interface SalesOrderExpansionResponse {
  /** Exact stock Unit -> originating PO, resolved through its PO line. */
  unitCoverage?: Record<string, string | null>;
  /**
   * ⭐ WHICH ITEM LINE A UNIT ANSWERS, AS STORED (0471; carried 2026-09-11).
   *
   * `ops_stock_items.reserved_order_line_id` for every Unit this order holds,
   * and `null` for a Unit that carries no binding — a pre-0471 reservation
   * whose line was never recorded. The two are DIFFERENT facts and a screen
   * must be able to tell them apart: an exact association is evidence, an
   * unrecorded one is an unresolved association, and neither is a guess to be
   * printed as the other. Optional, so a browser on this build against an
   * older Worker reads it as absent and says the association is unknown rather
   * than inventing one.
   */
  unitLines?: Record<string, string | null>;
  /**
   * Unit -> `unit` | `quantity` (0453). A COUNTED row has no identity at all,
   * and its technical `QTY-` key must never reach a `Unit ID` heading
   * (`unit-identity.ts`). Optional: absent, the shared rule falls back to the
   * stored code's own shape, which is the same backstop it has always used.
   */
  unitScopes?: Record<string, string>;
  defaultDeliverTo: string | null;
  /**
   * DELIVERY CARD 02 (2026-08-21) — WHERE each allocated Unit is and WHO has
   * it, from Stock's own record. Optional: a browser on this build against an
   * older Worker reads it as absent and the expansion prints its governed
   * absence rather than a place nobody recorded.
   */
  place?: Array<{ unitCode: string; siteName: string | null; holderName: string | null }>;
  lines: Array<{
    lineId: string;
    sku: string;
    unitIds: string[];
    /** Order/SKU evidence without a proven link to this configured line. */
    unverifiedUnitIds?: string[];
    verifiedUnitIds?: string[];
    unitQuantityMismatch?: boolean;
    deliverTo: Array<{ name: string; qty: number }>;
  }>;
}

/** Read-only fan-in for the SO register disclosure. Stock owns Unit ID;
 * Purchasing owns Deliver To. The Sales Order stores neither fact. */
export function useSalesOrderExpansion(orderId: string | null) {
  return useQuery({
    queryKey: ["operation", "orders", orderId, "expansion"],
    queryFn: () => apiFetch<SalesOrderExpansionResponse>(`/api/operation/orders/${orderId}/expansion`),
    enabled: Boolean(orderId),
    staleTime: 30_000,
  });
}
/**
 * ONE raw entry of `ops_order_control.delivery_photos` as PostgREST returns
 * it — the ledger a driver's submission lands in (0280).
 *
 * `doNumber` and `kind` are ABSENT on every entry recorded before the
 * 2026-09-11 driver-submission ruling, which is why both are optional here and
 * why an absent `doNumber` is read as *names no delivery order* rather than
 * *belongs to all of them* (`driverSubmissionOf`).
 */
export interface DeliveryLedgerEntry {
  path: string;
  at: string;
  by: string | null;
  doNumber?: string | null;
  kind?: "photo" | "video" | null;
}

export interface opsRemarkEmbed {
  line_received?: Record<string, number> | null;
  // Optional (C2): the list no longer renders these remark fields in-row, and
  // test fixtures build partial overlays (e.g. just `balance`), so they're not
  // required on the embed type. Still selected by the query when present.
  customer_request?: string | null;
  action_for_logistic?: string | null;
  carres_remark?: string | null;
  warehouse_remark?: string | null;
  /** The logistic's committed delivery date (migration 0180) — distinct from the
   *  customer's `delivery_date` deadline. Surfaced into the Orders list ETA
   *  column (Jess 2026-06-25); operation fills it from the drawer or the cell. */
  logistic_eta?: string | null;
  /** Payment + storage overlay (C2 Next-action, 2026-07-08) — the Orders list now
   *  also reads these so the "Collect $" payment-hold + customer-call lamps can
   *  compute. All optional so pre-C2 fixtures keep typechecking. */
  balance?: number | string | null;
  payment_status?: string | null;
  /** C9 — the ladder reads the storage fee through the ONE shared rule
   *  (`storageHold`), which needs the operator's start date and the keyed
   *  override, not just the Master-imported figures. Optional, so a browser on
   *  this build against an older Worker degrades to the imported fee instead of
   *  crashing. */
  storage_from?: string | null;
  storage_fee_override?: number | string | null;
  storage_fee_msbf?: number | string | null;
  storage_fee_sof?: number | string | null;
  storage_paid?: boolean | null;
  storage_collected_at?: string | null;
  storage_waiver_status?: string | null;
  called_customer?: boolean | null;
  /** Per-line supplier ETA + stock status (Import from Master → migration 0170).
   *  `line_etas` maps a line key → ISO ETA; `line_stock_status` maps it →
   *  "waiting" / "ready". The Orders list STOCK column reads the latest waiting
   *  ETA from these (Jess spec §5, stock_eta version, 2026-07-12). */
  line_etas?: Record<string, string> | null;
  line_stock_status?: Record<string, string> | null;
  /** Staff owner (migration 0232) — soft responsibility pointer surfaced into
   *  the list for the owner chip + STAFF facet. Optional so older fixtures
   *  keep typechecking. */
  assigned_staff?: string | null;
  /** D1 two-stage booking (migration 0277, T1) — the list's Delivery column +
   *  queues read these to tell the CUSTOMER's confirmed booking apart from the
   *  carrier's provisional date (logistic_eta). Optional: a browser on this
   *  build against a pre-T1 Worker degrades to the provisional reading. */
  booking_stage?: "none" | "provisional" | "confirmed" | null;
  confirmed_date?: string | null;
  confirmed_time_slot?: string | null;
  /** T6 delivery-photo ledger (migration 0280) — surfaced into the list for T7's
   *  "Upload delivery photo" queue. `undefined` means the answer is UNKNOWN (an
   *  older Worker that doesn't select the column, or no overlay row at all), and
   *  the queue stays silent; an explicit `[]` is the real "no photo yet". Only
   *  paths ride the list — a signed view URL is minted per click in the drawer. */
  delivery_photos?: DeliveryLedgerEntry[] | null;
  /** T8 delivery groups (migration 0282) — what the LIVE booking covers.
   *  `null`/absent = the trip carries the whole order (T8's own definition, so
   *  there is nothing to backfill); T11's detail pane reads it to name the
   *  second trip. Optional: a pre-T11 Worker simply doesn't select it. */
  booking_groups?: string[] | null;
  /** C8 delay planning (migration 0304) — the recorded answer to "can we still
   *  make the promised date?", and the supplier date it was made ABOUT. The
   *  ladder reads BOTH: a decision only silences the delay it was taken about,
   *  so a factory that slips again re-opens Delay planning by itself. Optional
   *  → `undefined` on a pre-0304 Worker, which reproduces the pre-C8 behaviour
   *  (the radar fires on the overshoot, as it always did). */
  delay_decision?: "keep" | "new_date" | null;
  delay_decision_eta?: string | null;
  /** C8b the two delay clocks (migration 0305) — the two moments the delay
   *  deadlines count from: `delay_detected_at` = the day the supplier's date
   *  FIRST overshot the promise (Delay planning, 2 working days),
   *  `delay_decision_at` = the moment Operations recorded that the promise
   *  cannot be met (the logistics call, the SAME working day). Both are
   *  server-owned. `delay_detected_eta` says which supplier date the sighting
   *  was about, so a stamp that has stopped being about the current date is not
   *  trusted. Optional → absent on a pre-0305 Worker, and an action with no
   *  anchor simply carries no deadline. */
  delay_decision_at?: string | null;
  delay_detected_at?: string | null;
  delay_detected_eta?: string | null;
}
export interface operationOrdersListResponse {
  orders: operationOrderListRow[];
  /**
   * Every Sales Order the caller may read in this stage/channel scope,
   * rentals excluded, search NOT applied — counted by the server. `null` when
   * the count could not be read; absent from an older Worker. Never derive it
   * from `orders.length` (the list stops at 500 and a search replaces it).
   * A paged read carries it on its first page only.
   */
  salesOrderTotal?: number | null;
  /**
   * `paged=1` only: the cursor of the next page, `null` on the last page.
   * Absent from an unpaged read and from an older Worker that ignores
   * `paged` — either way there is no next page to ask for.
   */
  nextCursor?: string | null;
}

/** GET /api/operation/orders/:id — composed drawer payload (orders.ts §97). */
export interface operationOrderDetailOrder {
  customer_address_line1?: string | null;
  customer_address_line2?: string | null;
  customer_address_city?: string | null;
  customer_address_postcode?: string | null;
  customer_address_state?: string | null;
  delivery_floor?: number | null;
  delivery_has_lift?: boolean | null;
  id: string;
  so: number;
  /** Customer/source reference(s), e.g. ["DL0584"] — shown next to the SO. */
  source_ref: string[] | null;
  /** 'autocount' for imported orders (already proceeded — never "placed"). */
  source_system?: string | null;
  status: string;
  operation_stage:
    | "placed"
    | "confirmed"
    | "in_production"
    | "ready_to_dispatch"
    | "dispatched"
    | "delivered"
    | null;
  warehouse_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_address_unknown: boolean;
  /** 2026-07-16 — POS-captured extras surfaced to the drawer's customer card.
   *  Emergency = one composed string ("Name · Phone · Relationship"); billing
   *  only meaningful when customer_billing_same is false. Optional so older
   *  detail fixtures keep typechecking. */
  customer_emergency?: string | null;
  customer_billing?: string | null;
  customer_billing_same?: boolean;
  /** 2026-07-19 — POS entry extras bag; the drawer reads
   *  `fields.building_type` (delivery-address building type). Optional so
   *  older detail fixtures keep typechecking. */
  entry_data?: Record<string, unknown> | null;
  /** 0200 — the demographics the Sales Portal asks for. The Sales Order object
   *  page renders and corrects them (owner ruling 2026-08-15); optional so
   *  older detail fixtures keep typechecking. */
  customer_race?: string | null;
  customer_gender?: string | null;
  customer_birthday?: string | null;
  /** 0104 — how many items the salesperson says need carrying up the stairs.
   *  Null = every item (the legacy "auto" meaning). */
  delivery_stair_items?: number | null;
  delivery_date: string | null;
  delivery_date_tbd: boolean;
  /** Phase 11.1 (migration 0165) — salesperson-entered planned production-start
   *  date, pairs with delivery_date. Null on pre-11.1 / AutoCount orders.
   *  Optional so detail fixtures that predate the field keep typechecking. */
  proceed_date?: string | null;
  placed_at: string;
  do_number: string | null;
  /** Embedded on the detail read; voided rows ride along so the UI applies the shared live rule. */
  ops_delivery_orders?: { do_number: string; voided_at?: string | null; issued_at?: string | null }[];
  do_note: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  delivery_partner_id: string | null;
  /** P2 (migration 0136/0159) — planned logistic carrier set in Inbox/drawer
   *  triage (status='place' orders). Distinct from delivery_partner_id (the
   *  formal LP owned by the proceed/dispatch flow). Optional so existing detail
   *  fixtures that predate the field keep typechecking. */
  ops_assigned_logistic?: string | null;
  /** Migration 0156 — multi-leg delivery chain (γ). Null/empty = single-leg
   *  (uses delivery_partner_id). Otherwise an ordered array of stops; each
   *  carries partner_id + partner_name + from_loc + to_loc + per-leg POD
   *  url + status. See `packages/shared/src/schemas/delivery-chain.ts` for
   *  the typed shape. */
  delivery_stops: DeliveryStop[] | null;
  dealer_id: string;
  outlet_id: string | null;
  /** 0098: auto-set by orders_auto_issue_on_dispatched_trg when
   *  operation_stage transitions to 'dispatched'. Surfaces in the drawer
   *  as the Print Invoice button gate. */
  invoice_no: string | null;
  invoiced_at: string | null;
  /** 0105 — surfaced so the drawer can render the Record-top-up modal at
   *  ready_to_dispatch / dispatched stages (operation records the customer's
   *  final balance payment at delivery). */
  paid: number;
  /** 0730 — issued credit notes; `orderMoney` takes them off what is owed. */
  credited?: number | string | null;
  /** Saved at-sale facts; never synthesized into a ledger transaction. */
  payment_method?: string | null;
  installment_months?: number | null;
  approval_code?: string | null;
  payment_slip_url?: string | null;
  dealers: { name: string } | null;
  outlets: { name: string } | null;
  /** STAGE 1 — who sold it. The Sales Order workspace names the salesperson on
   *  the customer commitment. Optional so existing detail fixtures keep
   *  typechecking. */
  salesperson_id?: string | null;
  salespersons?: { name: string } | null;
}
export interface operationOrderDetailLine {
  /** STAGE 2 — the row's identity, so Save can diff lines in place. Optional:
   *  absent on an older Worker. */
  id?: string;
  sku: string;
  qty: number;
  unit_price: number;
  /** 2026-07-16 — server-resolved readable product name ("Model · Variant")
   *  from product_skus/product_models; null when the sku isn't in the catalog
   *  (e.g. AutoCount free-text skus). Optional for older fixtures. */
  label?: string | null;
  // 2026-05-10 (Loo) — cascade picker payload threaded into the "+ Issue POs"
  // → CreatePOModal navigation so bedframe color/gap and sofa fabric stay
  // attached to the new PO line. Null for mattress lines (no extras) and
  // pre-cascade legacy data.
  attrs?: Record<string, unknown> | null;
  /** AutoCount PO number carried on the imported line (order_lines.source_po).
   *  Present ⇒ the order already has a PO — do NOT show "No PO" for it. */
  source_po?: string | null;
  /** D9 (2026-08-20) — the CATALOG's category for this line's SKU, resolved
   *  server-side by the same reader the free units use, because the loan filter
   *  compares one against the other and a guess on EITHER side hides a real
   *  unit. `null` = asked, no catalog row. ABSENT = older Worker. */
  category?: string | null;
}
export interface operationOrderDetailAddon {
  /** The row’s own id — what `POST /orders/:id/addons/:addonId/edit` needs. */
  id: string;
  addon_key: string;
  qty: number;
  unit_price: number;
  /** 0242 — the per-unit size picks for a sized service (dispose-mattress,
   *  dispose-bedframe …). `null` for a service that has no size list. */
  attrs: { sizes?: string[]; size?: string } | null;
}
export interface operationOrderDetailHistoryRow {
  text: string;
  by_role: string | null;
  occurred_at: string;
  /** The audit identity the event recorded (0387 stamps it on new writes).
   *  Optional: an older Worker does not send it. */
  by_user_id?: string | null;
  /** The resolved real staff/salesperson name — resolved SERVER-SIDE from the
   *  authoritative identity tables, never in the browser. */
  actor?: string | null;
  /** The server's truthful classification of who acted. `system` only when the
   *  event's own facts prove automation; the browser never infers it from a
   *  null id. Optional: an older Worker does not send it. */
  actor_kind?: "human" | "system" | "missing";
  /** The governed role word of the account that acted — kept beside
   *  `Staff identity not recorded` when the account is a shared login. */
  actor_role?: string | null;
  /** The structured half of the event — reason/note/changed/revision. */
  metadata?: unknown;
}
export interface operationOrderDetailWarehouse {
  id: string;
  name: string;
  address: string | null;
}
export interface operationOrderDetailStockBalance {
  sku: string;
  warehouse_id: string;
  /** 0366 — physically at this Site, from the unit register. NOT what may be
   *  promised: a unit in repair counts here and can be offered to nobody. */
  qty: number;
  reserved: number;
  /** 0366 — THE number that answers whether these goods can be promised.
   *  Never compute it as `qty - reserved`. */
  available: number;
}
export interface operationOrderDetailPoLine {
  id: string;
  po_id: string;
  sku: string;
  qty: number;
  received_qty: number;
}
/** A free per-unit stock item at the order's warehouse (Jess 2026-06-30). The
 *  drawer matches these to each line by normalizeSkuKey (the catalog is empty,
 *  so order_lines.sku ↔ ops_stock_items.sku only match after normalisation) and
 *  lets the operator reserve the chosen unit(s) to the order's SO. */
export interface operationOrderDetailFreeUnit {
  id: string;
  unitCode: string | null;
  sku: string;
  warehouseId: string;
  condition: "new" | "exhibition" | "old" | "refurbished" | "damaged";
  poNo: string | null;
  sourceRef: string | null;
  dateIn: string | null;
  /** D9 (2026-08-20) — the CATALOG's category, resolved server-side. `null` =
   *  asked, no catalog row. ABSENT = an older Worker that does not send it, so
   *  it is optional for the same reason `label` above is. */
  category?: string | null;
}
export interface operationOrderDetailPo {
  id: string;
  supplier_id: string;
  warehouse_id: string;
  status: string;
  sup_status: string;
  so: number | null;
  so_refs: number[] | null;
  eta_date: string | null;
  /** The day the PO was ISSUED (`purchase_orders.placed_at`). The Order Route
   *  prints it as `Issued:` — a `✓` may never show a bare date. Optional so a
   *  browser on this build against an older Worker degrades to the number
   *  alone rather than crashing. */
  placed_at?: string | null;
  /** What the SUPPLIER confirmed (`expected_ready_date`), printed as
   *  `Estimated ready:`. Null means nobody has confirmed it — the Route says
   *  so rather than guessing from the arrival estimate. */
  expected_ready_date?: string | null;
  /** J1 — the supplier's signed DO object in the `delivery-orders` bucket
   *  (column since 0030). Optional: a browser on this build talking to a
   *  pre-J1 Worker simply sees no supplier-DO row instead of crashing. */
  do_file_path?: string | null;
  lines: operationOrderDetailPoLine[];
}
export interface operationOrderDetailResponse {
  order: operationOrderDetailOrder;
  lines: operationOrderDetailLine[];
  addons: operationOrderDetailAddon[];
  total: number;
  warehouse: operationOrderDetailWarehouse | null;
  stockBalances: operationOrderDetailStockBalance[];
  freeUnits: operationOrderDetailFreeUnit[];
  pos: operationOrderDetailPo[];
  history: operationOrderDetailHistoryRow[];
  /** Phase 4.5 Chunk 2 (T9) — per-supplier thread rows carrying customer-leg
   *  LP state. Drawer reads `threads[].delivery_partner_id` to compute partner
   *  assignment instead of order-level `delivery_partner_id`, since per design
   *  spec §CQ1 option (b) the customer-leg LP lives on the thread now. */
  threads: operationOrderThreadRow[];
  /** 2026-08-16 (ORDER ROUTE NODE MAP) — the read-only overlay facts the map
   *  needs. Deliberately NOT folded into `order`: the workspace EDIT form
   *  seeds its draft from that object. `null` = no overlay row (UNKNOWN). */
  control?: {
    delivery_photos?: DeliveryLedgerEntry[] | null;
    assigned_staff?: string | null;
  } | null;
  /** The SO PIC (`ops_order_control.assigned_staff`, named from People).
   *  `picRead: "failed"` = not read; `name: null` = this caller may not see
   *  the person. Absent on an older Worker = not read. */
  pic?: { userId: string; name: string | null } | null;
  picRead?: "ok" | "failed";
}

/** Row in GET /api/operation/pos. `purchase_order_lines(...)` is the embedded
 *  PostgREST nested resource. */
export interface operationPoListRow {
  contextual_cancellation_available?:boolean;
  id: string;
  supplier_id: string;
  warehouse_id: string;
  /** The PO's own destination (0307). A line with none follows it. */
  destination_id?: string | null;
  status: "open" | "received" | "cancelled";
  sup_status: string;
  so: number | null;
  so_refs: number[] | null;
  eta_date: string | null;
  official_delivery_date?: string | null;
  /** 0530 — payment terms in days after the bill date. Null = not set. */
  terms_days?: number | null;
  /** `Supplier Ready Date` (§12.2 ①) — the day the FACTORY says it has finished
   *  making the goods, written only by `purchasing_record_ready_date` (0318)
   *  after a supplier answered. It is NOT `eta_date`, which is our own
   *  prediction of arrival: R5 grades a supplier on this one, so the engine may
   *  never seed it. OPTIONAL — a browser on this build against an older Worker
   *  degrades to "no ready date yet", which is also the state that raises
   *  `Confirm ready date`. */
  expected_ready_date?: string | null;
  /** 0361 — the reason this PO was born: `customer_sales` (the customer lane's
   *  auto-stamp) or a typed demand purpose. The panel prints it as `Need for`.
   *  OPTIONAL — an older Worker omits it, and pre-0361 POs are NULL (never
   *  backfilled); both degrade to printing nothing. */
  purpose?: string | null;
  /** 0364 — which version of the document the factory holds; 1 at issue, a
   *  revise mints the next. The panel prints `PO-2041 · Version 2` from > 1.
   *  OPTIONAL — an older Worker omits it and the PO reads as Version 1. */
  version?: number;
  /** 0364 — when the CURRENT version was minted; NULL = never revised. The
   *  governed sentence `{po} Version {n} has not reached {supplier}` is
   *  DERIVED from this against the latest send — never stored. */
  revised_at?: string | null;
  placed_at: string;
  cancellation_version?:number|null;
  cancellation_event_id?:string|null;
  purchase_order_lines: {
    // 0076 (Loo 2026-05-10): line UUID — primary key after migration. Used
    // by ReceivePOModal as the recv-state key (replacing sku) so multi-
    // variant lines (same SKU different colors/fabrics) don't collide. Also
    // the lookup key for operation_receive_po_with_do.
    id: string;
    sku: string;
    qty: number;
    received_qty: number;
    cancelled_qty?:number;
    pending_qty?:number;
    /** 0442 — the Catalog stock identity mode SNAPSHOTTED at issue.
     *  `exact_unit`: the line owns one permanent Unit ID per piece;
     *  `quantity`: counted goods, no Unit IDs (the column prints `—`). */
    identity_mode?: "exact_unit" | "quantity" | null;
    /** R1 (0284) — what arrived broken / as the wrong item, cumulative across
     *  every DO on this line. Neither counts as received: the supplier still
     *  owes a good unit, so the qty stays PENDING DELIVERY (never "missing").
     *  Optional because only the endpoints that select them return them — an
     *  absent value reads as "no problem recorded", not as unknown. */
    damaged_qty?: number;
    wrong_item_qty?: number;
    /** P3 (0306) — the day this line last took a SHORT delivery, stamped
     *  server-side. It is the balance call's Due anchor. OPTIONAL, so a browser
     *  on this build against an older Worker degrades to "no anchor" (the call
     *  shows with no deadline) rather than crashing. */
    short_since?: string | null;
    /** P3 — the received quantity the latest balance answer was made ABOUT.
     *  A second short delivery changes `received_qty`, the two stop matching,
     *  and the call re-opens by itself (S4 / C8's discipline). */
    balance_answer_about_qty?: number | null;
    /** Register (Jess, 2026-08-02) — the listing speaks MODEL, never the raw
     *  SKU code, and the name is resolved SERVER-side where every SKU can be
     *  looked up (the browser's POS catalog misses non-active SKUs and used
     *  to print the code). OPTIONAL: an older Worker degrades to the code. */
    model_name?: string | null;
    size?: string | null;
    /** Catalog category through the shared SKU reader; null means unresolved. */
    category?: string | null;
    /** Where THIS line goes (0311) — null = wherever the PO goes. */
    destination_id?: string | null;
    /** Purchasing's own internal note; never printed on the PO. */
    ops_remark?: string | null;
    /** Manual Purchase lineage: demand → request header. */
    demand_id?: string | null;
    /** 0382 governed customer-order allocation for this exact PO line. */
    sources?: {
      po_id: string;
      po_line_id: string;
      order_id: string;
      order_line_id: string | null;
      so: number | null;
      qty: number;
    }[];
    /** Exact governed lineage for this line, including Manual Purchase.
     *  Card 08 §3.5: a Manual Purchase source's visible reference is the
     *  label `Manual Purchase`; its identity is the invisible request UUID
     *  plus the business facts beside it — never an MPR number. */
    governed_sources?: Array<{
      kind: "sales_order" | "manual_purchase";
      reference: string;
      /** Null preserves a legacy source link whose exact allocation is unknown. */
      qty: number | null;
      /** Manual Purchase only — the source request's invisible identity. */
      request_id?: string | null;
      /** Manual Purchase only — business facts that distinguish sources. */
      purpose?: string | null;
      proceed_date?: string | null;
    }>;
    /** Register (Jess, 2026-08-02) — the EXCEL rows this PO line becomes:
     *  one entry per SO × SKU, each carrying the SALESPERSON's remark from
     *  the sales order. Derived server-side; a quantity no SO claims comes
     *  back with `so: null`. OPTIONAL — an older Worker degrades to one row
     *  per line. */
    so_rows?: { so: number | null; qty: number; remark: string | null }[];
    // 0073 cascade picker (Loo 2026-05-09). Null for mattress + legacy
    // pre-0073 lines; bedframe carries {color, gap}; sofa carries
    // {fabric_id, fabric_name, fabric_surcharge}.
    attrs?: Record<string, unknown> | null;
  }[];
  /** P3 (0306) — the expected arrival the latest tomorrow's-delivery answer was
   *  made ABOUT. The factory moving the date again makes the old answer an
   *  answer about nothing, and the call re-opens. OPTIONAL for the same
   *  degrade-don't-crash reason as `short_since`. */
  tomorrow_answer_about_date?: string | null;
  /** Register (2026-08-02) — the EARLIEST promised customer delivery across
   *  every SO this PO covers; null for stockpile POs. OPTIONAL so a browser
   *  on this build against an older Worker degrades instead of crashing. */
  customer_delivery?: string | null;
  /** Register (Jess, 2026-08-02) — the arriving date has been answered about
   *  MORE THAN ONE expected arrival (promise-ledger history, 0306), so the
   *  listing marks it `(revised)`. OPTIONAL — older Worker degrades to false. */
  eta_revised?: boolean;
  /** What LEFT Carres for this supplier (0312), newest first — and since 0377,
   *  WHAT KIND of leaving it was. `external_open` is communication history and
   *  completes nothing; `confirmed_sent` is the operator's statement that the
   *  PDF actually reached the supplier, with the exact version it was.
   *  The three newer fields are OPTIONAL so a browser on this build against an
   *  older Worker degrades instead of crashing. */
  sends?: {
    channel: string;
    note: string | null;
    sent_at: string;
    kind?: "external_open" | "confirmed_sent" | null;
    recipient?: string | null;
    po_version?: number | null;
    sent_by?: string | null;
    sent_by_name?: string | null;
    duty_name?: string | null;
    acting_name?: string | null;
    po_revisions: { rev_no: number } | null;
  }[];
  /** 0587 — the Supplier DO the supplier sent for this PO, recorded once
   *  through `Record supplier answer`; Receiving reads the same fields. */
  do_number?: string | null;
  do_file_path?: string | null;
  do_uploaded_at?: string | null;
  /** 0585 · the day-before check's evidence, per version and expected date. */
  arrival_confirmations?: {
    po_version: number;
    for_date: string;
    destination_id: string;
    kind: "supplier_do" | "supplier_confirmation";
    supplier_do_no?: string | null;
  }[];
  /** The supplier-date field's own history (0306 ledger, newest first) —
   *  it renders BESIDE the field, never in the Activity timeline. */
  promises?: {
    id?: string | null;
    /** 0587 — a line-level answer names its goods line and batch quantity;
     *  the rows of one recorded answer share `answer_group`. */
    po_line_id?: string | null;
    about_qty?: number | null;
    answer_group?: string | null;
    po_version?: number | null;
    channel?: string | null;
    recipient?: string | null;
    evidence?: string | null;
    reported_by?: string | null;
    reported_at?: string | null;
    recorded_by?: string | null;
    recorded_by_name?: string | null;
    duty_name?: string | null;
    acting_name?: string | null;
    kind: string;
    answer: string;
    about_date: string | null;
    previous_date: string | null;
    new_date: string | null;
    reason: string | null;
    /** The free-text story beside the countable `reason` (0310). */
    remarks?: string | null;
    recorded_at: string;
  }[];
  /** 2026-05-18 (Loo C+D) — per-source-SO enrichment. One entry per SO this
   *  PO serves (po.so for single, po.so_refs[] for bundle). Empty for
   *  stockpile POs. Since 2026-08-02 the global /api/operation/pos fills it
   *  too (the Register's search answers the CUSTOMER's name); older Workers
   *  omit it — treat as []. */
  orders?: {
    so: number;
    customer_name: string;
    delivery_date: string | null;
  }[];
  /** 2026-05-18 (Loo C+D) — worst-case urgency across source SOs. NULL when
   *  the PO has no source SOs (stockpile) or all delivery_date are NULL. */
  urgency?: "critical" | "urgent" | "normal" | null;
  /** Governed document sources, never inferred from display-only SO mirrors.
   *  Card 08 §3.5: Manual Purchase sources carry the label `Manual Purchase`
   *  as `reference`, stay distinct by `request_id` (never collapsed because
   *  the label matches), and bring the business facts that tell them apart. */
  sources?: Array<{
    kind: "sales_order" | "manual_purchase";
    /** The visible document number: `SO-1319`, or the request's own
     *  `MPR-YYYYMMDD-RRRR` (owner ruling 2026-09-18, which overwrites the
     *  2026-09-04 MPR retirement). A request with no stored number keeps the
     *  governed label `Manual Purchase` — never a UUID, never an invention. */
    reference: string;
    /** A sales_order source's order id, so one SO number opens its order. */
    order_id?: string | null;
    /** Manual Purchase only — the stored MPR number, null where there is none. */
    req_no?: string | null;
    request_id?: string | null;
    purpose?: string | null;
    proceed_date?: string | null;
  }>;
  /** Posted receipts of this PO (`warehouse_receipts` with a GRN number),
   *  oldest first. Absent on an older Worker — treat as unknown, not none.
   *  `goods_received_at` is the PHYSICAL arrival day (0314), never the day the
   *  record was filed and never a substitute for either delivery-date column;
   *  `received_qty` is the shared `warehouseReceiptTotals` count of GOOD units
   *  on that receipt. Both OPTIONAL so a browser on this build against an
   *  older Worker prints the governed absence instead of crashing. */
  grns?: Array<{
    id: string;
    grn_no: string;
    goods_received_at?: string | null;
    received_qty?: number | null;
  }>;
}
export interface operationPosListResponse {
  pos: operationPoListRow[];
  /** The active destination registry (0307) — the per-line picker's options. */
  destinations?: { id: string; name: string; is_default: boolean }[];
  /** Every destination referenced by these POs, including closed history. */
  referencedDestinations?: { id: string; name: string; is_default: boolean }[];
  /** ONE company-wide supplier-message draft (0312). */
  messageTemplate?: string | null;
}





/** Mutation responses — RPCs return the mutated row; routes wrap in `{ x: data }`. */
export interface operationOrderMutationResponse {
  order: unknown;
}
export interface operationRecheckStockResponse {
  warehouseId: string | null;
  shortages: { sku: string; short: number }[];
}
export interface operationReceivePoWithDoResponse {
  po_id: string;
  do_file_path: string;
  do_number: string;
  lines_updated: number;
  threads_advanced: number;
  po_status: "open" | "received" | "cancelled";
  sup_status: string;
  was_relocated: boolean;
  // R1 (0284) / R2 (0288) — what the inspection found, and how many supplier
  // claims it opened. OPTIONAL so a browser on this build talking to a
  // pre-0288 Worker degrades instead of crashing.
  damaged_qty?: number;
  wrong_item_qty?: number;
  claims_created?: number;
}

// --- Filter → query string helpers -----------------------------------------

function operationOrdersSearch(f?: operationOrderFilters): string {
  if (!f) return "";
  const params = new URLSearchParams();
  if (f.stage && f.stage !== "all") params.set("stage", f.stage);
  if (f.channel && f.channel !== "all") params.set("channel", f.channel);
  if (f.search) params.set("search", f.search);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}




/** Loo 2026-05-10 — sidebar badge counts. Polled every 30s so the operator
 *  sees the chip update without leaving the page. Mounted from
 *  OperationSidebar; staleTime matches refetchInterval so the cache stays
 *  warm across nav transitions. */
export function useOperationBadges(
  opts?: Partial<UseQueryOptions<import("@carres/shared").OperationBadgesResponse>>,
) {
  return useQuery({
    queryKey: qk.operation.badges(),
    queryFn: () =>
      apiFetch<import("@carres/shared").OperationBadgesResponse>(
        "/api/operation/badges",
      ),
    staleTime: 30_000,
    refetchInterval: 30_000,
    ...opts,
  });
}

/**
 * Mark a operation nav badge as seen — Loo 2026-05-11 unread semantics.
 *
 * Optimistically zeros the count for the given key in the badges cache so
 * the UI reacts instantly (~16 ms instead of waiting for the next 30s
 * poll). On settle, invalidates the badges query so the actual server
 * count (could be >0 if new items advanced between click and ack)
 * reconciles.
 *
 * Pairs with POST /api/operation/badges/seen which calls the
 * mark_badge_seen RPC (migration 0083).
 */
// 0152 (Loo 2026-05-31) — `lp_rejected` added. Its response field is camelCase
// `lpRejected` (the others match their short key), so the optimistic-zero needs
// a short→field map below.
type operationBadgeKey =
  | "operation:orders"
  | "operation:procurement"
  | "operation:lp_rejected";
type operationBadgeKeyShort = "orders" | "procurement" | "lp_rejected";
const BADGE_FIELD: Record<operationBadgeKeyShort, keyof import("@carres/shared").OperationBadgesResponse> = {
  orders: "orders",
  procurement: "procurement",
  lp_rejected: "lpRejected",
};

export function useMarkOperationBadgeSeen() {
  const qc = useQueryClient();
  return useMutation<
    { badgeKey: operationBadgeKey; lastSeenAt: string },
    ApiError,
    operationBadgeKeyShort,
    { prev: import("@carres/shared").OperationBadgesResponse | undefined }
  >({
    mutationFn: (short) =>
      apiFetch("/api/operation/badges/seen", {
        method: "POST",
        body: JSON.stringify({ badgeKey: `operation:${short}` }),
      }),
    onMutate: async (short) => {
      await qc.cancelQueries({ queryKey: qk.operation.badges() });
      const prev = qc.getQueryData<import("@carres/shared").OperationBadgesResponse>(
        qk.operation.badges(),
      );
      if (prev) {
        qc.setQueryData<import("@carres/shared").OperationBadgesResponse>(
          qk.operation.badges(),
          { ...prev, [BADGE_FIELD[short]]: 0 },
        );
      }
      return { prev };
    },
    onError: (_err, _short, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.operation.badges(), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.operation.badges() });
    },
  });
}

/** Delivery partners — populates the DispatchModal dropdown (M5 task 2 §18.3).
 *  Stable list, rarely changes; cache for 5 minutes. */
export function useDeliveryPartners(
  opts?: Partial<UseQueryOptions<DeliveryPartnersListResponse>>,
) {
  return useQuery({
    queryKey: qk.operation.partners(),
    queryFn: () =>
      apiFetch<DeliveryPartnersListResponse>("/api/operation/partners"),
    staleTime: 5 * 60_000,
    ...opts,
  });
}




















// ── R6 · the warehouse portal ───────────────────────────────────────────────
//
// Three reads and one write, all of them RPCs the database gates on
// `app_role() = 'warehouse'`. Nothing here is scoped client-side: the warehouse
// id rides the caller's own account, never a parameter this code could get
// wrong.

/** Open POs bound for this warehouse, with R1's four numbers per line. */
export function useWarehouseIncoming(
  opts?: Partial<UseQueryOptions<WarehouseIncomingResponse>>,
) {
  return useQuery({
    queryKey: qk.warehousePortal.incoming(),
    queryFn: () =>
      apiFetch<WarehouseIncomingResponse>("/api/warehouse/incoming"),
    staleTime: 30_000,
    ...opts,
  });
}

/** What this warehouse filed, and what became of it — including the claims each
 *  check-in opened. */
export function useWarehouseMyReceipts(
  opts?: Partial<UseQueryOptions<{ receipts: WarehouseReceiptRow[] }>>,
) {
  return useQuery({
    queryKey: qk.warehousePortal.receipts(),
    queryFn: () =>
      apiFetch<{ receipts: WarehouseReceiptRow[] }>("/api/warehouse/receipts"),
    staleTime: 30_000,
    ...opts,
  });
}

/** File a count. Goods do NOT move — ops's check-in replays it through the
 *  receive engine, which is why both warehouse lists are refreshed and no
 *  stock cache is touched here. */
export function useWarehouseSubmitReceiptMutation(
  opts?: Partial<
    UseMutationOptions<
      { id: string; po_id: string; status: string },
      ApiError,
      WarehouseSubmitReceiptInput
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    { id: string; po_id: string; status: string },
    ApiError,
    WarehouseSubmitReceiptInput
  >({
    mutationFn: (body) =>
      apiFetch<{ id: string; po_id: string; status: string }>(
        "/api/warehouse/receipts",
        { method: "POST", body: JSON.stringify(body) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["warehouse-portal"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** The ops queue row: one filed count, with the names a human needs and the
 *  one sentence the shared module composes. */
export interface WarehouseReceiptQueueRow {
  arrival_source_id?: string | null;
  id: string;
  po_id: string | null;
  source_no?: string | null;
  source_party_name?: string | null;
  warehouse_id: string;
  warehouse_name: string | null;
  supplier_name: string | null;
  do_number: string;
  do_file_path: string;
  note: string | null;
  lines: WarehouseReceiptLine[];
  status: string;
  submitted_by_name: string | null;
  submitted_at: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  return_reason: string | null;
  /** "4 good · 1 damaged" — composed by the shared module, never typed. */
  summary: string;
  /** True when checking this in will file supplier claims. Said BEFORE the
   *  button is pressed. */
  opens_claims: boolean;
  /** 0426 — the Receiving Register's own facts. */
  grn_no?: string | null;
  goods_received_at?: string;
  submitted_from?: "office" | "warehouse";
  posted_at?: string | null;
  posted_by_name?: string | null;
  actual_site_id?: string | null;
  actual_site_name?: string | null;
  posted_duty_holder_name?: string | null;
  posted_duty_cover_name?: string | null;
  posted_authority?: "grn_duty" | "cover" | "superuser" | "operation_staff" | null;
  /** 0601 — Goods Received Date as a time point; null on an older record
   *  (`Time not recorded`, never back-filled). */
  goods_received_time?: string | null;
  /** 0601 — `Received by {company or staff name}` (see `receivedByWords`). */
  received_by_kind?: "company" | "staff" | null;
  received_by_name?: string | null;
  /** 0601 — the version an amendment starts from (first save wins). */
  revision?: number;
  arrival_evidence?: Array<{ path: string; kind: "photo" | "video" }>;
  /** 0440-era detail read: the same files, each with a signed VIEW url. */
  arrival_evidence_files?: Array<{
    path: string;
    kind: "photo" | "video";
    url: string | null;
  }>;
  extra_lines?: Array<{ sku: string; qty: number; note?: string | null }>;
  void_at?: string | null;
  void_by_name?: string | null;
  void_reason?: string | null;
  do_file_url?: string | null;
  /** The governed category words this receiving answers to (owner correction
   *  2026-09-06) — computed server-side through the ONE shared ladder from
   *  the catalog's answer; the rail only counts them. */
  categories?: string[];
  /** The linked PO's governed `Supplier Delivery Date` (ISO) — the ONE reply
   *  arithmetic (`poSupplierDeliveryDateOf`), resolved server-side. */
  supplier_delivery_date?: string | null;
  /** The `Items` cell's words — the GRN paper's own line description
   *  (`product_skus.variant`, else the SKU), distinct, server-resolved. */
  product_labels?: string[];
  /** `GRN Date` — when `Save Receiving` CREATED this document. It is never
   *  inferred from `Goods Received Date`, which is the physical arrival. */
  grn_date?: string | null;
  /** The receipt's ACTUAL linked documents — `SO No / MPR No / CO No / RO No`
   *  (owner ruling 2026-09-18). Empty when it genuinely has none; no word and
   *  no other document ever stands in for a missing number. */
  source_refs?: string[];
  /** `po_line_id` → the Unit IDs THIS receiving answered for that line. A
   *  quantity-managed line has no entry (its register row carries a technical
   *  key, which is not an identity); `null` means the read FAILED and the
   *  cell must say so rather than claim counted stock. */
  unit_ids_by_line?: Record<string, string[]> | null;
}

/** GET /api/operation/warehouse-receipts/duty — the resolved GRN authority
 *  (0425). The page CONSUMES the shared resolver's answer; it never reads a
 *  rota or computes an offset (ERP-ARCHITECTURE Law F.1). */
export interface ReceivingDutyContext {
  duty_key: string;
  normal_user_id: string | null;
  normal_user_name: string | null;
  acting_user_id: string | null;
  acting_user_name: string | null;
  actor_user_id: string | null;
  is_cover: boolean;
  /** The cover row the resolver is acting through today (0425), when any. */
  cover_id?: string | null;
  is_superuser: boolean;
  /** 0601 — may POST or check in a receipt: every active Operation staff
   *  member and the principal (owner ruling 2026-09-25). */
  allowed: boolean;
  /** 0601 — may AMEND or VOID a GRN: GRN Duty, its dated cover or an
   *  Operations Superuser (unchanged 0425 authority). Absent before 0601,
   *  when `allowed` still meant exactly this. */
  may_amend?: boolean;
  source: "assignment" | "not_assigned" | "system_assignment";
  assignment_outcome?: "active" | "reassigned" | "not_assigned" | "no_candidate";
}

/** `Workspace → Staff & Duties` (0425) — the duty catalogue, each with its
 *  resolution today, its assignment history and covers. `can_assign` is the
 *  SAME gate the write doors raise, as a fact. */
export interface WorkspaceDutyAssignment {
  id: string;
  duty_key: string;
  holder_id: string;
  holder_name: string | null;
  effective_from: string;
  effective_until: string | null;
  assigned_by_name: string | null;
  note: string | null;
  created_at: string;
  /** 0671: `monthly_rotation` rows were written by the PO/GRN monthly rota. */
  origin?: "manual" | "monthly_rotation";
}
export interface WorkspaceDutyCover {
  id: string;
  duty_key: string;
  normal_user_id: string;
  normal_user_name: string | null;
  acting_user_id: string;
  acting_user_name: string | null;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  assigned_by_name: string | null;
  created_at: string;
}
export interface WorkspaceDutiesResponse {
  can_assign: boolean;
  duties: Array<{
    key: string;
    label: string;
    resolution: ReceivingDutyContext & {
      normal_user_name: string | null;
      acting_user_name: string | null;
    };
    assignments: WorkspaceDutyAssignment[];
    covers: WorkspaceDutyCover[];
    /** The next cover the resolver will act through on its first day (S2-A). */
    scheduled_cover_id?: string | null;
    next_assignment_id?: string | null;
  }>;
}


export function useWorkspaceDuties(
  opts?: Partial<UseQueryOptions<WorkspaceDutiesResponse>>,
) {
  return useQuery({
    queryKey: ["operation", "workspace-duties"],
    queryFn: () =>
      apiFetch<WorkspaceDutiesResponse>("/api/operation/workspace-duties"),
    staleTime: 30_000,
    refetchInterval: 30_000,
    ...opts,
  });
}

/** Workspace Work — the one server-composed open set used by My Work,
 * Team Work, and Quick Rail. No module trigger is recomputed in the browser. */
export function useOperationWork(
  opts?: Partial<UseQueryOptions<OperationWorkResponse>>,
) {
  return useQuery({
    queryKey: qk.operation.work(),
    queryFn: async () => operationWorkResponseSchema.parse(
      /* `include`: this build knows the `workspace` module (internal tasks). */
      await apiFetch<unknown>(`/api/operation/work?include=${OPERATION_WORK_INCLUDE_WORKSPACE}`),
    ),
    staleTime: 30_000,
    refetchInterval: 30_000,
    ...opts,
  });
}













/** The paged GRN Register's ask and answer (owner correction 2026-09-06). */
export interface GrnRegisterFilters {
  view?: "records" | "differences";
  offset: number;
  limit?: number;
  /** Shared grid column filters and sort, encoded for the authorised reader. */
  columns?: string;
  category: string | null;
  supplier: string | null;
  site: string | null;
  /** The rail's `Received with` row (owner ruling 2026-09-17). */
  receivedWith: GrnReceivedWith | null;
  /** The `GRN date` pick as one INCLUSIVE range — a day, a week, a month and
   *  `Choose dates…` all arrive here as the same two facts. */
  from: string | null;
  to: string | null;
  /** `Cancelled GRNs` — the rail's last row. */
  cancelled: boolean;
  /** `Consignment goods` — receipts of Consignment Orders only (Weisiang 2026-10-22). */
  consignment?: boolean;
  q: string;
}
export interface GrnRegisterResponse {
  column_values?: Record<string, string[]>;
  receipts: WarehouseReceiptQueueRow[];
  page: { offset: number; limit: number; total: number };
  facets: {
    category: Record<string, number>;
    supplier: Record<string, number>;
    site: Record<string, number>;
    /** GRN creation days, ISO → count; the rail folds them into weeks and
     *  months, so a week's number is the whole filtered set's truth. */
    grnDate: Record<string, number>;
    /** OVERLAPPING by construction — never added into a total. */
    receivedWith: Record<GrnReceivedWith, number>;
    cancelled: number;
    /** Receipts of Consignment Orders in this view (Weisiang 2026-10-22). */
    consignment?: number;
  };
  /** The expansion's item words and governed categories, per SKU on this
   *  page — the same two facts the official GRN document prints. */
  line_info?: Record<string, { description: string | null; category: string }>;
  counts: { waiting: number };
}




/**
 * `Jump to…` document lookup — GET /api/operation/jump?q=
 * (ui/MASTER `JUMP TO… INTERACTION`, APPROVED / LOCKED 2026-08-11).
 *
 * Governed document numbers only (SO · PO · GRN · INV), permission-filtered by
 * the database before the browser ever sees a row. Destinations are NOT here:
 * they are resolved locally from the portal nav, so an empty box costs nothing
 * and typing a destination name never leaves the tab.
 *
 * Disabled while the box is empty. `keepPreviousData` holds the last list in
 * place between keystrokes so the surface does not blink to `No results` and
 * back on every character.
 */
export function useJumpSearch(
  q: string,
  opts?: Partial<UseQueryOptions<JumpSearchResponse>>,
) {
  return useQuery({
    queryKey: qk.operation.jump(q),
    queryFn: () =>
      apiFetch<JumpSearchResponse>(`/api/operation/jump?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    ...opts,
  });
}

export function useOperationSuppliers(
  opts?: Partial<UseQueryOptions<SuppliersListResponse>>,
) {
  return useQuery({
    queryKey: qk.operation.suppliers(),
    queryFn: () =>
      apiFetch<SuppliersListResponse>("/api/operation/suppliers"),
    staleTime: 5 * 60_000,
    ...opts,
  });
}

/**
 * ⭐ useCreateSupplier — POST /api/operation/suppliers (2026-08-24).
 *
 * The portal's FIRST supplier-creation door. Before this, a new factory was an
 * engineering task: someone opened the SQL editor. Principal-only, which is not
 * a new rule — `suppliers_principal_write` (0002) has always said so; there was
 * simply nothing to call.
 *
 * Invalidates the suppliers list so the picker that opened this shows the new
 * name without a reload — the whole point is that the keyer never leaves the
 * SKU they were in the middle of writing.
 */
export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierCreateInput) =>
      apiFetch<{ supplier: SupplierRow }>(
        "/api/operation/suppliers",
        catalogJson("POST", input),
      ),
    onSuccess: ({ supplier }) => {
      /* ⭐ PUT IT IN THE LIST BEFORE THE REFETCH LANDS. The caller selects the
         new supplier the instant it exists, and a <select> whose value matches
         no option renders BLANK — so an invalidate alone would flash "nothing
         selected" over a supplier that was created successfully. Seeding the
         cache makes the option exist in the same paint as the selection.
         Sorted by name because the list route orders that way; the invalidate
         still runs, so the server's answer remains the one that survives. */
      qc.setQueryData<SuppliersListResponse>(qk.operation.suppliers(), (prev) =>
        prev
          ? {
              suppliers: [...prev.suppliers, supplier].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            }
          : { suppliers: [supplier] },
      );
      qc.invalidateQueries({ queryKey: qk.operation.suppliers() });
    },
  });
}

/** 0388 — dual-sourcing's recording half. The SKU's supplier SLOT stays the
 *  routing truth; these record what each supplier QUOTED for the piece. */
export interface SkuSupplierOfferRow {
  supplierId: string;
  supplierName: string | null;
  supplierCode: string | null;
  price: number | null;
  pwpPrice: number | null;
  /** 0389 — the supplier's quote per sofa seat height ({size → RM}, the 0204
   *  shape). Null = not quoted by height. */
  pricesBySize: Record<string, number> | null;
  updatedAt: string;
}

export function useSkuSupplierOffers(skuId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["sku-supplier-offers", skuId],
    queryFn: () =>
      apiFetch<{ offers: SkuSupplierOfferRow[] }>(
        `/api/catalog/skus/${encodeURIComponent(skuId)}/supplier-offers`,
      ),
    /* Fetched ONLY while the row's offers strip is open — a register of 500
       SKUs must not make 500 of these on load. */
    enabled,
    staleTime: 30_000,
  });
}


export function useUpsertSkuSupplierOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skuId, ...input }: {
      skuId: string;
      supplierId: string;
      supplierCode?: string | null;
      price?: number | null;
      pwpPrice?: number | null;
      /* Absent = leave the stored map alone (and keep the payload free of a
         column an un-migrated database would refuse — the 0375 lesson). */
      pricesBySize?: Record<string, number> | null;
    }) =>
      apiFetch<{ offer: SkuSupplierOfferRow }>(
        `/api/catalog/skus/${encodeURIComponent(skuId)}/supplier-offers`,
        catalogJson("PUT", input),
      ),
    onSuccess: () =>
      /* The prefix, so BOTH the per-SKU strip and the all-offers list (the
         Supplier Items join) refresh from one write. */
      qc.invalidateQueries({ queryKey: ["sku-supplier-offers"] }),
  });
}

export function useDeleteSkuSupplierOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skuId, supplierId }: { skuId: string; supplierId: string }) =>
      apiFetch<{ ok: true }>(
        `/api/catalog/skus/${encodeURIComponent(skuId)}/supplier-offers/${encodeURIComponent(supplierId)}`,
        catalogJson("DELETE"),
      ),
    onSuccess: () =>
      /* The prefix, so BOTH the per-SKU strip and the all-offers list (the
         Supplier Items join) refresh from one write. */
      qc.invalidateQueries({ queryKey: ["sku-supplier-offers"] }),
  });
}























export function usePurchasingSettings(
  opts?: Partial<UseQueryOptions<PurchasingSettingsResponse>>,
) {
  return useQuery({
    queryKey: qk.operation.purchasingSettings(),
    queryFn: () =>
      apiFetch<PurchasingSettingsResponse>("/api/operation/purchasing/settings"),
    // Settings change a few times a year; re-reading them every minute would
    // be noise. They are invalidated on write.
    staleTime: 5 * 60_000,
    ...opts,
  });
}

/**
 * What LEFT Carres (0312) — one POST per send. The REVISION comes back from
 * the server: a send mints one only when the document changed since the last.
 */
/**
 * Personal saved column layouts (0528; ui MASTER §6.7 rule 4). Purchase Orders
 * is the pilot listing; since 0704 (Chew 2026-10-21, a Finance exception)
 * every Finance table joins it as `finance_<name>` (lower-case letters, digits
 * and `_`). Reads and writes run as the signed-in person.
 */
export type RegisterLayoutListing = "purchase_orders" | `finance_${string}`;
export interface RegisterLayoutRow {
  id: string;
  name: string;
  layout: { order: string[]; hidden: string[]; widths: Record<string, number>; sort: { key: string; dir: "asc" | "desc" } | null };
  is_default: boolean;
}
export function useRegisterLayouts(listing: RegisterLayoutListing) {
  return useQuery({
    queryKey: ["register-layouts", listing],
    queryFn: () =>
      apiFetch<{ layouts: RegisterLayoutRow[]; limit: number }>(
        `/api/operation/register-layouts?listing=${listing}`,
      ),
    staleTime: 60_000,
    retry: false,
  });
}
export function useSaveRegisterLayout(listing: RegisterLayoutListing) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; layout: RegisterLayoutRow["layout"] }) =>
      apiFetch<{ layout: RegisterLayoutRow }>("/api/operation/register-layouts", {
        method: "POST",
        body: JSON.stringify({ listing, ...input }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["register-layouts", listing] }),
  });
}
export function useSetDefaultRegisterLayout(listing: RegisterLayoutListing) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ layout: RegisterLayoutRow }>(
        `/api/operation/register-layouts/${encodeURIComponent(id)}/default`,
        { method: "POST" },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["register-layouts", listing] }),
  });
}












/** operation orders kanban list. Server defaults stage='all', channel='all'. */
export function useOperationOrders(
  filters: operationOrderFilters = {},
  opts?: Partial<UseQueryOptions<operationOrdersListResponse>>,
) {
  return useQuery({
    queryKey: qk.operation.orders(filters),
    queryFn: () =>
      apiFetch<operationOrdersListResponse>(
        "/api/operation/orders" + operationOrdersSearch(filters),
      ),
    staleTime: 30_000,
    // Keep showing the previous filtered/searched list while fetching the
    // next one — without this, the query key flips on every keystroke and
    // TanStack treats each filter change as a brand-new query (no data →
    // isLoading=true → page falls back to <KanbanSkeleton />, which
    // unmounts the search input mid-keystroke and steals focus).
    placeholderData: keepPreviousData,
    ...opts,
  });
}

/**
 * ⭐ EVERY PAGE OF THE SALES ORDERS REGISTER, OR NONE (SO A3-3, 2026-10-06 ·
 * Orders MASTER §0.0 "Register, filters, reports and exports").
 *
 * Follows `nextCursor` from the first page to the last and answers ONE list:
 * every order the caller may read in this scope, once each, in the server's
 * order, with the first page's `salesOrderTotal`. Nothing is answered until
 * the last page is in, so no count, total, group or export can be built from
 * part of the population; a page that fails fails the whole read. A cursor
 * that does not move on is an error, never a loop.
 */
export async function fetchEverySalesOrderPage(
  readPage: (after: string | null) => Promise<operationOrdersListResponse>,
): Promise<operationOrdersListResponse> {
  const byId = new Map<string, operationOrderListRow>();
  const asked = new Set<string>();
  let salesOrderTotal: number | null | undefined;
  let after: string | null = null;
  for (;;) {
    const page = await readPage(after);
    if (after === null) salesOrderTotal = page.salesOrderTotal;
    for (const order of page.orders ?? []) if (!byId.has(order.id)) byId.set(order.id, order);
    const next = page.nextCursor ?? null;
    if (next === null) break;
    if (asked.has(next)) throw new Error("Sales orders could not be loaded.");
    asked.add(next);
    after = next;
  }
  return {
    orders: [...byId.values()],
    ...(salesOrderTotal === undefined ? {} : { salesOrderTotal }),
  };
}

/**
 * The Sales Orders Register's list: the WHOLE permitted population for these
 * filters (`stage=proceeded`, optional search), read page by page through
 * `paged=1` and answered once complete. Paging changes how it loads, never
 * what it holds — the rail summary, the footer, the groups, Cards and Export
 * all read the same complete list. Keyed under `["operation","orders"]`, so
 * an order write's blunt invalidation refreshes it with every other list.
 */
export function useSalesOrderRegisterOrders(filters: operationOrderFilters, enabled = true) {
  return useQuery({
    queryKey: [...qk.operation.orders(filters), "every-page"],
    queryFn: ({ signal }) =>
      fetchEverySalesOrderPage((after) => {
        const params = new URLSearchParams(operationOrdersSearch(filters).slice(1));
        params.set("paged", "1");
        if (after) params.set("after", after);
        return apiFetch<operationOrdersListResponse>(`/api/operation/orders?${params}`, { signal });
      }),
    staleTime: 30_000,
    enabled,
    /* Same reason as `useOperationOrders`: a new search keeps the last
       complete list on screen instead of unmounting the grid mid-keystroke. */
    placeholderData: keepPreviousData,
  });
}

/** Drawer detail. `null` id disables the query (mirror of usePrincipalDealer). */
/**
 * 【DELIVERY】 CARD 19 — the operator's document word (`SO-1362`) resolved to
 * the order's id through the one by-number door. The object page calls this
 * ONCE for a number URL and then re-enters by the id, so every other read
 * still happens by the id (Law C — one door, never a second fan-in).
 */
export function useSalesOrderIdByNumber(so: number | null) {
  return useQuery({
    queryKey: so ? qk.operation.orderByNumber(so) : (["operation", "orders", "by-number", "null"] as const),
    queryFn: () =>
      apiFetch<{ id: string; so: number }>(`/api/operation/orders/by-number/${so}`),
    enabled: so !== null,
    /* A miss is a fact about the number, not a flake — no retry. */
    retry: false,
    staleTime: 60_000,
  });
}

export interface SalesOrderRouteRefund {
  id: string;
  amount: number | string;
  status: "requested" | "approved" | "rejected" | "paid";
  requested_at: string | null;
}

export interface SalesOrderRouteCase {
  id: string;
  caseNo: string;
  statusIsClosed: boolean;
  openedAt: string | null;
}

export interface SalesOrderRouteReceivingSession {
  id: string;
  po_id: string;
  do_number: string | null;
  status: string;
  goods_received_at: string | null;
  submitted_at: string;
}

export interface SalesOrderRouteClaim {
  id: string;
  claim_no: string;
  po_id: string;
  status: string;
  reported_at: string | null;
}

/** `order_finance_exceptions` (0355) as `/api/finance/exceptions/:orderId`
 *  serves it — an OPEN one blocks the DO regardless of payment. */
export interface SalesOrderRouteFinanceException {
  id: string;
  status: "open" | "cleared";
  reason: string;
}

/** `order_delivery_payment_approvals` (0362, owner ruling 2026-08-19) as
 *  `/api/operation/payment-approvals/:orderId` serves it — only an APPROVED
 *  row opens the money gate; it means COD before unloading. */
export interface DeliveryPaymentApprovalRow {
  id: string;
  order_id: string;
  status: "pending" | "approved" | "refused";
  request_reason: string;
  requested_by: string | null;
  requested_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
}

/** One loan-offer record as the API returns it, with the offered Unit's ID. */
export type LoanOfferView = LoanOfferRow & { unit_id: string | null };

/**
 * MONTHLY DEMAND's facts (Orders MASTER, Monthly demand). Two reads in one
 * query, each from its owner's existing door:
 *
 *   the orders   REQUIRED. Without them there is no view, so the query fails.
 *   To buy       SOFT. SO Batch Purchase's own arithmetic per order. A read
 *                that fails or does not parse is `null`, which the page prints
 *                as `Unavailable`, never as zero.
 */
export interface MonthlyDemandFacts {
  orders: MonthlyDemandOrder[];
  /** SO Batch Purchase's still-to-buy quantity per ORDER LINE, so a Product
   *  category narrows it with the lines it counts. Null = unread. */
  toBuyByLine: Map<string, number> | null;
}




/* ─── STAGE 3 · card 3.3 — the attribution request lane ─────────────────────
 *
 * Four hooks, and the split between them IS the law: SUBMIT writes a request,
 * APPROVE writes only that request's status, APPLY is the only one that moves
 * the order (GATES.md GATE 4). They never collapse into one mutation, because
 * one hook would be one button, and one button is how two verbs become one act.
 * ─────────────────────────────────────────────────────────────────────────── */

/** A from → to pair, in NAMES. An approver never decides between two UUIDs. */
export interface AttributionMove {
  from: string | null;
  to: string | null;
}

/**
 * APPLY — the only verb that moves the order. Re-runs every floor first, so it
 * can still refuse here even though APPROVE succeeded. A second call is a
 * no-op and says so (`already_applied`).
 */
export interface AttributionApplyResult {
  id: string;
  revision?: number;
  changed?: string[];
  already_applied?: boolean;
}

/** How the customer's acceptance is evidenced (0562). A signed document, a
 *  traceable reference to the customer's own confirmation, or — for a Staff
 *  correction where the agreement did not change — the revision whose signed
 *  agreement still covers it. */
export type CustomerAgreementKind =
  | "signed_document"
  | "customer_confirmation"
  | "original_agreement";


export interface AmendmentImpactFinding {
  owner: string;
  kind: string;
  count: number;
  amount?: number;
  blocks: boolean;
  href: string;
}


/** What cancelling this Sales Order would raise, per owner — the same seven
 *  owners and the same finding shape the amendment preview uses, so one
 *  vocabulary covers both governed changes. Read-only. */
export interface SalesOrderCancelImpact {
  order_id: string;
  so: number;
  status: string;
  cancellable: boolean;
  refusal: string | null;
  goods_total: number;
  paid: number;
  findings: AmendmentImpactFinding[];
}

/* ─── 0562 · the whole-page edit's ONE commit ────────────────────────────────
 * The page sends its whole draft; the SERVER classifies it and either saves a
 * correction or submits an amendment request (orders/MASTER § VIEW FIRST). */
export interface SalesOrderChangesInput {
  header: Record<string, unknown>;
  lines: Array<{ id?: string; sku: string; qty: number; unit_price: number; attrs?: Record<string, unknown> | null }>;
  addons: Array<{ id?: string; addon_key: string; qty: number; unit_price: number; attrs?: Record<string, unknown> | null }>;
  installment_months?: number | null;
  reason: string;
  customerAskedOn?: string | null;
  /** 0564 — the governed agreement, recorded with the request in one act. */
  agreement?: { kind: CustomerAgreementKind; reference: string; detail?: string };
  replaceAmendmentId?: string | null;
}
export type SalesOrderChangesResult =
  | { action: "saved"; revision: number; changed?: string[] }
  | { action: "submitted"; amendmentId: string; baseRevision: number; agreementRecorded: boolean };

/** What a successful confirmation returns. `partnerWarnings` (T9, 0283) is what
 *  the carrier's own rules say about the date that was just recorded — it
 *  arrives AFTER the booking is saved because these warn and never block.
 *  Optional: an older Worker simply doesn't send it. */
export interface ConfirmBookingResult {
  control: OpsOrderControl;
  partnerWarnings?: PartnerBookingWarningWire[];
  /** C7 — the goods + money sentences. They used to be a 422; since
   *  `docs/ORDERS-WORKING-FLOW.md` §5 moved the hard gate onto ISSUING the
   *  delivery order, agreeing a date only warns. Optional: an older Worker
   *  simply does not send it. */
  gateWarnings?: string[];
  /** SLICE 2 — set when this confirmation completed the delivery-order gate
   *  and the SYSTEM issued (or found) the document. Optional and nullable: an
   *  older Worker does not send it, and a confirmation that leaves a
   *  requirement open sends null. */
  deliveryOrder?: { do_number: string | null; issued: boolean } | null;
}

/* SLICE 2 — `useIssueDeliveryOrder` is DELETED. The system issues the
 * document itself the moment every requirement is met (`docs/orders/MASTER.md`
 * §8: no Release button, no Approve button, no manual bypass in any state);
 * the server hooks the act onto the doors that complete the gate, and the
 * confirm mutation above already invalidates the order queries, so the number
 * appears without a press. The POST endpoint remains server-side as an
 * idempotent backstop, deliberately unwired from any button. */

/** The Delivery Orders REGISTER + the DO object page (blueprint card
 *  2026-08-16). Read-only document truth: rows from `ops_delivery_orders`
 *  (0356) plus the attempt facts the ONE shared status arithmetic
 *  (`deliveryOrderStatusOf`) derives from. A register finds documents — no
 *  owner, no action, no due date rides these hooks. */
export interface DeliveryOrderRow {
  id: string;
  order_id?: string;
  do_number: string;
  /** 0491 — 0 the whole-order trip; 1..n one leg of the order's Journey. */
  leg?: number | null;
  /** 0542 — 0 unsplit; 1..3 one trip of a split delivery. */
  trip?: number | null;
  issued_at: string;
  trip_groups: string[] | null;
  delivery_date: string | null;
  time_slot: string | null;
  logistics_partner: string | null;
  voided_at: string | null;
  void_reason: "order_cancelled" | "rescheduled" | null;
  orders: {
    id: string;
    so: number;
    /* Houzs DO list hidden columns (MfgDeliveryOrdersListV2.tsx:1352-1565). */
    source_ref?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
    customer_address_line1?: string | null;
    customer_address_line2?: string | null;
    customer_address_postcode?: string | null;
    building_type?: string | null;
    invoice_no?: string | null;
    salespersons?: { name: string | null } | { name: string | null }[] | null;
    invoice_documents?: Array<{ invoice_no: string | null; voided_at: string | null }> | null;
    order_addons?: Array<{ qty: number; unit_price: number | string | null }> | null;
    customer_name: string | null;
    /** The written address, and the two structured columns beside it — read
     *  through the ONE shared interpretation (`resolveDeliveryLocality`), so
     *  the register and Monitor cannot print two localities for one order. */
    customer_address?: string | null;
    customer_address_city?: string | null;
    customer_address_state?: string | null;
    /** The SO's customer promise — the register's `Requested Delivery Date` column
     *  (owner column ruling 2026-08-18). */
    delivery_date?: string | null;
    delivery_date_tbd?: boolean | null;
    /** The signed DO on file (0087) — the `Upload signed Delivery Order`
     *  queue's canonical fact (register correction 2026-09-06) — and its
     *  clock, one of the §6.1 files that can reopen the review question. */
    do_number?: string | null;
    do_file_path?: string | null;
    do_uploaded_at?: string | null;
    /** 0156 — the order's Journey legs, when it travels in legs. */
    delivery_stops?: DeliveryStop[] | null;
    /** Delivery's own record per leg: the day and carrier a document minted
     *  before the booking never snapshotted. */
    ops_delivery_arrangements?: Array<{
      leg: number | null;
      confirmed_date: string | null;
      confirmed_time: string | null;
      partner_id: string | null;
      driver_name?: string | null;
      vehicle?: string | null;
      delivery_partners?: { name: string } | { name: string }[] | null;
    }>;
    /** The order's goods lines — the register expansion derives THIS TRIP's
     *  lines from them via `trip_groups` (one arithmetic with the DO page). */
    order_lines?: Array<{
      id?: string;
      sku: string;
      qty: number;
      unit_price?: number | string | null;
      attrs?: Record<string, unknown> | null;
    }>;
    /** T6 (0280) — the delivery-photo ledger; PostgREST may embed the overlay
     *  as an object or a one-row array. null/absent = UNKNOWN, never empty. */
    ops_order_control?:
      | { delivery_photos?: DeliveryLedgerEntry[] | null }
      | { delivery_photos?: DeliveryLedgerEntry[] | null }[]
      | null;
  };
}
export interface DeliveryOrderAttemptRow {
  /** 0344's row id — the Delivery Visit a §6.1 evidence file binds to. */
  id?: string;
  do_number: string | null;
  /** 0491 — the scope the result belongs to. */
  leg?: number | null;
  result: "delivered" | "partial" | "failed";
  reason_key: string | null;
  note?: string | null;
  where_goods?: string | null;
  recorded_at: string;
  recorded_by?: string | null;
}
/** One §4 handover fact (0363) as the register needs it — the kind, and its
 *  clock for Monitor's `Collected {date} {time}` line (§8.4). */
export interface DeliveryHandoverKindRow {
  delivery_order_id: string;
  kind: DeliveryHandoverKind;
  recorded_at?: string | null;
}

export interface DeliveryOrdersRegisterPayload {
  deliveryOrders: DeliveryOrderRow[];
  attempts: DeliveryOrderAttemptRow[];
  handoverEvents: DeliveryHandoverKindRow[];
  /** Absent on an older Worker = none shown. */
  sourcePos?: { id: string; so: number | null; so_refs: number[] | null }[];
  deliveryReturns?: { delivery_order_id: string; return_no: string | null }[];
  /** §6.1 (0489) — Operation's reviews and the per-attempt evidence clocks.
   *  Absent on an older Worker = unknown, read as no review recorded. */
  proofReviews?: DeliveryProofReviewRow[];
  attemptEvidence?: DeliveryAttemptEvidenceRow[];
}






/**
 * DELIVERY'S OWN ARRANGEMENTS (0379) — every scope's carrier, agreed day and
 * window, in one read. The workspace joins them by `${order_id}#${leg}`.
 */
export type { DeliveryArrangementRow, DeliveryArrangementEventRow } from "@carres/shared";
export type { DeliveryProofReviewRow, DeliveryAttemptEvidenceRow } from "@carres/shared";
export type { DeliveryCannotDeliverRow } from "@carres/shared";

export interface DeliveryArrangementsPayload {
  arrangements: DeliveryArrangementRow[];
  /** Every customer-contact record (0487) — the status ladder reads the
   *  latest per scope. Optional: an older Worker carries none. */
  contacts?: DeliveryContactRow[];
  /** Every recorded `Cannot Deliver` (0417) — Reports → Delivery's partner
   *  measure. Absent = the read failed or an older Worker: `Not available`. */
  cannotDeliver?: DeliveryCannotDeliverRow[];
}

export function useDeliveryArrangements() {
  return useQuery<DeliveryArrangementsPayload, ApiError>({
    queryKey: ["operation", "delivery-arrangements"],
    queryFn: () =>
      apiFetch<DeliveryArrangementsPayload>("/api/operation/delivery-arrangements"),
    staleTime: 30_000,
  });
}

/** Delivery's read-only event feed for the shared Warehouse Schedule. */
export function useDeliveryWarehouseSchedule() {
  return useQuery<{ events: DeliveryWarehouseScheduleEvent[] }, ApiError>({
    queryKey: ["operation", "delivery-arrangements", "warehouse-schedule"],
    queryFn: () =>
      apiFetch<{ events: DeliveryWarehouseScheduleEvent[] }>(
        "/api/operation/delivery-arrangements/warehouse-schedule",
      ),
    staleTime: 30_000,
  });
}


/* ── DELIVERY SETTINGS (0488, Delivery MASTER §11) — one read, section doors ── */
export interface DeliverySettingsPartnerRow extends DeliveryPartnerRow {
  active?: boolean;
  address?: string | null;
  customer_phone?: string | null;
  office_contact?: string | null;
  coverage?: PartnerCoverage | null;
  kv_default?: boolean;
  cutoff_time?: string | null;
  handover_points?: HandoverPoint[] | null;
  services?: PartnerServices | null;
  customer_contact_by?: "partner" | "operation";
  record_on_behalf_allowed?: boolean;
  proof_rules?: ProofRules | null;
  operating_party_id?: string | null;
}
export interface DeliverySettingsResponse {
  partners: DeliverySettingsPartnerRow[];
  drivers: Array<{ id: string; partner_id: string; name: string; phone: string | null; active: boolean; role?: "driver" | "helper" | null }>;
  vehicles: Array<{
    id: string;
    partner_id: string;
    plate: string;
    vehicle_type: string;
    capacity: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    active: boolean;
    /** 0724 (YH 2026-10-26): the Radius Velocity device on a Carres lorry. */
    velocity_device_id?: string | null;
  }>;
  templates: DeliveryTemplateRow[];
  changes: DeliverySettingChangeRow[];
  partnerAccounts: Array<{ id: string; name: string | null; email: string; partner_id: string | null; status: string }>;
  canEdit: boolean;
  contactLeadWorkingDays: number | null;
  /** 0673 · Delivery Rules → `Assign logistics by` (DEL-04). `stored: false`
   *  = not installed: the default answers and Edit is not offered. Absent on
   *  an older API. */
  rules?: {
    assignmentLeadWorkingDays: number;
    /** 0678 · DEL-10 `Courier dispatch within` (default 3). Absent on an older API. */
    courierDispatchWorkingDays?: number;
    courierDispatchStored?: boolean;
    revision: number | null;
    stored: boolean;
    canEdit: boolean;
  };
}
export const DELIVERY_SETTINGS_QUERY_KEY = ["operation", "delivery-settings"] as const;
export function useDeliverySettings() {
  return useQuery<DeliverySettingsResponse, ApiError>({
    queryKey: DELIVERY_SETTINGS_QUERY_KEY,
    queryFn: () => apiFetch<DeliverySettingsResponse>("/api/operation/delivery-settings"),
    staleTime: 30_000,
  });
}

/** Operation records the partner's Cannot Deliver on its behalf (§8.6). */
export function useRecordCannotDeliver(orderId: string | undefined, leg = 0) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OperationCannotDeliverInput) =>
      apiFetch<{ reported: boolean }>(
        `/api/operation/delivery-arrangements/${orderId}/cannot-deliver?leg=${leg}`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operation", "delivery-arrangements"] });
      void qc.invalidateQueries({ queryKey: ["operation", "delivery-arrangement", orderId ?? ""] });
      void qc.invalidateQueries({ queryKey: ["operation", "orders"] });
    },
  });
}

/** ASSIGN LOGISTICS — one partner onto one or many scopes, atomically. */
export function useAssignLogistics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignLogisticsInput) =>
      apiFetch<{ assigned: number; partner: string }>(
        "/api/operation/delivery-arrangements/assign",
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operation", "delivery-arrangements"] });
      void qc.invalidateQueries({ queryKey: ["operation", "orders"] });
    },
  });
}

/** SAVE DELIVERY — the Edit Delivery form for ONE scope. */
export function useSaveDeliveryArrangement(orderId: string | undefined, leg = 0) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDeliveryArrangementInput) =>
      apiFetch<{ arrangement: DeliveryArrangementRow }>(
        `/api/operation/delivery-arrangements/${orderId}?leg=${leg}`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    onSuccess: ({ arrangement }) => {
      // Publish only the server-returned saved fact before the editor folds.
      qc.setQueryData<DeliveryArrangementsPayload>(["operation", "delivery-arrangements"], current => current ? {
        ...current,
        arrangements: [...current.arrangements.filter(row => row.order_id !== arrangement.order_id || row.leg !== arrangement.leg), arrangement],
      } : current);
      if (orderId) void qc.invalidateQueries({ queryKey: qk.operation.orderTimeline(orderId) });
      void qc.invalidateQueries({ queryKey: ["operation", "delivery-arrangements"] });
      void qc.invalidateQueries({ queryKey: ["operation", "delivery-arrangement", orderId ?? ""] });
      void qc.invalidateQueries({ queryKey: ["operation", "orders"] });
    },
  });
}

/**
 * THE LOGISTICS CARD'S DELIVERY FACTS (0581) — the partner and whether it has
 * a portal, the stock route read from Purchasing/Stock, the external link, the
 * partner's latest answer and recent history. Nested under the scope's
 * `delivery-arrangement` key, so every arrangement save refreshes it.
 */
export function useLogisticsCardFacts(orderId: string | null, leg = 0) {
  return useQuery<LogisticsCardFacts, ApiError>({
    queryKey: ["operation", "delivery-arrangement", orderId ?? "", "logistics-card", leg],
    queryFn: () =>
      apiFetch<LogisticsCardFacts>(`/api/operation/delivery-arrangements/${orderId}/logistics-card?leg=${leg}`),
    enabled: Boolean(orderId),
    staleTime: 15_000,
  });
}

/**
 * THE SUPPLIER CARD'S FACTS — Purchasing's POs serving one Sales Order
 * (owner approval 2026-09-25, Workspace §5.9). Read-only.
 */
export function useSupplierCardFacts(orderId: string | null) {
  return useQuery<{ purchaseOrders: import("@carres/shared").SupplierPoFact[] }, ApiError>({
    queryKey: ["operation", "pos", "for-order", orderId ?? ""],
    queryFn: () =>
      apiFetch<{ purchaseOrders: import("@carres/shared").SupplierPoFact[] }>(
        `/api/operation/pos/for-order/${encodeURIComponent(orderId ?? "")}`,
      ),
    enabled: Boolean(orderId),
    staleTime: 30_000,
  });
}

/** Create link · Revoke link (0581). Two explicit acts: a new link is only
 *  ever created after the old one is revoked. */
export function useDeliveryLinkActs(orderId: string | null, leg = 0) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["operation", "delivery-arrangement", orderId ?? ""] });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ link: { id: string; token: string; created_at: string } }>(
        `/api/operation/delivery-arrangements/${orderId}/link?leg=${leg}`,
        { method: "POST" },
      ),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: () =>
      apiFetch<{ revoked: boolean }>(`/api/operation/delivery-arrangements/${orderId}/link/revoke?leg=${leg}`, {
        method: "POST",
      }),
    onSuccess: refresh,
  });
  return { create, revoke };
}

export function useDeliveryOrdersRegister(opts?: { orderId?: string; enabled?: boolean }) {
  const scope = opts?.orderId ?? "all";
  return useQuery<DeliveryOrdersRegisterPayload, ApiError>({
    queryKey: ["operation", "delivery-orders", scope],
    queryFn: () =>
      apiFetch<DeliveryOrdersRegisterPayload>(
        opts?.orderId
          ? `/api/operation/delivery-orders?order=${opts.orderId}`
          : "/api/operation/delivery-orders",
      ),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
  });
}

export interface DeliveryOrderDetailPayload {
  deliveryOrder: DeliveryOrderRow & {
    order_id: string;
    orders: DeliveryOrderRow["orders"] & {
      customer_phone: string | null;
      customer_email?: string | null;
      source_ref?: string | null;
      salespersons?: { name: string | null } | { name: string | null }[] | null;
      customer_emergency: string | null;
      customer_address: string | null;
      /** The signed DO on file (0087) — production's real proof columns; the
       *  pod_url/pod_uploaded_at pair named earlier never existed on orders,
       *  and naming them 500'd the whole select (the dead-page defect). */
      do_file_path: string | null;
      do_uploaded_at: string | null;
      pod_signature_url: string | null;
      pod_signed_by: string | null;
      pod_signed_at: string | null;
      do_number: string | null;
      /** 0156 — the order's Journey legs; a leg document names its own. */
      delivery_stops?: DeliveryStop[] | null;
      /** Card 16 — the site facts and the source warehouse, Sales' own columns. */
      warehouse_id?: string | null;
      warehouses?: { name: string | null } | { name: string | null }[] | null;
      delivery_floor?: number | null;
      delivery_has_lift?: boolean | null;
      delivery_stair_items?: string | null;
      building_type?: string | null;
      ops_order_control?:
        | { delivery_photos?: DeliveryLedgerEntry[] | null; customer_request?: string | null; action_for_logistic?: string | null }
        | { delivery_photos?: DeliveryLedgerEntry[] | null; customer_request?: string | null; action_for_logistic?: string | null }[]
        | null;
      order_lines: Array<{ sku: string; qty: number }>;
    };
  };
  /** 0424 — the document's recorded exact-Unit scope, resolved to Unit IDs. */
  scopeUnits?: Array<{ item_id: string; unit_code: string | null; sku: string | null }>;
  handoverEventUnits?: Array<{ event_id: string; item_id: string; recorded_side: string; unit_code: string | null }>;
  attempts: DeliveryOrderAttemptRow[];
  lineDescriptions: Record<string, string>;
  /** Card 16 (Delivery MASTER §9) — the seven sections' owned facts. All
   *  optional: an older Worker answers without them, and the page states the
   *  absence rather than inventing a value. */
  arrangement?: {
    id: string;
    leg: number;
    partner_id: string | null;
    confirmed_date: string | null;
    confirmed_time: string | null;
    expected_arrival: string | null;
    logistics_note: string | null;
    driver_name: string | null;
    vehicle: string | null;
    condo_registration: string | null;
    delivery_partners?: { id: string; name: string } | { id: string; name: string }[] | null;
  } | null;
  financeExceptions?: Array<{ id: string; status: "open" | "cleared"; reason: string; opened_at: string | null; cleared_at: string | null }>;
  paymentApprovals?: Array<{ id: string; status: "pending" | "approved" | "refused"; request_reason: string; requested_at: string | null; decided_at: string | null; decision_reason: string | null }>;
  siblingDocuments?: Array<{ id: string; do_number: string; leg?: number | null; issued_at: string; voided_at: string | null; void_reason: string | null }>;
  /** null = the Cases could not be read (another module's table), never "none". */
  serviceCases?: Array<{ id: string; case_no: string; status_id: string | null; opened_at: string | null }> | null;
  history?: Array<{ id: string; text: string; by_role: string | null; occurred_at: string }>;
  /** §6.1 (0489) — the Evidence section's facts: every file bound to the
   *  attempt it proves (signed for viewing) and every review with its
   *  reviewer's name. */
  proofReviews?: Array<DeliveryProofReviewRow & { reviewed_by_name: string | null }>;
  attemptEvidence?: Array<DeliveryAttemptEvidenceRow & { url: string | null }>;
  loans: Array<{
    id: string;
    item_id: string | null;
    do_number: string | null;
    status: "on_loan" | "returned";
    loaned_at: string | null;
    returned_at: string | null;
    loan_note_no: string | null;
    /** 0492 (Card 15) — the loaned Unit's identity. */
    ops_stock_items?: { unit_code: string | null; identity_scope: string | null } | { unit_code: string | null; identity_scope: string | null }[] | null;
  }>;
  handoverEvents: DeliveryHandoverEventRow[];
}

/** One §4 handover fact as recorded (0363) — person, company, active duty,
 *  time, proof; the receipt may carry its OWN goods count (a discrepancy
 *  keeps both facts visible). */
export interface DeliveryHandoverEventRow {
  id: string;
  kind: DeliveryHandoverKind;
  duty: "warehouse" | "logistics";
  company: string | null;
  counterparty: string | null;
  receiver_name: string | null;
  vehicle: string | null;
  goods: HandoverGoodsLine[] | null;
  note: string | null;
  proof_path: string | null;
  recorded_by: string;
  recorded_by_name: string | null;
  recorded_at: string;
  proofUrl: string | null;
}

export function useDeliveryOrder(idOrNumber: string | null) {
  return useQuery<DeliveryOrderDetailPayload, ApiError>({
    queryKey: ["operation", "delivery-orders", "detail", idOrNumber],
    queryFn: () =>
      apiFetch<DeliveryOrderDetailPayload>(
        `/api/operation/delivery-orders/${encodeURIComponent(idOrNumber ?? "")}`,
      ),
    enabled: Boolean(idOrNumber),
  });
}



/** §6.1 (0489) — the three review acts, through the governed door. The DO
 *  page, the register and Monitor all re-read: a review moves the row's
 *  queue and its status colour. */
export function useReviewDeliveryProof(
  doId: string,
  opts?: Partial<UseMutationOptions<{ review: unknown }, ApiError, ProofReviewInput>>,
) {
  const qc = useQueryClient();
  return useMutation<{ review: unknown }, ApiError, ProofReviewInput>({
    mutationFn: (input) =>
      apiFetch<{ review: unknown }>(
        `/api/operation/delivery-orders/${encodeURIComponent(doId)}/proof-review`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["operation", "delivery-orders"] });
      await qc.invalidateQueries({ queryKey: ["operation", "orders"] });
      await qc.invalidateQueries({ queryKey: ["operation", "work"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}


/** The §4 chain door (0363): record ONE ordered fact on a live document.
 *  Invalidates every delivery-order read AND the delivery/orders lists — the
 *  register pill may turn `Out for delivery` on this write. */
export function useRecordHandoverEvent(
  doId: string,
  opts?: Partial<
    UseMutationOptions<{ event: unknown }, ApiError, RecordHandoverInput>
  >,
) {
  const qc = useQueryClient();
  return useMutation<{ event: unknown }, ApiError, RecordHandoverInput>({
    mutationFn: (input) =>
      apiFetch<{ event: unknown }>(
        `/api/operation/delivery-orders/${encodeURIComponent(doId)}/handover`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["operation", "delivery-orders"] });
      await qc.invalidateQueries({ queryKey: ["operation", "orders"] });
      await qc.invalidateQueries({
        queryKey: ["operation", "delivery-arrangements", "warehouse-schedule"],
      });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** Warehouse Card 03 — record scanned / checked / packed for exact Units of
 *  one DO scope through the governed prep door (0424). Idempotent server-side. */
export function useRecordOutboundPrep(doId: string) {
  const qc = useQueryClient();
  return useMutation<
    { result: { recorded: number; alreadyRecorded: number } },
    ApiError,
    RecordOutboundPrepInput
  >({
    mutationFn: (input) =>
      apiFetch<{ result: { recorded: number; alreadyRecorded: number } }>(
        `/api/operation/delivery-orders/${encodeURIComponent(doId)}/outbound-prep`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["operation", "delivery-arrangements", "warehouse-schedule"],
      });
      await qc.invalidateQueries({ queryKey: ["operation", "delivery-orders"] });
    },
  });
}

// ===========================================================================
// Staff assignment pool (migration 0232, Jess model B 2026-07-18).
// ===========================================================================
/** Active operation accounts + their pool/availability state. Fails soft
 *  (retry off): on a Worker that predates the route the list page simply sees
 *  an empty pool and the whole assignment layer stays inert. */
export function useOperationStaff(
  opts?: Partial<UseQueryOptions<OpsStaffListResponse>>,
) {
  return useQuery({
    queryKey: qk.operation.staff,
    queryFn: () => apiFetch<OpsStaffListResponse>(`/api/operation/staff`),
    staleTime: 60_000,
    retry: false,
    ...opts,
  });
}




// ===========================================================================
// Balance job (migration 0184) — payment ledger + storage collect / waiver.
// ===========================================================================
/** The ledger as the endpoint returns it. */
export interface OrderPaymentsResponse {
  payments: OrderPaymentRow[];
}

/** After any money mutation, refresh the ledger + the overlay (gate state) + the
 *  order detail/list + the Payments panel so every surface agrees at once. */
function invalidateOrderMoney(
  qc: ReturnType<typeof useQueryClient>,
  orderId: string,
) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.operation.orderPayments(orderId), exact: true }),
    qc.invalidateQueries({ queryKey: qk.finance.paymentRegister(), exact: true }),
    qc.invalidateQueries({ queryKey: qk.operation.orderControl(orderId), exact: true }),
    qc.invalidateQueries({ queryKey: ["operation", "orders"] }),
    qc.invalidateQueries({ queryKey: ["operation", "payments"] }),
  ]);
}

/** 0707 — a backdated payment request, waiting for the Payment Approver. */
export interface PaymentBackdateRequest {
  id: string;
  order_id: string;
  amount: number;
  paid_on: string;
  method: string;
  kind: "payment" | "deposit" | "storage";
  reference: string | null;
  receipt_url: string | null;
  status: "waiting" | "approved" | "refused";
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  payment_id: string | null;
}

/** 0707 — a paid date more than 14 days back is not recorded: the server
 *  answers a waiting request instead, and nothing counts until it is approved. */
export type RecordPaymentResult =
  | { payment: OrderPaymentRow; pendingApproval?: undefined }
  | { pendingApproval: true; request: PaymentBackdateRequest; payment?: undefined };

export const BACKDATE_WAITING_WORDS =
  "Sent to the Payment Approver. This payment counts once it is approved.";

/** The order's backdated payment requests (0707), newest first. */
export function usePaymentBackdateRequests(orderId: string | null) {
  return useQuery({
    queryKey: ["operation", "orders", orderId ?? "null", "payment-backdate"] as const,
    queryFn: () =>
      apiFetch<{ requests: PaymentBackdateRequest[] }>(
        `/api/operation/orders/${orderId}/payment-backdate`,
      ),
    enabled: !!orderId,
    staleTime: 10_000,
  });
}

/** Approve or refuse one (0707). The SQL door decides who may: the Payment
 *  Approver duty or a principal, never the person who asked. */
export function useDecidePaymentBackdate(
  orderId: string,
  opts?: Partial<UseMutationOptions<unknown, ApiError, { requestId: string; approve: boolean; reason?: string; duplicateAck?: boolean }>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { requestId: string; approve: boolean; reason?: string; duplicateAck?: boolean }>({
    mutationFn: ({ requestId, ...body }) =>
      apiFetch(`/api/operation/orders/${orderId}/payment-backdate/${requestId}/decide`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await invalidateOrderMoney(qc, orderId);
      await qc.invalidateQueries({ queryKey: qk.finance.invoiceRegister(), exact: true });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** Record one payment on the ledger. */
export function useRecordPayment(
  orderId: string,
  opts?: Partial<UseMutationOptions<RecordPaymentResult, ApiError, RecordPaymentInput>>,
) {
  const qc = useQueryClient();
  return useMutation<RecordPaymentResult, ApiError, RecordPaymentInput>({
    mutationFn: (input) =>
      apiFetch<RecordPaymentResult>(
        `/api/operation/orders/${orderId}/payments`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await invalidateOrderMoney(qc, orderId);
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** Void a mis-keyed ledger entry. The reason is REQUIRED (0430) and the
 *  server gate is the Payment Approver duty or principal — SQL-enforced. */
export function useVoidPayment(
  orderId: string,
  opts?: Partial<UseMutationOptions<{ ok: true }, ApiError, { paymentId: string; reason: string }>>,
) {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, ApiError, { paymentId: string; reason: string }>({
    mutationFn: ({ paymentId, reason }) =>
      apiFetch<{ ok: true }>(
        `/api/operation/orders/${orderId}/payments/${paymentId}`,
        { method: "DELETE", body: JSON.stringify({ reason }) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await invalidateOrderMoney(qc, orderId);
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** Migration 0147 (item h, 2026-05-23) — LP accepts an incoming delivery
 *  assignment. Body is empty (orderId is in the path). Mutation source is
 *  the Partner "Incoming" page. */
export function useLpAcceptOrder(
  orderId: string,
  opts?: Partial<UseMutationOptions<unknown, ApiError, void>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () =>
      apiFetch(
        `/api/partner/orders/${orderId}/accept`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.partner.incoming() });
      await qc.invalidateQueries({ queryKey: qk.partner.toDeliver() });
      await qc.invalidateQueries({ queryKey: qk.partner.dashboard() });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** Migration 0147 (item h, 2026-05-23) — LP rejects an incoming delivery
 *  assignment with a required free-text reason. The reason surfaces back to
 *  Operation in the red-badge tooltip + reselect dialog. */
export function useLpRejectOrder(
  orderId: string,
  opts?: Partial<UseMutationOptions<unknown, ApiError, LpRejectOrderInput>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, LpRejectOrderInput>({
    mutationFn: (input) =>
      apiFetch(
        `/api/partner/orders/${orderId}/reject`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: qk.partner.incoming() });
      await qc.invalidateQueries({ queryKey: qk.partner.dashboard() });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** Migration 0147 (item h, 2026-05-23) — LP "Incoming" queue. Orders picked
 *  by Operation at Accept Proceed that this LP hasn't yet accepted or
 *  rejected. Polled 15s while the page is open. */
export interface PartnerIncomingOrder {
  id: string;
  so: number;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  delivery_date: string | null;
  request_for_delivery_at: string;
  placed_at: string;
  operation_stage: string | null;
  warehouse_id: string | null;
  dealers: { name: string } | null;
  warehouses: { name: string; address: string | null } | null;
}
export interface PartnerIncomingResponse {
  orders: PartnerIncomingOrder[];
}
export function usePartnerIncomingOrders() {
  return useQuery<PartnerIncomingResponse>({
    queryKey: qk.partner.incoming(),
    queryFn: () => apiFetch<PartnerIncomingResponse>("/api/partner/orders/incoming"),
    refetchInterval: 15_000,
  });
}











/**
 * The PARTNER leg of receiving — a partner confirming goods at a warehouse.
 * (Was "the partner-side variant of useReceivePoWithDoMutation"; that Office
 * hook was retired 2026-08-03, Card C1.) Loo 2026-05-11.
 *
 * Posts to /api/partner/pickups/:id/receive, which calls the SAME
 * `operation_receive_po_with_do` RPC under the hood (the RPC's role gate
 * already admits partners + checks procurement_partner_id matches caller).
 * Replaces the "Arrived at WH → wait for operation Receive" two-step with
 * one atomic move: partner uploads DO + ticks qty → PO flips straight to
 * status='received'.
 *
 * Cache invalidation differs from the operation version: blast the partner
 * sub-tree (so dashboard + pickups kanban refresh) AND the operation tree
 * (so the procurement view sees the PO arrive in the Received tab).
 */
export function useReceivePoAsPartnerMutation(
  poId: string,
  opts?: Partial<
    UseMutationOptions<operationReceivePoWithDoResponse, ApiError, ReceivePoWithDoInput>
  >,
) {
  const qc = useQueryClient();
  return useMutation<operationReceivePoWithDoResponse, ApiError, ReceivePoWithDoInput>({
    mutationFn: (input) =>
      apiFetch<operationReceivePoWithDoResponse>(
        `/api/partner/pickups/${poId}/receive`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ...opts,
    onSuccess: async (...args) => {
      // Partner-side caches.
      await qc.invalidateQueries({ queryKey: ["partner"] });
      // operation-side caches (PO appears in Received tab; warehouse stock
      // bumped; orders may unblock in_production).
      await qc.invalidateQueries({ queryKey: qk.operation.po(poId), exact: true });
      await qc.invalidateQueries({ queryKey: ["operation", "pos"] });
      await qc.invalidateQueries({ queryKey: qk.operation.warehouse(), exact: true });
      await qc.invalidateQueries({ queryKey: qk.operation.stockAlerts() });
      await qc.invalidateQueries({ queryKey: ["operation", "movements"] });
      await qc.invalidateQueries({ queryKey: ["operation", "orders"] });
      await qc.invalidateQueries({ queryKey: qk.operation.dashboard(), exact: true });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}




function toFinanceRefundsSearch(f?: FinanceRefundsFilters): string {
  if (!f) return "";
  const p = new URLSearchParams();
  if (f.status)   p.set("status",   f.status);
  if (f.dealerId) p.set("dealerId", f.dealerId);
  if (f.from)     p.set("from",     f.from);
  if (f.to)       p.set("to",       f.to);
  if (f.limit)    p.set("limit",    String(f.limit));
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}



export function usePaymentRegister() {
  return useQuery({
    queryKey: qk.finance.paymentRegister(),
    queryFn: async () => {
      const rows: import("@carres/shared/payment-register").PaymentRegisterRow[] = [];
      let total: number | null = null;
      do {
        const page = await apiFetch<import("@carres/shared/payment-register").PaymentRegisterPage>(
          `/api/finance/payments/register?offset=${rows.length}&limit=200`,
        );
        if (!Number.isInteger(page.total) || page.total < 0) throw new Error("Payments could not be loaded. Try again.");
        if (total !== null && total !== page.total) throw new Error("Payments changed. Try again.");
        total = page.total;
        if (page.rows.length === 0 && rows.length < total) throw new Error("Payments could not be loaded. Try again.");
        rows.push(...page.rows);
      } while (rows.length < total);
      if (rows.length !== total || new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("Payments changed. Try again.");
      return rows;
    },
    staleTime: 15_000,
  });
}

/** The Invoices Register — the same fail-closed complete read as Payments:
 *  a page that cannot be completed is an error, never a shorter list. */
export function useInvoiceRegister(dept = "") {
  const d = withDepartment(qk.finance.invoiceRegister(), "/api/finance/invoices/register", dept);
  return useQuery({
    queryKey: d.queryKey,
    queryFn: async () => {
      const rows: import("@carres/shared/payment-invoice-register").InvoiceRegisterRow[] = [];
      let total: number | null = null;
      do {
        const page = await apiFetch<import("@carres/shared/payment-invoice-register").InvoiceRegisterPage>(
          `${d.url}${d.url.includes("?") ? "&" : "?"}offset=${rows.length}&limit=200`,
        );
        if (!Number.isInteger(page.total) || page.total < 0) throw new Error("Invoices could not be loaded. Try again.");
        if (total !== null && total !== page.total) throw new Error("Invoices changed. Try again.");
        total = page.total;
        if (page.rows.length === 0 && rows.length < total) throw new Error("Invoices could not be loaded. Try again.");
        rows.push(...page.rows);
      } while (rows.length < total);
      if (rows.length !== total || new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("Invoices changed. Try again.");
      return rows;
    },
    staleTime: 15_000,
  });
}

/**
 * The Payment Monitor's three source reads beside the invoice register
 * (owner ruling 2026-09-12). Each is the owning module's own wire, read
 * whole: the Monitor derives its Storage cell from the same cases and
 * requests the Invoice object's Storage section reads, and its clock from
 * the same effective timing rules Settings shows — never a second store.
 */
export function usePaymentStorageCases() {
  return useQuery({
    queryKey: qk.finance.storageCases(),
    queryFn: () => apiFetch<{
      cases: import("@carres/shared/payment-monitor").MonitorStorageCase[];
    }>("/api/finance/payment-storage"),
    staleTime: 15_000,
  });
}

export function useLaterDeliveryRequests() {
  return useQuery({
    queryKey: qk.finance.laterDeliveryRequests(),
    queryFn: () => apiFetch<{
      requests: Array<import("@carres/shared/payment-monitor").MonitorFreeRequest & {
        id: string; requested_date: string;
      }>;
    }>("/api/finance/payment-storage/later-delivery-requests"),
    staleTime: 15_000,
  });
}

export interface PaymentSettingsPayload {
  bank_accounts: Array<{
    route_source: "pj_showroom" | "dealer"; bank_name: string;
    account_name: string | null; account_no: string | null;
  }>;
  storage_rules: Array<{
    id: string; product_group: "mattress_bedframe" | "sofa"; free_days: number;
    charge_amount: number; cycle_days: number; operation_limit_day: number | null;
    waiver_limit_day: number | null; extra_free_allowed: boolean; inspection_days: number;
    effective_from: string;
  }>;
  /** 0486 — newest effective first; the head is the current rule. */
  collection_timing: Array<{
    id: string; ask_days_before: number; deadline_days_before: number;
    /** 0672 — the outstation pair; absent on a row read before 0672. */
    outstation_ask_days_before?: number | null; outstation_deadline_days_before?: number | null;
    effective_from: string; reason: string | null; created_at: string;
  }>;
  setting_changes: Array<{
    id: string; what: string; old_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null; reason: string | null;
    effective_from: string | null; changed_at: string;
    actor: { name: string | null } | { name: string | null }[] | null;
  }>;
  online_provider: { name: string; configured: boolean };
}

/**
 * 0489 — the order's collection owner: the Responsible Delivery Operation,
 * normal owner · today's cover · acting person · handover history, from the
 * same `payment_collection_owner_context` the Work feed reads.
 */
export function useCollectionOwner(orderId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.finance.collectionOwner(orderId ?? "none"),
    queryFn: () => apiFetch<{ owner: import("@carres/shared/payment-collection-owner").CollectionOwnerContextRow | null }>(
      `/api/finance/collection-owner?orderId=${encodeURIComponent(orderId ?? "")}`,
    ),
    enabled: enabled && !!orderId,
    staleTime: 15_000,
  });
}

/** The order's recorded collection results (0446) — promises, disputes,
 *  no-answers — read by Communication History so a cover or a new owner
 *  sees every earlier conversation before contacting the customer. */
export function useCollectionOutcomes(invoiceId: string | null | undefined) {
  return useQuery({
    queryKey: ["finance", "collection-outcomes", invoiceId ?? "none"],
    queryFn: () => apiFetch<{ outcomes: Array<import("@carres/shared/payment-collection-outcome").CollectionOutcomeRow & {
      recorded_by_user?: { name: string | null } | null;
    }> }>(`/api/finance/invoices/${encodeURIComponent(invoiceId ?? "")}/collection-outcomes`),
    enabled: !!invoiceId,
    staleTime: 15_000,
  });
}

export function usePaymentSettings() {
  return useQuery({
    queryKey: qk.finance.paymentSettings(),
    queryFn: () => apiFetch<PaymentSettingsPayload>("/api/finance/payment-settings"),
  });
}



export function useFinanceRefunds(
  filters?: FinanceRefundsFilters,
  opts?: Partial<UseQueryOptions<FinanceRefundRow[]>>,
) {
  return useQuery({
    queryKey: qk.finance.refunds(filters),
    queryFn: () => apiFetch<FinanceRefundRow[]>(`/api/finance/refunds${toFinanceRefundsSearch(filters)}`),
    staleTime: 30_000,
    ...opts,
  });
}

export function useTopupApprove(
  opts?: Partial<UseMutationOptions<FinancePaymentRow, ApiError, FinanceTopupApproveInput>>,
) {
  const qc = useQueryClient();
  return useMutation<FinancePaymentRow, ApiError, FinanceTopupApproveInput>({
    mutationFn: (input) =>
      apiFetch<FinancePaymentRow>("/api/finance/payments/topup-approve", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      // Approval row decided + payment row inserted + deposit_balance bumped.
      // Invalidate everything that depends on these.
      await qc.invalidateQueries({ queryKey: ["finance"] });
      await qc.invalidateQueries({ queryKey: ["principal", "approvals"] });
      await qc.invalidateQueries({ queryKey: ["dealers"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

export function useRecordReceipt(
  opts?: Partial<UseMutationOptions<FinancePaymentRow, ApiError, FinanceRecordReceiptInput>>,
) {
  const qc = useQueryClient();
  return useMutation<FinancePaymentRow, ApiError, FinanceRecordReceiptInput>({
    mutationFn: (input) =>
      apiFetch<FinancePaymentRow>("/api/finance/payments/order-receipt", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      // A new order_payments row: both registers and Outstanding move.
      await qc.invalidateQueries({ queryKey: ["finance"] });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}








// ---------------------------------------------------------------------------
// Phase 6 — Supplier namespace. Mirrors finance pattern: typed row interfaces
// + 4 GET query hooks + 4 POST mutation hooks. Mutations invalidate the
// relevant qk.supplier.* keys to keep dashboard counts + PO lists in sync.
// ---------------------------------------------------------------------------

export type SupplierBucket = "po" | "ready" | "delivered";

export type SupplierSupStatus =
  | "pending"
  | "acknowledged"
  | "in_production"
  | "ready_for_pickup"
  | "ready_confirm_sent"
  // 0090 sofa flow (Loo 2026-05-11): partner WH owner confirmed receive;
  // supplier now self-dispatches.
  | "partner_confirmed"
  | "pickup_assigned"
  | "pickup_accepted"
  // 2026-05-15 (Task 14): migration 0107 per-thread pickup introduces this
  // intermediate state — some but not all linked threads picked up. PO
  // remains "open" from forecast / pipeline / badge perspectives. Filter
  // audit landed `partially_shipped` in the `ready` bucket of
  // PIPELINE_BUCKETS (apps/api/src/routes/supplier/pos.ts).
  | "partially_shipped"
  | "shipped"
  | "picked_up"
  | "delivered"
  | "reassign_needed";

/** Mirror of `purchase_orders` row visible to a supplier (RLS-scoped to
 *  own supplier_id). Keep fields aligned with API response from
 *  GET /api/supplier/pos. */
export interface SupplierPoLine {
  id: string;
  sku: string;
  qty: number;
  received_qty: number;
  // 0073 cascade picker payload — bedframe={color,gap}, sofa={fabric_id,
  // fabric_name, fabric_surcharge}, mattress=null. Supplier sees this on
  // the PO card so they make the right version.
  attrs?: Record<string, unknown> | null;
}

export interface SupplierPoRow {
  id: string;
  so: number | null;
  supplier_id: string;
  warehouse_id: string;
  // 2026-05-10 (Loo) — was scalar `sku`/`qty` (read from dropped columns
  // post-0017) which always rendered blank. Now embeds the full line array
  // so the supplier card sums qty + lists every variant.
  lines: SupplierPoLine[];
  // 2026-05-11 (Loo migration 0091) — embed destination warehouse + owning
  // partner so the supplier card can render "send to X (owned by partner Y)"
  // — supplier self-delivers and needs to know where the goods go.
  warehouses: {
    id: string;
    name: string;
    address: string | null;
    kind: "own" | "operation_partner" | null;
    owning_partner_id: string | null;
    owner: { id: string; name: string; contact: string | null } | null;
  } | null;
  status: "open" | "received" | "cancelled";
  sup_status: SupplierSupStatus;
  delivery_partner_id: string | null;
  expected_ready_date: string | null;
  pickup_date: string | null;
  eta_date: string | null;
  customer_rejection: unknown;
  pay_status: "unpaid" | "scheduled" | "paid";
  do_number: string | null;
  placed_at: string;
  created_at: string;
  updated_at: string;
  // Task 6 server enrichment (apps/api/src/routes/supplier/pos.ts:120-150).
  // All optional so older callers / tests that mock without these still typecheck.
  //   customer_eta_min — min(orders.delivery_date) across linked threads
  //   urgency          — <7d critical · 7-13d urgent · >=14d normal · null if no threads
  //   behind_schedule  — true when PO.eta_date is at/after customer_eta_min
  //   sku_summary      — deduped [{sku, qty}] from lines for compact card render
  customer_eta_min?: string | null;
  urgency?: "critical" | "urgent" | "normal" | null;
  behind_schedule?: boolean;
  sku_summary?: Array<{ sku: string; qty: number }>;
  // 2026-05-16 (migration 0114) — per-thread state counts that drive the
  // supplier kanban bucket placement + the "X of Y" card subtitle. Same PO
  // can land in `po` (producing > 0) AND `ready` (ready > 0) when partial.
  thread_state_counts?: {
    producing: number;
    ready: number;
    picked: number;
    total: number;
  };
  // 2026-05-17 (Loo screenshot) — per-thread enrichment server-side spliced
  // into the list response so the card body can list every linked SO with
  // its own customer ETA. `orders` is populated via supplier_orders_for_threads
  // RPC (0116) and is null for threads whose order RLS lookup misses.
  threads?: Array<{
    id: string;
    order_id: string;
    supplier_ready_at: string | null;
    pickup_event_id: string | null;
    orders: {
      so: number;
      customer_name: string;
      delivery_date: string | null;
    } | null;
  }>;
}

export interface SupplierProductRow {
  sku: string;
  category: string;
  model_key: string;
  variant: string;
  price: number;
  model: { name: string; blurb: string | null } | null;
}

/** GET /api/supplier/activity row — closes phase-6-supplier-recent-activity.
 *  RLS-scoped via po_history_read (0002:256); supplier sees only own rows. */
export interface SupplierActivityRow {
  id:          string;
  po_id:       string;
  text:        string;
  by_role:     string | null;
  occurred_at: string;
}

/** GET /api/supplier/me payload — closes phase-6-supplier-me-endpoint.
 *  `kind` gates the PO action buttons (factory_pickup skips Acknowledge);
 *  `cat_covered` + `lead_time` + `contact_email` feed the Dashboard
 *  Coverage callout (proto:supplier-pages.jsx:184-195). */
export interface SupplierMe {
  id:             string;
  name:           string;
  kind:           "own_logistics" | "factory_pickup";
  cat_covered:    string[];
  lead_time:      string | null;
  contact:        string | null;
  contact_email:  string | null;
  slug:           string | null;
  portal_enabled: boolean;
}

export interface SupplierDemandRow {
  sku: string;
  /** mattress | bedframe | sofa, or null for accessories/services (hidden).
   *  Server-derived via resolve_demand_category (migration 0148). */
  category: "mattress" | "bedframe" | "sofa" | null;
  /** Formal commitment (already-issued PO lines) — the Commit bucket. */
  openQty: number;
  poCount: number;
  // 2026-05-10 (Loo) — pre-commit demand from active orders not yet POed —
  // the Forecast bucket. Fed by `supplier_pending_demand()` RPC; 0 means
  // nothing in the pipeline beyond what's already POed.
  pendingQty: number;
  pendingOrderCount: number;
}

/** Phase 7 Sprint 1 — partner_threads_to_deliver RPC payload.
 *  2026-05-13 (Loo): added `do_number` (migration 0099) so the POD upload
 *  dialog can auto-fill. 2026-05-13 (Loo, later): migration 0101 widens
 *  the RPC to also return delivered threads (last 30 days) + exposes
 *  `operation_stage` + `delivered_at` so the Deliveries kanban can show
 *  a Delivered column without a second query. */
export interface PartnerToDeliverRow {
  thread_id:             string;
  order_id:              string;
  po_id:                 string | null;
  customer_name:         string;
  customer_address:      string | null;
  customer_phone:        string | null;
  dispatched_at:         string;
  confirm_delivery_date: string | null;
  do_number:             string | null;
  /** 'dispatched' or 'delivered' — caller uses this to bucket into kanban columns */
  operation_stage:       "dispatched" | "delivered";
  /** populated for delivered rows only */
  delivered_at:          string | null;
}

export function usePartnerToDeliver(
  opts?: Partial<UseQueryOptions<PartnerToDeliverRow[], ApiError>>,
) {
  return useQuery<PartnerToDeliverRow[], ApiError>({
    queryKey: qk.partner.toDeliver(),
    queryFn: () => apiFetch<PartnerToDeliverRow[]>("/api/partner/pickups/to-deliver"),
    staleTime: 30_000,
    ...opts,
  });
}

/** Phase 7 — partner_attach_pod mutation. Caller passes threadId + podPath
 *  (the path returned by the prior sign-upload call) + DO number + optional
 *  note + signed bool. On success, blasts the partner namespace (toDeliver
 *  disappears, dashboard counts update).
 *
 *  Migration 0088 (Loo 2026-05-11): partner POD upload now matches the
 *  operation DOAttachModal field set so role-switching operators don't
 *  re-learn anything. RPC validates signed=true + doNumber ≥3 chars +
 *  podPath non-empty. */
export type AttachPodInput = {
  threadId:  string;
  podPath:   string;
  doNumber:  string;
  doNote?:   string;
  signed:    true;
  /** 0151 — REQUIRED customer e-signature: Storage path of the captured
   *  signature PNG + the receiving customer's typed name. */
  signaturePath: string;
  signerName:    string;
};
export function useAttachPod(
  opts?: Partial<UseMutationOptions<unknown, ApiError, AttachPodInput>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, AttachPodInput>({
    mutationFn: ({ threadId, podPath, doNumber, doNote, signed, signaturePath, signerName }) =>
      apiFetch(`/api/partner/pod/${threadId}/attach`, {
        method: "POST",
        body: JSON.stringify({ podPath, doNumber, doNote, signed, signaturePath, signerName }),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["partner"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

// ---------------------------------------------------------------------------
// BD namespace (2026-07-19) — the BD POS: network dealer stats + audit-log
// activity + the dealer-account create door. The Phase-8 Inquiries hooks died
// with the ERP-style BD portal (API route kept — restore a panel if ever
// needed).
// ---------------------------------------------------------------------------

/** Row shape of GET /api/bd/dealers (dealers_with_stats_list — all-time). */
export interface BdDealerRow {
  id: string;
  name: string;
  region: string | null;
  contact: string | null;
  status: string;
  joinedDate: string | null;
  orderCount: number;
  gmv: number;
  outstanding: number;
  /** 'showroom' = one of Carres' own stores; 'dealer' = external reseller.
   *  BD's on-behalf store picker groups by it (Loo 2026-07-19). */
  channel: StoreChannel;
}

export function useBdDealers(
  opts?: Partial<UseQueryOptions<{ dealers: BdDealerRow[] }, ApiError>>,
) {
  return useQuery<{ dealers: BdDealerRow[] }, ApiError>({
    queryKey: qk.bd.dealers(),
    queryFn: () => apiFetch<{ dealers: BdDealerRow[] }>("/api/bd/dealers"),
    staleTime: 30_000,
    ...opts,
  });
}

/** Row shape of GET /api/bd/dealers/activity (dealer-touching audit_log). */
export interface BdActivityRow {
  id: string;
  role: string;
  actor: string | null;
  action: string;
  dealerId: string | null;
  dealerName: string | null;
  occurredAt: string;
}

export function useBdActivity(
  limit = 12,
  opts?: Partial<UseQueryOptions<{ rows: BdActivityRow[] }, ApiError>>,
) {
  return useQuery<{ rows: BdActivityRow[] }, ApiError>({
    queryKey: qk.bd.activity(limit),
    queryFn: () => apiFetch<{ rows: BdActivityRow[] }>(`/api/bd/dealers/activity?limit=${limit}`),
    staleTime: 30_000,
    ...opts,
  });
}

/** POST /api/bd/accounts — BD opens a DEALER account (principal-parity door,
 *  role pinned to dealer server-side). */
export interface BdCreateAccountResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  dealerId: string | null;
}

export function useBdCreateAccount(
  opts?: Partial<UseMutationOptions<BdCreateAccountResponse, ApiError, CreateAccountInput>>,
) {
  const qc = useQueryClient();
  return useMutation<BdCreateAccountResponse, ApiError, CreateAccountInput>({
    mutationFn: (input) =>
      apiFetch<BdCreateAccountResponse>("/api/bd/accounts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["bd"] });
      await qc.invalidateQueries({ queryKey: ["staff"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

export function useSupplierMe(
  opts?: Partial<UseQueryOptions<SupplierMe, ApiError>>,
) {
  return useQuery<SupplierMe, ApiError>({
    queryKey: qk.supplier.me(),
    queryFn: () => apiFetch<SupplierMe>("/api/supplier/me"),
    staleTime: 5 * 60_000,
    ...opts,
  });
}

export function useSupplierActivity(
  limit?: number,
  opts?: Partial<UseQueryOptions<SupplierActivityRow[], ApiError>>,
) {
  return useQuery<SupplierActivityRow[], ApiError>({
    queryKey: qk.supplier.activity(limit),
    queryFn: () => {
      const path = limit
        ? `/api/supplier/activity?limit=${encodeURIComponent(limit)}`
        : "/api/supplier/activity";
      return apiFetch<SupplierActivityRow[]>(path);
    },
    staleTime: 30_000,
    ...opts,
  });
}

export function useSupplierPos(
  bucket?: SupplierBucket,
  opts?: Partial<UseQueryOptions<SupplierPoRow[], ApiError>>,
) {
  return useQuery<SupplierPoRow[], ApiError>({
    queryKey: qk.supplier.pos(bucket),
    queryFn: () => {
      const path = bucket
        ? `/api/supplier/pos?bucket=${encodeURIComponent(bucket)}`
        : "/api/supplier/pos";
      return apiFetch<SupplierPoRow[]>(path);
    },
    placeholderData: keepPreviousData,
    ...opts,
  });
}

export function useSupplierProducts(
  opts?: Partial<UseQueryOptions<SupplierProductRow[], ApiError>>,
) {
  return useQuery<SupplierProductRow[], ApiError>({
    queryKey: qk.supplier.products(),
    queryFn: () => apiFetch<SupplierProductRow[]>("/api/supplier/products"),
    ...opts,
  });
}

export function useSupplierDemand(
  opts?: Partial<UseQueryOptions<SupplierDemandRow[], ApiError>>,
) {
  return useQuery<SupplierDemandRow[], ApiError>({
    queryKey: qk.supplier.demand(),
    queryFn: () => apiFetch<SupplierDemandRow[]>("/api/supplier/products/demand"),
    ...opts,
  });
}

export function useAcknowledgePo(
  opts?: Partial<UseMutationOptions<unknown, ApiError, string>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (poId) =>
      apiFetch(`/api/supplier/pos/${poId}/acknowledge`, { method: "POST" }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["supplier"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

export function useStartProduction(
  opts?: Partial<UseMutationOptions<unknown, ApiError, string>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (poId) =>
      apiFetch(`/api/supplier/pos/${poId}/start-production`, { method: "POST" }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["supplier"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

export function useReadyForPickup(
  opts?: Partial<UseMutationOptions<unknown, ApiError, string>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (poId) =>
      apiFetch(`/api/supplier/pos/${poId}/ready-for-pickup`, { method: "POST" }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["supplier"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

type MarkDeliveredInput = {
  poId: string;
  doNumber: string;
  doFilePath: string;
  doNote?: string;
};
export function useMarkDelivered(
  opts?: Partial<UseMutationOptions<unknown, ApiError, MarkDeliveredInput>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, MarkDeliveredInput>({
    mutationFn: ({ poId, doNumber, doFilePath, doNote }) =>
      apiFetch(`/api/supplier/pos/${poId}/mark-delivered`, {
        method: "POST",
        body: JSON.stringify({ doNumber, doFilePath, doNote }),
      }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["supplier"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

// ---------------------------------------------------------------------------
// 2026-05-15 (Loo) — Supplier per-thread readiness + pickup batch hooks
// (Task 8 of supplier-thread-pickup-plan). The supplier marks individual
// threads ready (POST/DELETE /api/supplier/threads/:id/ready); partners or
// operation batch-pickup a set of ready threads on a PO (POST
// /api/partner/pickups/batch or POST /api/operation/pos/:poId/receive-threads).
// The reprint queries hit /api/pickup-events/:id/print for the bundled DO
// payload.
//
// NOTE: `/api/supplier/pos/:poId/threads` and
// `/api/supplier/pos/:poId/pickup-events` endpoints DO NOT EXIST yet — Task 10
// (per-thread checklist) adds `/threads`; Task 13 (DO reprint history) adds
// `/pickup-events`. The hooks below type-check now but will 404 at runtime
// until those tasks land. This is intentional scaffolding so feature work in
// Tasks 9/11/12 can call them.
// ---------------------------------------------------------------------------

/** Supplier marks a single thread ready for pickup. RPC returns the updated
 *  thread row + new `po_sup_status` so callers can show optimistic UI; the
 *  `noop` flag fires when the thread was already marked ready (idempotent). */
export function useMarkThreadReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      return apiFetch<{
        thread_id: string;
        supplier_ready_at: string | null;
        po_sup_status: string;
        noop?: boolean;
      }>(`/api/supplier/threads/${threadId}/ready`, { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier", "pos"] });
      qc.invalidateQueries({ queryKey: ["supplierThreads"] });
    },
  });
}

/** Supplier un-marks a thread ready (only allowed pre-pickup). RPC nulls
 *  `supplier_ready_at` and recomputes PO sup_status downward (last ready
 *  removed → drops back to `ready_for_pickup`/`in_production`). `noop` fires
 *  when the thread was already not-ready. */
export function useUnmarkThreadReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      return apiFetch<{
        thread_id: string;
        po_sup_status?: string;
        noop?: boolean;
      }>(`/api/supplier/threads/${threadId}/ready`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier", "pos"] });
      qc.invalidateQueries({ queryKey: ["supplierThreads"] });
    },
  });
}

/** Partner batch pickup — picks N ready threads on a PO in one DO. Server
 *  creates one `pickup_events` row + stamps every selected thread's
 *  `pickup_event_id`.
 *
 *  2026-05-16 (migration 0117) — `doNumber` + `doFilePath` are optional.
 *  Server auto-generates `DO-{poId}-{seq}` when omitted; the partner doesn't
 *  type a number for a doc they didn't issue. Response includes the final
 *  do_number so the UI can echo it back in a toast.
 */
export function usePartnerPickupBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      poId: string;
      threadIds: string[];
      doNumber?: string;
      doFilePath?: string;
      doNote?: string;
    }) => {
      return apiFetch<{
        pickup_event_id: string;
        thread_count: number;
        do_number: string;
        po_sup_status: string;
      }>("/api/partner/pickups/batch", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner"] });
      qc.invalidateQueries({ queryKey: ["pickupEvents"] });
      qc.invalidateQueries({ queryKey: ["supplierThreads"] });
    },
  });
}

/**
 * Partner marks a pickup event as "physically collected · departing factory".
 * Stamps po_pickup_events.departed_at = NOW() server-side. Drives the kanban
 * PO from SCHEDULED → IN TRANSIT (the middle of the proto-faithful 3-step
 * partner flow restored 2026-05-17 by migration 0119).
 */
export function usePartnerMarkPickupCollected() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      return apiFetch<{ event_id: string; departed_at: string }>(
        `/api/partner/pickups/events/${eventId}/collect`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner"] });
      qc.invalidateQueries({ queryKey: ["pickupEvents"] });
    },
  });
}

/** Thread list for a single PO. Used by the supplier PODrawer's per-thread
 *  checklist (Task 10). Each row is one `order_supplier_threads` row scoped
 *  to that PO, plus the SKU lines this thread is responsible for (derived
 *  from the `order_supplier_thread_lines` join). `pickup_event_id` is
 *  non-null when the thread has already been picked up.
 *
 *  Endpoint added by Task 10; this hook currently 404s until then. */
export type ThreadRow = {
  id: string;
  order_id: string;
  order_dl: number;
  customer_name: string;
  customer_delivery_date: string | null;
  supplier_ready_at: string | null;
  pickup_event_id: string | null;
  sku_lines: Array<{ sku: string; qty: number }>;
};

export function useSupplierThreadsForPo(poId: string | null) {
  return useQuery({
    queryKey: poId ? qk.supplierThreads.byPo(poId) : ["supplierThreads", "none"],
    queryFn: () => apiFetch<ThreadRow[]>(`/api/supplier/pos/${poId}/threads`),
    enabled: !!poId,
  });
}

/** Pickup events list for a single PO (history view). Used by the supplier
 *  PODrawer's "Past pickups" section + the reprint button.
 *  `ack_role` lets the UI label "Picked by partner" vs "Received by HQ".
 *
 *  Endpoint added by Task 13; this hook currently 404s until then. */
export type PickupEventRow = {
  id: string;
  do_number: string;
  picked_up_at: string;
  ack_role: "partner" | "operation";
  thread_count: number;
};

export function usePickupEventsForPo(poId: string | null) {
  return useQuery({
    queryKey: poId ? qk.pickupEvent.byPo(poId) : ["pickupEvents", "none"],
    queryFn: () => apiFetch<PickupEventRow[]>(`/api/supplier/pos/${poId}/pickup-events`),
    enabled: !!poId,
  });
}

/** Full pickup event payload for the print/reprint flow. Returns enough
 *  context to render the DO without a second round-trip: PO ID + ETA,
 *  supplier name, every thread in the event with customer + SKU lines.
 *
 *  Endpoint added by Task 13 (`/api/pickup-events/:id/print`). */
export type PickupEventPrintPayload = {
  event_id: string;
  do_number: string;
  do_file_path: string | null;
  do_note: string | null;
  picked_up_at: string;
  ack_role: "partner" | "operation";
  po_id: string;
  po_eta_date: string | null;
  supplier_name: string;
  threads: Array<{
    thread_id: string;
    order_id: string;
    order_dl: number;
    customer_name: string;
    customer_delivery_date: string | null;
    sku_lines: Array<{ sku: string; qty: number }>;
  }>;
};

export function usePickupEventPrint(eventId: string | null) {
  return useQuery({
    queryKey: eventId ? qk.pickupEvent.print(eventId) : ["pickupEvent", "none"],
    queryFn: () => apiFetch<PickupEventPrintPayload>(`/api/pickup-events/${eventId}/print`),
    enabled: !!eventId,
  });
}

// ---------------------------------------------------------------------------
// 0074 catalog admin mutations (Loo 2026-05-09 Q2=c). Each mutation
// invalidates qk.catalog() so the public bundle picks up the change on the
// next consumer mount (Create-PO modal, dealer wizard, etc.).
// ---------------------------------------------------------------------------

function catalogJson(method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown) {
  return {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

export function useCreateCatalogModel() {
  const qc = useQueryClient();
  return useMutation({
    // 0659: the body may name the Finance item group the product starts in;
    // `itemGroupRefused` says why it did not (the product is made either way).
    mutationFn: (input: ProductModelCreateBody) =>
      apiFetch<{ model: ProductModelDto; itemGroupRefused?: string }>("/api/catalog/models", catalogJson("POST", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function usePatchCatalogModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProductModelPatchInput }) =>
      apiFetch<{ model: ProductModelDto }>(`/api/catalog/models/${id}`, catalogJson("PATCH", patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useCreateCatalogSku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductSkuCreateInput) =>
      apiFetch<{ sku: ProductSkuDto }>("/api/catalog/skus", catalogJson("POST", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function usePatchCatalogSku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProductSkuPatchInput }) =>
      apiFetch<{ sku: ProductSkuDto }>(`/api/catalog/skus/${id}`, catalogJson("PATCH", patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteCatalogSku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/skus/${id}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

// 2990s Products parity Phase 1 — bulk SKU import. Sends the staged + validated
// rows; the server resolves/creates models, upserts SKUs (blank=preserve), and
// returns a per-row result. Invalidates the catalog bundle on success.
export function useImportSkus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: SkuImportRow[]) =>
      apiFetch<SkuImportResult>("/api/catalog/import-skus", catalogJson("POST", { rows })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/** 0492 (Card 15) — the loan offer conversation, newest first. */
export function useLoanOffers(orderId: string | null) {
  return useQuery({
    queryKey: ["operation", "orders", orderId ?? "null", "loan-offers"] as const,
    queryFn: () => apiFetch<{ offers: LoanOfferView[] }>(`/api/operation/orders/${orderId}/loan-offers`),
    enabled: !!orderId,
    staleTime: 10_000,
  });
}

// 0181 — Special Add-ons CRUD (principal-only on the server; the catalog bundle
// invalidates so the Maintenance tab + per-model attach + POS picker all refresh).
export function useCreateSpecialAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SpecialAddonCreateInput) =>
      apiFetch<{ specialAddon: SpecialAddonDto }>("/api/catalog/special-addons", catalogJson("POST", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function usePatchSpecialAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SpecialAddonPatchInput }) =>
      apiFetch<{ specialAddon: SpecialAddonDto }>(`/api/catalog/special-addons/${id}`, catalogJson("PATCH", patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteSpecialAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/special-addons/${id}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

// 0182→0201 — Global option pools. Curated reference lists (sizes / heights /
// gaps / supplier categories) rendered by the Maintenance + Special Add-ons
// sidebar panels. Not a source of truth for any order-side consumer — sizes
// only SUGGEST in the per-model size picker; product_models.allowed_options
// stays authoritative. 0201 replaced the per-row CRUD hooks with ONE batch
// save (Edit-mode draft → PUT replaces the pool + appends a history snapshot
// atomically via the catalog_pool_batch_save RPC). Principal-only at the
// API/RLS layer; the UI gate in PoolPanel is a friendly read-only veneer.
export function useBatchSaveOptionPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pool, input }: { pool: CatalogOptionPoolName; input: CatalogPoolBatchSaveInput }) =>
      apiFetch<{ ok: true }>(`/api/catalog/option-pools/${pool}`, catalogJson("PUT", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/** 0201 — the History dialog's snapshot log for one pool (newest first). Only
 *  fetched while the dialog is open (`enabled`); rides the ["catalog"] prefix
 *  so every pool save refreshes it. */
export function useCatalogConfigHistory(section: CatalogOptionPoolName, enabled: boolean) {
  return useQuery({
    queryKey: qk.catalogConfigHistory(section),
    queryFn: () =>
      apiFetch<{ history: CatalogConfigHistoryDto[] }>(
        `/api/catalog/config-history?section=${section}`,
      ),
    enabled,
    staleTime: 60_000,
  });
}

/** 0202 — atomic replace-all save of the global fabric master (the Fabrics tab
 *  Edit draft). Appends a section='fabrics' history snapshot server-side
 *  (catalog_fabrics_batch_save RPC). Principal-only at the API/RLS layer. */
export function useBatchSaveCatalogFabrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CatalogFabricsBatchSaveInput) =>
      apiFetch<{ ok: true }>("/api/catalog/fabrics", catalogJson("PUT", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}


/** 0202 — the Fabrics History dialog's snapshot log (newest first). Rides the
 *  ["catalog"] prefix so every fabric save refreshes it. */
export function useCatalogFabricsHistory(enabled: boolean) {
  return useQuery({
    queryKey: qk.catalogConfigHistory("fabrics"),
    queryFn: () =>
      apiFetch<{ history: CatalogFabricsHistoryDto[] }>("/api/catalog/fabrics/history"),
    enabled,
    staleTime: 60_000,
  });
}

// 0176 — Alias so callers can use the Task-5 brief's naming convention.
// Both names are exported; the underlying hook is the same.

// ---------------------------------------------------------------------------
// 0179 — sofa combos (sofa engine Phase 2). Slots = ordered OR-sets of
// compartment codes; prices_by_height matrix per SOFA_HEIGHTS. Three CRUD
// mutations mirroring the 0177 combo hooks: POST creates, PATCH replaces
// fields, DELETE soft-deletes (active=false + discontinued_at). Principal-only
// at the API/RLS layer (sofa_combo_pricing_write_principal); the UI gate in
// ProductModelDrawer's Sofa Combos panel is a friendly read-only veneer. Each
// invalidates the whole `['catalog']` tree so the admin bundle re-fetches (sofa
// combos ride in the bundle — no dedicated query key needed).
// ---------------------------------------------------------------------------

export function useCreateSofaCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SofaComboCreateInput) =>
      apiFetch<{ sofaCombo: SofaComboDto }>("/api/catalog/sofa-combos", catalogJson("POST", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useUpdateSofaCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SofaComboPatchInput }) =>
      apiFetch<{ sofaCombo: SofaComboDto }>(`/api/catalog/sofa-combos/${id}`, catalogJson("PATCH", patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteSofaCombo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/sofa-combos/${id}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

// 0178 — sofa compartment pool + per-model offered (sofa engine Phase 1). CRUD
// hooks mirroring the sofa-fabric / combo hooks; all invalidate ['catalog'] so
// the admin bundle re-fetches. Principal-only at the API/RLS layer; the UI gate
// in the maintenance page is a friendly read-only veneer.
export function useCreateSofaCompartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SofaCompartmentCreateInput) =>
      apiFetch<{ compartment: SofaCompartmentDto }>("/api/catalog/sofa-compartments", catalogJson("POST", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useUpdateSofaCompartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SofaCompartmentPatchInput }) =>
      apiFetch<{ compartment: SofaCompartmentDto }>(`/api/catalog/sofa-compartments/${id}`, catalogJson("PATCH", patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteSofaCompartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/sofa-compartments/${id}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useUpsertModelSofaCompartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      modelId,
      compartmentId,
      input,
    }: {
      modelId: string;
      compartmentId: string;
      input: ModelSofaCompartmentInput;
    }) =>
      apiFetch<{ modelSofaCompartment: ModelSofaCompartmentDto }>(
        `/api/catalog/models/${modelId}/compartments/${compartmentId}`,
        catalogJson("PUT", input),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/** Offer MANY compartments on a model in one go (the New-SKU sofa flow — Loo
 *  2026-07-06). Each offer is the same idempotent principal-only PUT the drawer
 *  uses (the server auto-syncs the `{MODEL_KEY}-{code}` SKU per offer). One
 *  failing compartment does NOT abort the rest — failures are collected and
 *  returned so the caller can retry just those — and the catalog invalidates
 *  ONCE at the end instead of once per compartment. */
export function useOfferModelCompartments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      modelId,
      compartmentIds,
      supplierId,
      supplierCodes,
      stockIdentityMode,
    }: {
      modelId: string;
      compartmentIds: string[];
      /** 0442 — the stock identity mode every offered compartment SKU is
       *  minted with (a sofa module is a traceable piece by default). */
      stockIdentityMode?: "exact_unit" | "quantity";
      /* An explicit pick wins outright (2026-08-26) — the server's one
       * precedence is explicit → sibling inherit → category cover, so every
       * compartment in the batch lands on the supplier the keyer chose. */
      supplierId?: string;
      /* ⭐ The supplier's own code per compartment (2026-08-24), keyed by
       * compartmentId. This loop already sends one request per compartment, so
       * a per-piece code costs nothing extra: it rides the request that
       * compartment was making anyway. An absent entry sends nothing, which
       * the server reads as "leave the existing code alone". */
      supplierCodes?: Record<string, string>;
    }) => {
      const failed: { compartmentId: string; message: string }[] = [];
      for (const compartmentId of compartmentIds) {
        try {
          const code = supplierCodes?.[compartmentId]?.trim();
          await apiFetch<{ modelSofaCompartment: ModelSofaCompartmentDto }>(
            `/api/catalog/models/${modelId}/compartments/${compartmentId}`,
            catalogJson("PUT", {
              ...(supplierId ? { supplierId } : {}),
              ...(code ? { supplierCode: code } : {}),
              ...(stockIdentityMode ? { stockIdentityMode } : {}),
            }),
          );
        } catch (e) {
          failed.push({
            compartmentId,
            message: e instanceof ApiError ? e.message : "offer failed",
          });
        }
      }
      return { offered: compartmentIds.length - failed.length, failed };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteModelSofaCompartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, compartmentId }: { modelId: string; compartmentId: string }) =>
      apiFetch<{ ok: true }>(
        `/api/catalog/models/${modelId}/compartments/${compartmentId}`,
        catalogJson("DELETE"),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/** Compartment photo (signed-upload flow in photo-upload.ts — principal-only).
 *  Lands in `sofa_compartments.icon_url`; the builder silhouettes prefer it. */
export function useSetCompartmentPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ compartmentId, file }: { compartmentId: string; file: Blob }) =>
      uploadCompartmentPhoto(compartmentId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteCompartmentPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (compartmentId: string) =>
      apiFetch<{ compartment: SofaCompartmentDto }>(
        `/api/catalog/sofa-compartments/${compartmentId}/photo`,
        catalogJson("DELETE"),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/**
 * PATCH /api/catalog/fabric-tier-config — update the global tier deltas
 * (sofaTier2Delta / sofaTier3Delta). Principal-only at the RLS layer.
 * Invalidates the whole `['catalog']` tree so the admin bundle re-fetches.
 */
export function useUpdateFabricTierConfig(
  opts?: Partial<UseMutationOptions<{ fabricTierConfig: FabricTierConfigDto }, ApiError, FabricTierConfigDto>>,
) {
  const qc = useQueryClient();
  return useMutation<{ fabricTierConfig: FabricTierConfigDto }, ApiError, FabricTierConfigDto>({
    mutationFn: (input) =>
      apiFetch<{ fabricTierConfig: FabricTierConfigDto }>(
        "/api/catalog/fabric-tier-config",
        catalogJson("PATCH", input),
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["catalog"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/**
 * PUT /api/catalog/model-fabric-tier-override/:modelId — upsert a per-model
 * tier delta override. Pass `tier2Delta: null` / `tier3Delta: null` to revert
 * that tier's delta to the global config. Principal-only at the RLS layer.
 * Invalidates the whole `['catalog']` tree.
 */
export function useUpsertModelFabricTierOverride(
  opts?: Partial<
    UseMutationOptions<
      { override: ModelFabricTierOverrideDto },
      ApiError,
      { modelId: string; tier2Delta: number | null; tier3Delta: number | null }
    >
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    { override: ModelFabricTierOverrideDto },
    ApiError,
    { modelId: string; tier2Delta: number | null; tier3Delta: number | null }
  >({
    mutationFn: ({ modelId, tier2Delta, tier3Delta }) =>
      apiFetch<{ override: ModelFabricTierOverrideDto }>(
        `/api/catalog/model-fabric-tier-override/${modelId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier2Delta, tier3Delta }),
        },
      ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["catalog"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

// ---------------------------------------------------------------------------
// 0169-0173 — Product & Maintenance mutations (Modular + Maintenance tabs).
// Each invalidates ['catalog'] so the admin bundle + every consumer
// (dealer wizard, Create-PO) re-reads on the next mount.
// ---------------------------------------------------------------------------

/** Modular "active sizes" cascade — writes allowed_options.sizes AND flips
 *  pos_active across the model's size SKUs (in-set on, others off). Never
 *  touches discontinued_at. */
export function useToggleSizesActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, input }: { modelId: string; input: SizesActiveInput }) =>
      apiFetch<{ ok: true; sizes: string[] }>(
        `/api/catalog/models/${modelId}/sizes-active`,
        catalogJson("PATCH", input),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/** Materialize one SKU per variant (from allowed_options.sizes or an explicit
 *  list). Idempotent — existing codes are skipped server-side. */
export function useGenerateSkus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, input }: { modelId: string; input: GenerateSkusInput }) =>
      apiFetch<{ ok: true; generated: number; skipped: number }>(
        `/api/catalog/models/${modelId}/generate-skus`,
        catalogJson("POST", input),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/** Photo upload (signed-upload flow in photo-upload.ts). Takes the raw File;
 *  the helper shrinks → signs → uploads → stores → returns the updated model. */
export function useSetModelPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, file }: { modelId: string; file: Blob }) =>
      uploadModelPhoto(modelId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteModelPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) =>
      apiFetch<{ model: ProductModelDto }>(
        `/api/catalog/models/${modelId}/photo`,
        catalogJson("DELETE"),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/** Delivery-fee singleton (floor_config, id=1). Principal-only server-side
 *  (floor_write_principal) — the Maintenance editor UI-gates to principal. */
export function usePatchFloorConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FloorConfigPatchInput) =>
      apiFetch<{ floorConfig: FloorConfigDto }>(
        "/api/catalog/floor-config",
        catalogJson("PATCH", input),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

// ---------------------------------------------------------------------------
// 0184 — delivery TRIP fee (2990s Products parity Phase 6). The principal-owned
// config singleton + per-RuleTarget special overrides. All four mutations
// invalidate the ['catalog'] tree so the bundle (Maintenance + the POS preview)
// re-reads. Principal-only on the server (RLS + API gate); the Maintenance UI
// gate is a friendly read-only veneer. The floor STAIR surcharge stays separate.
// ---------------------------------------------------------------------------

/** PATCH /api/catalog/delivery-fee-config — update the singleton (base/cross
 *  fee, charged categories, lead days). Principal-only on the server. */
export function useUpdateDeliveryFeeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeliveryFeeConfigPatchInput) =>
      apiFetch<{ deliveryFeeConfig: DeliveryFeeConfigDto }>(
        "/api/catalog/delivery-fee-config",
        catalogJson("PATCH", input),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useCreateSpecialDeliveryFeeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SpecialDeliveryFeeRuleInput) =>
      apiFetch<{ specialDeliveryFeeRule: SpecialDeliveryFeeRuleDto }>(
        "/api/catalog/special-delivery-fee-rules",
        catalogJson("POST", input),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useUpdateSpecialDeliveryFeeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SpecialDeliveryFeeRuleInput> }) =>
      apiFetch<{ specialDeliveryFeeRule: SpecialDeliveryFeeRuleDto }>(
        `/api/catalog/special-delivery-fee-rules/${id}`,
        catalogJson("PATCH", patch),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteSpecialDeliveryFeeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/special-delivery-fee-rules/${id}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

// ---------------------------------------------------------------------------
// 0185 — Default Free Gifts (per model) + Free Item Campaigns (2990s Products
// parity Phase 7, GWP). Principal-only on the server (RLS + API gate); the
// Maintenance UI gate is a friendly read-only veneer. Every mutation invalidates
// the ['catalog'] tree so the bundle (Promo tab + the POS preview resolver)
// re-reads. Free lines book as RM0 order_lines with attrs markers — the order
// submit pipeline (create_order / order_lines / DraftLine) is untouched.
// ---------------------------------------------------------------------------

/** PUT /api/catalog/model-free-gifts/:modelId — REPLACE a model's whole gift
 *  set (an empty `gifts` clears it server-side). Principal-only on the server. */
export function useUpsertModelFreeGifts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, input }: { modelId: string; input: ModelDefaultFreeGiftsInput }) =>
      apiFetch<{ modelDefaultFreeGifts: ModelDefaultFreeGiftsDto }>(
        `/api/catalog/model-free-gifts/${modelId}`,
        catalogJson("PUT", input),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

/** DELETE /api/catalog/model-free-gifts/:modelId — drop a model's gift config
 *  (idempotent; a missing row is a no-op). Principal-only on the server. */
export function useDeleteModelFreeGifts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/model-free-gifts/${modelId}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useCreateFreeItemCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FreeItemCampaignInput) =>
      apiFetch<{ freeItemCampaign: FreeItemCampaignDto }>(
        "/api/catalog/free-item-campaigns",
        catalogJson("POST", input),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useUpdateFreeItemCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<FreeItemCampaignInput> }) =>
      apiFetch<{ freeItemCampaign: FreeItemCampaignDto }>(
        `/api/catalog/free-item-campaigns/${id}`,
        catalogJson("PATCH", patch),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteFreeItemCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/free-item-campaigns/${id}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

// ---------------------------------------------------------------------------
// 0186 — PWP / Promo rules (2990s Products parity Phase 8a). Principal-only on
// the server (RLS + API gate); the Maintenance UI gate is a friendly read-only
// veneer. Every mutation invalidates the ['catalog'] tree so the bundle (Promo
// tab + the POS preview resolver) re-reads. DORMANT — no order-path consumer in
// P8a; the rule pairs a trigger category/target with a reward category/target,
// and the reward PRICE lives on product_skus.pwpPrice / sofa_combo_pricing
// .pwpPricesByHeight (separate principal-locked write paths).
// ---------------------------------------------------------------------------

export function useCreatePwpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PwpRuleInput) =>
      apiFetch<{ pwpRule: PwpRuleDto }>("/api/catalog/pwp-rules", catalogJson("POST", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useUpdatePwpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<PwpRuleInput> }) =>
      apiFetch<{ pwpRule: PwpRuleDto }>(`/api/catalog/pwp-rules/${id}`, catalogJson("PATCH", patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeletePwpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/pwp-rules/${id}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

// ---------------------------------------------------------------------------
// 0239 — Product bundles (bundle pricing). Principal-only CRUD from the
// Promo/GWP tab; every mutation invalidates ["catalog"] so the tab list + the
// POS bundle cards re-read. Mirrors the 0186 pwp-rule hooks.
// ---------------------------------------------------------------------------

export function useCreateBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductBundleInput) =>
      apiFetch<{ bundle: ProductBundleDto }>("/api/catalog/bundles", catalogJson("POST", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useUpdateBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ProductBundleInput> }) =>
      apiFetch<{ bundle: ProductBundleDto }>(`/api/catalog/bundles/${id}`, catalogJson("PATCH", patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/bundles/${id}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useCreateAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddonCreateInput) =>
      apiFetch<{ addon: AddonDto }>("/api/catalog/addons", catalogJson("POST", input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function usePatchAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: AddonPatchInput }) =>
      apiFetch<{ addon: AddonDto }>(`/api/catalog/addons/${key}`, catalogJson("PATCH", patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useDeleteAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<{ ok: true }>(`/api/catalog/addons/${key}`, catalogJson("DELETE")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

// ─── Phase B — Order annotations + activity timeline ─────────────────────────

export type AnnotationTag = "follow_up" | "escalate" | "resolved";

export interface AddAnnotationInput {
  orderId: string;
  content: string;
  tag?: AnnotationTag | null;
}

/* ── 0247-0249 · Rental + Service Plan base (Loo 2026-07-25) ─────────────────
 * Config (service packages + rent-to-own plans, authored in the P&M Rental
 * tab, principal-only server-side) and the read-only registry (agreements +
 * deployed units) for the internal Rental page. Every config mutation blasts
 * the ["rental"] sub-tree. */

export interface RentalConfigResponse {
  servicePackages: ServicePackage[];
  rentalPlans: RentalPlan[];
  /** 0264 — the offer layer: one offer per model, its outright prices and the
   *  service packages it attaches. Absent on a pre-0264 API (defaults []). */
  rentalOffers?: RentalOffer[];
  buyPrices?: RentalBuyPrice[];
  offerServices?: RentalOfferService[];
  /** 0267 — the agreement wording, newest version of each document first. */
  agreementTemplates?: RentalAgreementTemplate[];
}

/** Agreements list item — the API embeds the customer's name/phone. */
export type RentalAgreementListItem = RentalAgreement & {
  customerName: string | null;
  customerPhone: string | null;
  /**
   * Unresolved refused-card attempts (0295). `undefined` means the API could
   * not answer — an older Worker, or the read failed — and the list says
   * nothing rather than claiming a clean card. 0 means genuinely none.
   */
  openDeclines?: number;
  lastDeclineAt?: string | null;
};

export function useRentalConfig(opts?: Partial<UseQueryOptions<RentalConfigResponse>>) {
  return useQuery({
    queryKey: qk.rental.config(),
    queryFn: () => apiFetch<RentalConfigResponse>("/api/rental/config"),
    staleTime: 60_000,
    ...opts,
  });
}

export function useRentalAgreements(
  opts?: Partial<UseQueryOptions<{ agreements: RentalAgreementListItem[] }>>,
) {
  return useQuery({
    queryKey: qk.rental.agreements(),
    queryFn: () =>
      apiFetch<{ agreements: RentalAgreementListItem[] }>("/api/rental/agreements"),
    staleTime: 30_000,
    ...opts,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 0268 — the Approver gate. A rent-to-own agreement is born `pending_approval`
// and materialises nothing (no billing schedule, no asset, no entitlement, and
// no chargeable Stripe checkout) until finance decides. This is that desk.
// ─────────────────────────────────────────────────────────────────────────────

/** One row of `rental_pending_approvals()` — an application awaiting credit
 *  assessment, plus the particulars a human needs to judge it. */
export interface RentalApproval {
  id: string;
  agreementNo: string;
  status: string;
  sku: string;
  termMonths: number;
  monthlyFee: number;
  oneOffTotal: number;
  /** monthlyFee × termMonths — the credit this one decision extends. */
  termTotal: number;
  startDate: string;
  createdAt: string;
  notes: string | null;
  /** 0279 — the signature, captured at the counter and stamped by
   *  `create_rental_agreement`. Every application created from 0279 onward
   *  carries one (approve now REFUSES an unsigned row), but these stay nullable:
   *  a row created before 0279 has none, and the page must be able to say so
   *  rather than imply a signature exists. `templateVersion` is what makes it
   *  evidence — it names the exact wording the customer agreed to. */
  signedAt: string | null;
  signedName: string | null;
  signedNric: string | null;
  signaturePath: string | null;
  signedDocPath: string | null;
  templateVersion: number | null;
  /** The CBM hook's landing strip — planned, not built. */
  creditCheckedAt: string | null;
  creditReference: string | null;
  orderId: string | null;
  orderSo: number | null;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  dealer: { id: string; name: string; channel: string | null } | null;
  salesperson: { id: string; name: string } | null;
}

export function useRentalApprovals(
  opts?: Partial<UseQueryOptions<{ approvals: RentalApproval[] }>>,
) {
  return useQuery({
    queryKey: qk.rental.approvals(),
    queryFn: () => apiFetch<{ approvals: RentalApproval[] }>("/api/rental/approvals"),
    staleTime: 15_000,
    ...opts,
  });
}

/** 0538 — due, collected, outstanding and the unpaid months for one month (YYYY-MM). */
export function useRentalMonth(month: string) {
  return useQuery({
    queryKey: qk.rental.month(month),
    queryFn: () =>
      apiFetch<{ month: string } & import("@carres/shared").RentalMonthView>(
        `/api/rental/month?month=${encodeURIComponent(month)}`,
      ),
    staleTime: 15_000,
  });
}

/** Approve or reject one application. Blasts the whole ["rental"] sub-tree:
 *  an approval mints the schedule + asset + entitlement, so the agreements
 *  list and the unit registry are both stale the moment it lands. */
export function useDecideRentalAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string; approve: boolean; note?: string; creditCheck?: string; creditReference?: string;
    }) =>
      apiFetch<{ agreement: RentalAgreementListItem }>(
        `/api/rental/agreements/${v.id}/decide`,
        {
          method: "POST",
          body: JSON.stringify({
            approve: v.approve, note: v.note,
            creditCheck: v.creditCheck, creditReference: v.creditReference,
          }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rental"] });
    },
  });
}




export function useRentalUnits(
  opts?: Partial<UseQueryOptions<{ units: RentalStockUnit[] }>>,
) {
  return useQuery({
    queryKey: qk.rental.units(),
    queryFn: () => apiFetch<{ units: RentalStockUnit[] }>("/api/rental/units"),
    staleTime: 30_000,
    ...opts,
  });
}

function useRentalConfigMutation<TData, TVars>(
  mutationFn: (vars: TVars) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rental"] });
    },
  });
}

export function useCreateServicePackage() {
  return useRentalConfigMutation((input: ServicePackageInput) =>
    apiFetch<{ servicePackage: ServicePackage }>("/api/rental/service-packages", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export function usePatchServicePackage() {
  return useRentalConfigMutation(
    ({ id, patch }: { id: string; patch: Partial<ServicePackageInput> }) =>
      apiFetch<{ servicePackage: ServicePackage }>(`/api/rental/service-packages/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
  );
}

export function useDeleteServicePackage() {
  return useRentalConfigMutation((id: string) =>
    apiFetch<{ ok: boolean }>(`/api/rental/service-packages/${id}`, {
      method: "DELETE",
    }),
  );
}

export function useCreateRentalPlan() {
  return useRentalConfigMutation((input: RentalPlanInput) =>
    apiFetch<{ plan: RentalPlan }>("/api/rental/plans", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export function usePatchRentalPlan() {
  return useRentalConfigMutation(
    ({ id, patch }: { id: string; patch: Partial<RentalPlanInput> }) =>
      apiFetch<{ plan: RentalPlan }>(`/api/rental/plans/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
  );
}

export function useDeleteRentalPlan() {
  return useRentalConfigMutation((id: string) =>
    apiFetch<{ ok: boolean }>(`/api/rental/plans/${id}`, {
      method: "DELETE",
    }),
  );
}

/* ── 0264 · the offer layer (P&M Rental tab) ─────────────────────────────────
 * One offer per model owns the option/fabric price overlay, the surcharge
 * slots and the split; its money hangs off it as rent lines (rental_plans,
 * above) and buy prices, plus the service packages it attaches. Every write
 * invalidates the whole ["rental"] sub-tree like the rest of the config. */

export function useCreateRentalOffer() {
  return useRentalConfigMutation((input: RentalOfferInput) =>
    apiFetch<{ offer: RentalOffer }>("/api/rental/offers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export function usePatchRentalOffer() {
  return useRentalConfigMutation(({ id, patch }: { id: string; patch: RentalOfferPatchInput }) =>
    apiFetch<{ offer: RentalOffer }>(`/api/rental/offers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  );
}

export function useDeleteRentalOffer() {
  return useRentalConfigMutation((id: string) =>
    apiFetch<{ ok: boolean }>(`/api/rental/offers/${id}`, { method: "DELETE" }),
  );
}

export function useCreateRentalBuyPrice() {
  return useRentalConfigMutation(
    ({ offerId, input }: { offerId: string; input: RentalBuyPriceInput }) =>
      apiFetch<{ buyPrice: RentalBuyPrice }>(`/api/rental/offers/${offerId}/buy-prices`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  );
}

export function usePatchRentalBuyPrice() {
  return useRentalConfigMutation(
    ({ id, patch }: { id: string; patch: RentalBuyPricePatchInput }) =>
      apiFetch<{ buyPrice: RentalBuyPrice }>(`/api/rental/buy-prices/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
  );
}

export function useDeleteRentalBuyPrice() {
  return useRentalConfigMutation((id: string) =>
    apiFetch<{ ok: boolean }>(`/api/rental/buy-prices/${id}`, { method: "DELETE" }),
  );
}

export function useCreateRentalOfferService() {
  return useRentalConfigMutation(
    ({ offerId, input }: { offerId: string; input: RentalOfferServiceInput }) =>
      apiFetch<{ offerService: RentalOfferService }>(`/api/rental/offers/${offerId}/services`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  );
}

export function usePatchRentalOfferService() {
  return useRentalConfigMutation(
    ({ id, patch }: { id: string; patch: RentalOfferServicePatchInput }) =>
      apiFetch<{ offerService: RentalOfferService }>(`/api/rental/offer-services/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
  );
}

/** Author a NEW version of an agreement's wording (the version is server-
 *  assigned; a version already signed against is never edited). */
export function useCreateAgreementTemplate() {
  return useRentalConfigMutation((input: AgreementTemplateInput) =>
    apiFetch<{ template: RentalAgreementTemplate }>("/api/rental/agreement-templates", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

/** Patch what a version binds to / whether it is live — never its wording. */
export function usePatchAgreementTemplate() {
  return useRentalConfigMutation(
    ({ id, patch }: { id: string; patch: AgreementTemplatePatchInput }) =>
      apiFetch<{ template: RentalAgreementTemplate }>(`/api/rental/agreement-templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
  );
}

export function useDeleteRentalOfferService() {
  return useRentalConfigMutation((id: string) =>
    apiFetch<{ ok: boolean }>(`/api/rental/offer-services/${id}`, { method: "DELETE" }),
  );
}

/* ── 0255 · POS rental sell lane ─────────────────────────────────────────────
 * Store-side: the stripped offer list (rental_plans_pos — NO split fields),
 * the signup RPC and the Stripe subscription checkout pair. Principal-side:
 * the manual plan → Stripe sync retry. */

export interface RentalStripeSyncOutcome {
  status: "synced" | "skipped" | "error";
  message?: string;
}

export interface CreateRentalAgreementResponse {
  agreement: RentalAgreement;
  customer: Customer;
  /** NULL since 0268 — the unit is only allocated when finance approves, so a
   *  fresh signup has no asset yet. Same for the entitlement and its visits. */
  unit: RentalStockUnit | null;
  entitlementId: string | null;
  visitsTotal: number;
  /** 0268 — true while the application waits on the finance Approver page.
   *  Optional so a browser on this build against a pre-0268 Worker degrades
   *  rather than crashing. */
  pendingApproval?: boolean;
  /** 0275 — the Sales Order minted with the agreement, so the rented item has
   *  a document and a path into operations. Optional for the same reason. */
  orderId?: string | null;
  so?: number | null;
}

/**
 * The rental wording the customer is about to sign (0279).
 *
 * `rental_agreement_templates` is RLS internal-only, so a store JWT cannot read
 * the paper directly — this goes through the same definer function
 * `create_rental_agreement` uses to stamp `template_version`, which is what
 * keeps the document on screen and the version on the contract identical.
 *
 * `template: null` is a real answer: the principal has not published wording,
 * so no rental can be signed at all. The confirm step says that in words rather
 * than leaving the operator with a Complete button that always fails.
 */
export function useRentalAgreementTemplate(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.rental.agreementTemplate(),
    queryFn: () =>
      apiFetch<{ template: RentalAgreementTemplate | null }>("/api/rental/agreement-template"),
    staleTime: 60_000,
    enabled: opts?.enabled ?? true,
  });
}

/** One scheduled instalment and whatever money has landed on it (0281). */
export interface RentalCollectionRow {
  id: string;
  seq: number;
  dueDate: string;
  amountDue: number;
  status: string;
  paidAt: string | null;
  paidAmount: number | null;
  method: string | null;
  reference: string | null;
  supplierShare: number | null;
  commissionShare: number | null;
  stripeInvoiceId: string | null;
  lateInterest: number | null;
  /** Derived server-side from the date, never stored — so it cannot go stale. */
  late: boolean;
  /**
   * The most recent refused card attempt on this month (0295), or null. Derived
   * the same way `late` is, and only ever present on an UNPAID month — paying
   * is what clears it, so there is no flag to forget.
   *
   * Optional so a browser on this build talking to a pre-0295 Worker degrades
   * to "no decline shown" instead of crashing.
   */
  lastDecline?: { at: string; reason: string | null } | null;
  /** How many times the card was refused for this month. */
  declineCount?: number;
  /**
   * 0300 — the 8%/month penalty that HAS accrued on this month as of today.
   * Derived server-side, never stored, so it is never a day out of date.
   * Zero once the month is collected.
   */
  accruedInterest?: number;
  /** When the penalty above was last actually CHARGED, or null if never. */
  interestChargedAt?: string | null;
}

/** 0300 — what settling the whole thing today would cost. */
export interface RentalSettlementQuote {
  agreementNo: string;
  status: string;
  monthsLeft: number;
  rentRemaining: number;
  /** Interest already charged on those months — not accrued-but-uncharged. */
  interestCharged: number;
  total: number;
}

export interface RentalCollections {
  agreement: {
    id: string;
    agreementNo: string;
    sku: string;
    termMonths: number;
    monthlyFee: number;
    startDate: string;
    status: string;
    supplierRatePct: number;
    commissionBasePct: number;
  };
  totals: {
    contractValue: number;
    collected: number;
    outstanding: number;
    paidCount: number;
    lateCount: number;
    supplierShare: number;
    commissionShare: number;
    /** Unpaid months currently sitting on a refused card (0295). */
    declinedCount?: number;
    /** Refusals we could not attach to any month — always worth a human look. */
    unattachedDeclines?: number;
  };
  billings: RentalCollectionRow[];
  events: Array<Record<string, unknown>>;
}

/**
 * What has actually been collected on one agreement (0281).
 *
 * Before this, `rental_billings` had rows and no writer, so the only true
 * answer lived in the Stripe dashboard and finance had two systems, one of
 * which lied. Internal-only.
 */
export function useRentalCollections(agreementId: string | null) {
  return useQuery({
    queryKey: qk.rental.collections(agreementId ?? ""),
    queryFn: () => apiFetch<RentalCollections>(`/api/rental/agreements/${agreementId}/collections`),
    enabled: !!agreementId,
    staleTime: 15_000,
  });
}

/** Record a collection that never touched Stripe (bank transfer, cash). */
export function useRecordRentalPayment(agreementId: string) {
  const qc = useQueryClient();
  return useMutation<
    { recorded: unknown },
    ApiError,
    { seq: number } & RecordRentalPaymentInput
  >({
    mutationFn: ({ seq, ...body }) =>
      apiFetch<{ recorded: unknown }>(
        `/api/rental/agreements/${agreementId}/collections/${seq}/record`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rental"] }),
  });
}

/**
 * 0300 — charge the 8%/month penalty on one overdue month.
 *
 * No amount crosses the wire: the server recomputes it from the instalment and
 * the date. A client that could name the penalty could name any penalty.
 */
export function useChargeRentalInterest(agreementId: string) {
  const qc = useQueryClient();
  return useMutation<{ charged: unknown }, ApiError, { seq: number } & ChargeRentalInterestInput>({
    mutationFn: ({ seq, ...body }) =>
      apiFetch<{ charged: unknown }>(
        `/api/rental/agreements/${agreementId}/collections/${seq}/interest`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rental"] }),
  });
}

/** 0300 — the server's own figure for settling early. */
export function useRentalSettlementQuote(agreementId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.rental.settlementQuote(agreementId ?? ""),
    queryFn: () =>
      apiFetch<{ quote: RentalSettlementQuote }>(
        `/api/rental/agreements/${agreementId}/settlement-quote`,
      ),
    enabled: !!agreementId && enabled,
    staleTime: 15_000,
  });
}

/** 0300 — settle the remaining term in one payment. Needs the signed document. */
export function useSettleRentalAgreement(agreementId: string) {
  const qc = useQueryClient();
  return useMutation<{ settled: unknown }, ApiError, SettleRentalAgreementInput>({
    mutationFn: (body) =>
      apiFetch<{ settled: unknown }>(`/api/rental/agreements/${agreementId}/settle`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rental"] }),
  });
}

export function useRentalPosPlans(opts?: Partial<UseQueryOptions<{ plans: PosRentalPlan[] }>>) {
  return useQuery({
    queryKey: qk.rental.posPlans(),
    queryFn: () => apiFetch<{ plans: PosRentalPlan[] }>("/api/rental/pos-plans"),
    staleTime: 60_000,
    ...opts,
  });
}

export function useCreateRentalAgreement() {
  const qc = useQueryClient();
  return useMutation<CreateRentalAgreementResponse, ApiError, CreateRentalAgreementInput>({
    mutationFn: (input) =>
      apiFetch<CreateRentalAgreementResponse>("/api/rental/agreements", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rental"] }),
  });
}

/** Manual plan → Stripe sync retry (principal; the Rental tab's Sync button). */
export function useSyncRentalPlanStripe() {
  return useRentalConfigMutation((id: string) =>
    apiFetch<{ plan: RentalPlan; stripeSync: RentalStripeSyncOutcome }>(
      `/api/rental/plans/${id}/stripe-sync`,
      { method: "POST" },
    ),
  );
}





























// ---------------------------------------------------------------------------
// Guarantee packages (0261-0263)
// ---------------------------------------------------------------------------

/**
 * Every guarantee sold on one order — powers the "Guarantee" strip inside the
 * Customer block of BOTH order-detail surfaces (ops drawer + POS).
 *
 * The hook lives HERE rather than inside the strip on purpose: the strip is a
 * leaf that mounts inside drawers whose tests fully mock this module and
 * therefore never install a QueryClientProvider. A raw useQuery in the leaf
 * takes the whole drawer down in those tests; a hook here is stubbed with the
 * rest of the module.
 *
 * `retry: false` — the strip is silent-when-absent, so a failed read must
 * degrade to "no guarantee shown", never to a broken customer card.
 */
export function useOrderGuarantees(
  orderId: string,
  opts?: Partial<UseQueryOptions<GuaranteeListResponse>>,
) {
  return useQuery<GuaranteeListResponse>({
    queryKey: qk.guarantees.byOrder(orderId),
    queryFn: () => apiFetch<GuaranteeListResponse>(`/api/guarantees/order/${orderId}`),
    staleTime: 30_000,
    retry: false,
    ...opts,
  });
}

/**
 * Author a guarantee PRODUCT — model + SKU + terms in one server call (0270).
 *
 * A mutation hook rather than a bare apiFetch + useQueryClient inside the modal:
 * NewSkuModal's tests fully mock this module and install no QueryClientProvider,
 * so touching the client directly in the component takes the whole modal down.
 * Same rule as useOrderGuarantees — data access lives here.
 */
export function useCreateGuaranteeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GuaranteeProductInput) =>
      apiFetch<{ ok: true; sku: string; label: string; covers: string }>(
        "/api/guarantees/products",
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      // The catalog bundle carries models, skus AND guaranteeTerms — one blast.
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      void qc.invalidateQueries({ queryKey: ["guarantees"] });
    },
  });
}













/* ─── BR-7 — Finance holds a delivery from the Payment Record ────────────────
 * The two doors of `/api/finance/exceptions` (0355). The server gates both to
 * Finance and principal; clearing may issue the Delivery Order, so both
 * refresh the whole order family.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Every Finance exception on one order, newest first. */
export function useFinanceExceptions(orderId: string, enabled = true) {
  return useQuery({
    queryKey: ["operation", "orders", orderId, "finance-exceptions"] as const,
    queryFn: () => apiFetch<SalesOrderRouteFinanceException[]>(
      `/api/finance/exceptions/${encodeURIComponent(orderId)}`),
    enabled,
  });
}

/** Finance opens a hold. `reason` is required by the schema, RPC and table. */
export function useOpenFinanceException(
  orderId: string,
  opts?: Partial<UseMutationOptions<unknown, ApiError, { reason: string }>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { reason: string }>({
    mutationFn: ({ reason }) => apiFetch("/api/finance/exceptions/open", {
      method: "POST", body: JSON.stringify({ orderId, reason }),
    }),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["operation", "orders", orderId] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}

/** Finance lifts one hold, with the evidence that closed it. */
export function useClearFinanceException(
  orderId: string,
  opts?: Partial<UseMutationOptions<unknown, ApiError, { id: string; evidence: string }>>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { id: string; evidence: string }>({
    mutationFn: ({ id, evidence }) => apiFetch(
      `/api/finance/exceptions/${encodeURIComponent(id)}/clear`,
      { method: "POST", body: JSON.stringify({ evidence }) },
    ),
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ["operation", "orders", orderId] });
      // Clearing the last hold can issue the Delivery Order.
      await qc.invalidateQueries({ queryKey: ["operation", "delivery-orders"] });
      opts?.onSuccess?.(...(args as Parameters<NonNullable<typeof opts.onSuccess>>));
    },
  });
}







