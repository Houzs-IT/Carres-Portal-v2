import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  ShoppingBag,
  Boxes,
  Repeat,
  ArrowLeftRight,
  Wallet,
  BookOpen,
  Truck,
  Route,
  LifeBuoy,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  PackageCheck,
  Undo2,
  Scale,
  BarChart3,
  BadgeCheck,
  LayoutGrid,
  IdCard,
  Target,
  Users,
  Store,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  HandCoins,
  UserCheck,
  SlidersHorizontal,
  Receipt,
  ReceiptText,
  Banknote,
  CalendarClock,
  CalendarOff,
  CreditCard,
  Landmark,
  BookOpenText,
  Hourglass,
  TrendingUp,
  Home,
  ShoppingCart,
  Warehouse,
  Headset,
  ClipboardX,
  Handshake,
  MapPin,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@carres/shared/domain";
import { PURCHASING_LANDING_KEY, type PageGroupKey } from "./menu-tree";
import { NO_CAPS, type NavCapability } from "./nav-capabilities";

/**
 * Unified Internal Portal nav model (2026-06-30, Loo).
 *
 * The Operation / Principal / Finance portals merged into ONE role-aware
 * portal. This module is the single source of truth for the merged sidebar:
 * three AREA groups (Operations / Finance / Admin), each a flat item list.
 * `PortalSidebar` renders the groups a given role may see; the per-area shells
 * (`OperationApp` / `FinanceApp` / `PrincipalApp`) still own the actual page
 * rendering. Navigation is URL-driven:
 *   - operation + principal (admin) items  → `<base>?tab=<key>`
 *   - the two URL-path operation sections   → `/operation/orders|procurement`
 *   - finance items                         → an absolute `/finance/...` path
 *
 * Roles that may see each area:
 *   - Operations → operation, principal
 *   - Finance    → finance, principal
 *   - Admin      → principal only
 *
 * Catalog split (Loo 2026-07-25) — TWO isolated doors, one per money surface:
 *   - Operations → "Operation Catalog" (`op-catalog`): the 0226 COSTING page
 *     (SKU Master / Modular / Fabric only; buying costs).
 *   - Admin → "Product & Maintenance" (`catalog`): the full 8-tab SELLING
 *     page (retail / POS prices, PWP, promos) — principal-only by area.
 * A principal hitting the old Operations door (`/operation?tab=catalog`) is
 * forwarded to the Admin door by OperationApp; operation stays on the costing
 * page there (stale-link fallback).
 */

export type PortalArea = "operation" | "finance" | "hr" | "principal";

/** Operation badge keys surfaced as nav counters (reuses the 0083 unread set). */
export type PortalBadge = "orders" | "procurement" | "service-notes";

export type PortalSection =
  | "Workspace"
  | "Sales"
  | "Consignment"
  | "Purchasing"
  | "Showroom"
  | "Delivery"
  | "Warehouse"
  | "Payments"
  | "Customer Care"
  /* One page, so it draws as a plain row under SERVICE (Layout Standard §2,
   * owner-confirmed 2026-10-08). */
  | "Issue Tracker"
  | "Admin"
  /* The Finance modules (Chew, 2026-10-03; docs/finance/MASTER.md §4). Used
   * only by Finance's own pages; no other area has a page in them. */
  | "Payables"
  | "Receivables"
  | "Bank & Cards"
  | "Ledger"
  | "Reports"
  /* Forecast and Setup have one page each, so they draw as plain rows after
   * Reports. They have no module row until a second page joins them. */
  | "Forecast"
  | "Setup";

/** Rail order of the sections: the Houzs tree (Houzs-ERP
 *  frontend/src/components/Sidebar.tsx; Weisiang, WhatsApp 2026-11-01). */
export const SECTION_ORDER: ReadonlyArray<PortalSection> = [
  "Workspace",
  "Customer Care",
  "Sales",
  "Consignment",
  "Purchasing",
  "Delivery",
  "Warehouse",
  "Payments",
  "Showroom",
  "Issue Tracker",
  "Admin",
  /* Finance, Houzs order: Money in, Money out, Bank & cards, Books, Reports,
   * Forecasting, Setup. The section keys stay; the words are in PORTAL_MODULES. */
  "Receivables",
  "Payables",
  "Bank & Cards",
  "Ledger",
  "Reports",
  "Forecast",
  "Setup",
];

/**
 * A MODULE — one expandable parent row carrying its pages (Jess, 2026-08-19).
 *
 * A section listed here draws a parent row: icon + name + chevron, its pages
 * hanging beneath it on rounded elbows. A section NOT listed here has no
 * parent row and its pages stay plain top-level rows — `Workspace`
 * (Dashboard · Work · Issue Tracker, ruled plain by the card). A control
 * that opens nothing new is the dead control `docs/03-page-patterns.md:149`
 * bans.
 *
 * ⭐ PAYMENTS IS A MODULE OF TWO DESTINATIONS (owner ruling 2026-09-12):
 * `Monitor` — the full-width collection control listing — and `Payment
 * Records` — the permanent incoming-money listing. No `Payments · Invoices`
 * tabs, no standalone Invoices or Receipts page, no clickable parent. For an
 * ordinary ERP user Payments is not a Finance Portal; the finance-only
 * capabilities keep their own area below.
 *
 * The icon is the module's ONE face — the same law the Purchasing `ShoppingBag`
 * already followed (Loo, 2026-08-02). Children carry no icon at all now, so
 * each module's flagship page lends its face to the module and no two rows in
 * the rail wear the same picture.
 */
export interface PortalModule {
  section: PortalSection;
  label: string;
  icon: LucideIcon;
  /** Material Symbols name — the Operations menu draws these (handoff 2026-10-08). */
  mIcon?: string;
  /** The page the closed menu's module icon opens: a NAMED destination, never
   *  "the first live row", so the landing cannot move when a page above it
   *  goes live. A module that names none lands on its first live page. */
  landingKey?: string;
  /** The module row only opens and shuts its pages; it does not go anywhere.
   *  Purchasing: its pages sit in groups, and the row is clicked to LOOK far
   *  more often than to travel (owner 2026-08-20). */
  handleOnly?: true;
}

/** WHERE THE COLLAPSED WAREHOUSE ICON GOES — a NAMED destination, never "the
 *  first live row" (the same law Purchasing follows; owner review 2026-08-20).
 *  `Arrival Schedule` is where the warehouse day OPENS (Stock MASTER §7): the
 *  first question of the morning is what is coming in, because goods that have
 *  not arrived are the ones that stop every other job. Named, never derived
 *  from row order — owner ruling 2026-09-14 moved it off the retired Monitor. */
export const WAREHOUSE_LANDING_KEY = "wh-arrival-schedule";

/** The collapsed Payments icon lands on `Monitor` — the daily collection
 *  desk — by name, never by row order (owner ruling 2026-09-12). */
export const PAYMENTS_LANDING_KEY = "payments";

export const PORTAL_MODULES: ReadonlyArray<PortalModule> = [
  /* The Supply Chain modules carry the Houzs words (Sidebar.tsx:526-669). */
  { section: "Sales", label: "Sales Order", icon: ReceiptText, mIcon: "receipt_long" },
  { section: "Consignment", label: "Consignment", icon: Handshake, mIcon: "handshake" },
  { section: "Purchasing", label: "Procurement", icon: ShoppingCart, mIcon: "shopping_cart", landingKey: PURCHASING_LANDING_KEY, handleOnly: true },
  { section: "Showroom", label: "Showroom", icon: Store, mIcon: "storefront" },
  { section: "Delivery", label: "Transportation", icon: Truck, mIcon: "local_shipping" },
  { section: "Warehouse", label: "Warehouse", icon: Warehouse, mIcon: "warehouse", landingKey: WAREHOUSE_LANDING_KEY },
  { section: "Payments", label: "Payments", icon: Banknote, mIcon: "payments", landingKey: PAYMENTS_LANDING_KEY },
  { section: "Customer Care", label: "Service Cases", icon: Headset, mIcon: "support_agent" },
  /* Finance, Houzs words (Sidebar.tsx:740-853). */
  { section: "Receivables", label: "Money in", icon: ArrowDownLeft },
  { section: "Payables", label: "Money out", icon: ArrowUpRight },
  { section: "Bank & Cards", label: "Bank & cards", icon: CreditCard },
  { section: "Ledger", label: "Books", icon: BookOpen },
  { section: "Reports", label: "Reports", icon: BarChart3, mIcon: "bar_chart" },
];

export interface PortalNavItem {
  /** routing key:
   *  - operation/principal → the `?tab=` value consumed by that shell
   *  - finance → unused (the absolute `path` is the truth) */
  key: string;
  label: string;
  icon: LucideIcon;
  /** Material Symbols name for a plain Operations row (handoff 2026-10-08). */
  mIcon?: string;
  /** The page header's crumb when it differs from the module word
   *  (`Sales Order / Outright`, handoff 2026-10-08). */
  crumb?: string;
  /** operation only: a path-driven section reached by pathname, not `?tab=`. */
  path?: string;
  /** operation only: the `?tab=` value this item links to when it differs from
   *  `key`. The merged "Purchasing" item keys as `purchasing` but its click
   *  target is the To Order tab (`?tab=purchase`). Defaults to `key`. */
  tab?: string;
  /** operation only: extra URL params this row links to and is lit by, when it
   *  opens one view of a page (`view=loading` on the Warehouses page). */
  query?: string;
  /** A second door to a row that has its own place in the tree: Houzs lists
   *  Sales Orders under Workspace as well (Sidebar.tsx:246-259). `Jump to`
   *  offers the place, not the door. */
  shortcut?: true;
  /** operation only: extra locations that render this item ACTIVE, beyond its
   *  own href. Each entry is `tab:<key>` (a `?tab=` value) or `path:<prefix>`
   *  (a pathname prefix). The merged "Purchasing" item stays lit across its
   *  three routes: To Order (`?tab=purchase`), Purchase Orders
   *  (`/operation/procurement`) and Receiving (`?tab=receiving`). */
  activeFor?: ReadonlyArray<string>;
  /** finance only: the absolute route to link to. */
  financePath?: string;
  /** nav unread counter (operation area only). */
  badge?: PortalBadge;
  /** principal Approvals carries the pending-count pill. */
  pendingPill?: boolean;
  /** optional per-item narrowing of the group's roles — the item shows only
   *  for these roles. */
  roles?: ReadonlyArray<Role>;
  /** A capability beyond the role the person must hold for the item to show
   *  (`nav-capabilities.ts`). One use: Payment Requests, for the staff the
   *  boss allows (Chew 2026-10-03). */
  needs?: NavCapability;
  /** The MODULE this page belongs to (`PORTAL_MODULES`).
   *
   *  ⭐ A MODULE IS AN EXPANDABLE PARENT ROW, NOT A HEADING (Jess, 2026-08-19
   *  afternoon — CARD-2026-08-19-sidebar-expandable-modules). She saw the
   *  shipped uppercase headings in production and re-ruled the same day: every
   *  module is an ICON + NAME + CHEVRON row that expands its pages beneath it,
   *  each child hanging off a rounded elbow. This supersedes the morning's
   *  "a module is a HEADING, never a parent row".
   *
   *  The field stays on the PAGE rather than nesting pages inside a parent
   *  object on purpose: `visibleItems` keeps meaning "the PAGES this role may
   *  open", which is what `JumpTo` composes its destinations from. Grouping is
   *  presentation (`navBlocks`), so no page is added, renamed or reordered by
   *  the module rows drawn on top of them. */
  section?: PortalSection;
  /** THE GROUP this page hangs in, inside its module (`menu-tree.ts`; owner
   *  12 Oct 2026: one rule for every module). Purchasing names four (Jess,
   *  2026-08-22): a new hire cannot tell from a flat list which row holds a
   *  buying document, a receipt, a supplier problem or a showroom paper.
   *  Grouping is PRESENTATION, exactly like `section`: the page is not moved,
   *  renamed or re-addressed by the group drawn around it, and `visibleItems`
   *  still means "the PAGES this role may open", which is what `JumpTo`
   *  composes from. A page with no `pageGroup` is a direct row on its
   *  module's tree line. */
  pageGroup?: PageGroupKey;

  /** APPROVED, NOT BUILT (sidebar card §2). Renders as a NON-CONTROL saying
   *  `Coming soon` on its own line — no href, out of the tab order. */
  soon?: true;
  /** a hairline above this entry — Report is a PORTAL page, not the
   *  module's own (`docs/ERP-ARCHITECTURE.md` §2.1). */
  dividerAbove?: true;
}

export interface PortalNavGroup {
  area: PortalArea;
  label: string;
  /** base path the area mounts at (used to derive active highlight + links). */
  base: string;
  /** roles permitted to see this whole area group. */
  roles: ReadonlyArray<Role>;
  /** the tab key the area lands on by default (operation/principal). */
  defaultTab: string;
  items: PortalNavItem[];
}

export const PORTAL_NAV: PortalNavGroup[] = [
  {
    area: "operation",
    label: "Operations",
    base: "/operation",
    roles: ["operation", "principal"],
    defaultTab: "dashboard",
    items: [
      /* THE ORDER IN THIS ARRAY IS THE ORDER ON SCREEN, section by section. The
       * rows, words and nesting follow Houzs-ERP frontend/src/components/Sidebar.tsx
       * (Weisiang, WhatsApp 2026-11-01); a row marked Carres-only has no Houzs row
       * and stays in the closest place. Every address is unchanged, so bookmarks
       * and in-page links still land. Pages taken off the rail earlier
       * (`/operation/old-orders`, `?tab=auto-schedule`, `?tab=trips`, `?tab=stock-plan`,
       * `?tab=movements`) stay mounted in OperationApp. */

      /* WORKSPACE — Sidebar.tsx:239-280. */
      { key: "dashboard", label: "Overview", icon: LayoutDashboard, mIcon: "dashboard", section: "Workspace" },

      /* SERVICE CASES — Sidebar.tsx:311-363. */
      { key: "service-quality", label: "Quality Overview", icon: BarChart3, tab: "service-notes", query: "view=quality", section: "Customer Care" },
      {
        key: "service-notes",
        label: "Service Cases",
        icon: LifeBuoy,
        badge: "service-notes",
        section: "Customer Care",
      },
      { key: "service-maintenance", label: "Service Maintenance", icon: SlidersHorizontal, path: "/operation/settings/service", section: "Customer Care" },
      { key: "service-mine", label: "My Cases", icon: UserCheck, tab: "service-notes", query: "mine=1", section: "Customer Care" },
      // Carres-only (0261-0263): the claim desk, where a claim ends up.
      { key: "guarantees", label: "Guarantees", icon: ShieldCheck, section: "Customer Care" },

      /* SALES ORDER — Sidebar.tsx:533-546. */
      {
        key: "orders",
        label: "Sales Orders",
        crumb: "Sales Order",
        icon: ClipboardList,
        path: "/operation/orders",
        badge: "orders",
        section: "Sales",
      },
      { key: "orders-shortcut", label: "Sales Orders", icon: ShoppingCart, mIcon: "shopping_cart", path: "/operation/orders", shortcut: true, section: "Workspace" },
      /* The one Workspace row shown by a grant, not a role (0645; Chew 2026-10-03,
       * Finance MASTER §3.3). The page lives in Finance. */
      {
        key: "payment-requests",
        label: "Payment Requests",
        icon: HandCoins,
        path: "/finance/payment-requests",
        activeFor: ["path:/finance/payment-requests"],
        section: "Workspace",
        needs: "payment-requester",
      },
      // Carres-only: My Work / Team Work and a person's own leave (0670).
      { key: "work", label: "Workspace", icon: Home, mIcon: "home", section: "Workspace" },
      { key: "leave", label: "Leave", icon: CalendarOff, mIcon: "event_busy", section: "Workspace" },
      // Carres-only (`docs/rental/MASTER.md`): the second kind of customer order.
      { key: "rental", label: "Subscription", icon: Repeat, section: "Sales" },
      { key: "amendments", label: "Sales Order Amendment", icon: BadgeCheck, path: "/operation/amendments", section: "Sales" },
      {
        key: "delivery-orders",
        label: "Delivery Orders",
        icon: FileText,
        path: "/operation/delivery-orders",
        activeFor: ["path:/operation/delivery-orders"],
        section: "Sales",
      },
      { key: "sales-invoices", label: "Sales Invoices", icon: FileText, path: "/finance/sales-invoices", activeFor: ["path:/finance/sales-invoices"], section: "Sales" },
      { key: "delivery-returns", label: "Delivery Returns", icon: Undo2, tab: "delivery-returns", section: "Sales" },

      /* CONSIGNMENT — Sidebar.tsx:558-567. */
      { key: "customer-consignment-orders", label: "Consignment Order", icon: FileText, tab: "customer-consignment-orders", section: "Consignment" },
      { key: "consignment-notes", label: "Consignment Note", icon: FileText, tab: "consignment-notes", section: "Consignment" },
      { key: "customer-consignment-returns", label: "Consignment Return", icon: Undo2, tab: "customer-consignment-returns", section: "Consignment" },
      { key: "consignment-receives", label: "Purchase Consignment Receive", icon: PackageCheck, section: "Consignment" },
      { key: "consignment-returns", label: "Purchase Consignment Return", icon: Undo2, section: "Consignment" },
      // Carres-only, not built: goods Carres buys for a floor.
      { key: "display-requests", label: "Display Requests", icon: Store, soon: true, section: "Consignment" },

      /* PROCUREMENT — Sidebar.tsx:579-588. A flat list, as in Houzs. */
      { key: "op-catalog", label: "Products & Maintenance", icon: BookOpen, section: "Purchasing" },
      { key: "suppliers", label: "Suppliers", icon: Truck, section: "Purchasing" },
      // Carres-only: what each supplier sells, beside the supplier list.
      { key: "supplier-items", label: "Supplier items", icon: Boxes, section: "Purchasing" },
      /* Read-only Needed, In Stock, On PO, Shortage (YH, 30 Oct 2026). */
      { key: "mrp", label: "MRP · Stock Status", icon: BarChart3, section: "Purchasing" },
      /* Carres-only: the three ways a buy starts, before the PO they make.
       * `SO Batch Purchase` answers to both its entrances, one active row. */
      {
        key: "purchase",
        label: "SO Batch Purchase",
        icon: ShoppingBag,
        activeFor: ["tab:purchase", "path:/operation/to-order"],
        section: "Purchasing",
      },
      { key: "forecast-purchase", label: "Forecast Purchase", icon: TrendingUp, section: "Purchasing" },
      { key: "manual-purchase", label: "Manual Purchase Request", icon: ClipboardList, section: "Purchasing" },
      {
        // `operation:procurement` counts POs in the Pickup-action bucket.
        key: "purchase-orders",
        label: "Purchase Orders",
        icon: FileText,
        path: "/operation/procurement",
        badge: "procurement",
        section: "Purchasing",
      },
      { key: "po-amendments", label: "PO Amendments", icon: BadgeCheck, section: "Purchasing" },
      { key: "po-cancellation-requests", label: "Cancellation Requests", icon: ClipboardX, section: "Purchasing" },
      { key: "receiving", label: "Goods Receipt", icon: PackageCheck, section: "Purchasing" },
      { key: "purchase-invoices", label: "Purchase Invoices", icon: Receipt, section: "Purchasing" },
      { key: "purchase-returns", label: "Purchase Returns", icon: Undo2, section: "Purchasing" },
      // Carres-only: what you open when the goods are wrong, after the return.
      { key: "claims", label: "Supplier Claims", icon: Scale, section: "Purchasing" },
      { key: "repair-orders", label: "Repair Orders", icon: ArrowUpRight, section: "Purchasing" },

      /* TRANSPORTATION — Sidebar.tsx:601-664. */
      // Carres-only: the calendar where delivery results are recorded.
      {
        key: "delivery",
        label: "Monitor",
        icon: Route,
        activeFor: ["tab:delivery"],
        section: "Delivery",
      },
      { key: "delivery-planning", label: "Delivery Planning", icon: CalendarDays, tab: "delivery-planning", section: "Delivery" },
      { key: "dp-orders", label: "DP Orders", icon: ClipboardList, tab: "dp-orders", section: "Delivery" },
      { key: "fleet-day", label: "Last Mile Delivery", icon: Users, section: "Delivery" },
      { key: "fleet-map", label: "Lorry Live Map", icon: MapPin, section: "Delivery" },
      { key: "fleet-capacity", label: "Lorry Capacity", icon: Gauge, section: "Delivery" },
      { key: "crew-leave", label: "Crew Leave", icon: CalendarOff, section: "Delivery" },
      // Carres-only (0716): DOs marked Delivered by load scan.
      { key: "load-scan", label: "Load Scan", icon: PackageCheck, tab: "load-scan", section: "Delivery" },
      { key: "fleet", label: "Fleet", icon: Truck, section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "delivery-zones", label: "Delivery Zones", icon: MapPin, section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "rate-cards", label: "Carriers & Rates", icon: Receipt, section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "fleet-health", label: "Fleet Health", icon: ShieldCheck, section: "Delivery", pageGroup: "transportation-maintenance" },

      /* WAREHOUSE — Sidebar.tsx:679-696. Loading List and Racks & Bins are views
       * of the one Warehouses page. */
      { key: "wh-loading-list", label: "Loading List", icon: ClipboardList, tab: "warehouses", query: "view=loading", section: "Warehouse" },
      { key: "wh-warehouses", label: "Warehouses", icon: Warehouse, tab: "warehouses", section: "Warehouse" },
      { key: "wh-racks", label: "Racks & Bins", icon: Boxes, tab: "warehouses", query: "view=bins", section: "Warehouse" },
      { key: "stock", label: "Inventory", icon: Boxes, tab: "stock-onhand", section: "Warehouse" },
      { key: "stock-adjustments", label: "Adjustments", icon: SlidersHorizontal, tab: "stock-adjustments", section: "Warehouse" },
      { key: "stock-transfers", label: "Transfers", icon: ArrowLeftRight, tab: "stock-transfers", section: "Warehouse" },
      { key: "stock-takes", label: "Stock Take", icon: ClipboardList, tab: "stock-takes", section: "Warehouse" },
      /* Carres-only (owner ruling 2026-09-14). `?tab=warehouse-monitor` and
       * `?tab=warehouse-dashboard` still land on Arrival Schedule and light it, so
       * the row's own tab is listed beside them (`activeFor` replaces the match). */
      {
        key: "wh-arrival-schedule",
        label: "Arrival Schedule",
        icon: CalendarDays,
        tab: "warehouse-arrival-schedule",
        activeFor: [
          "tab:warehouse-arrival-schedule",
          "tab:warehouse-monitor",
          "tab:warehouse-dashboard",
        ],
        section: "Warehouse",
      },
      {
        key: "wh-pickup-schedule",
        label: "Pickup Schedule",
        icon: CalendarDays,
        tab: "warehouse-pickup-schedule",
        section: "Warehouse",
      },
      {
        key: "wh-inbound",
        label: "Inbound",
        icon: ArrowDownLeft,
        tab: "warehouse-inbound",
        section: "Warehouse",
      },
      {
        key: "wh-outbound",
        label: "Outbound",
        icon: ArrowUpRight,
        tab: "warehouse-outbound",
        section: "Warehouse",
      },

      /* Carres-only: PAYMENTS (owner ruling 2026-09-12). Operation staff have no
       * Finance area, and `/finance/*` admits them to these two (§12). `path`, not
       * `financePath`, because `navItemHref` reads `path` outside Finance. */
      {
        key: "payments",
        label: "Monitor",
        icon: Wallet,
        path: "/finance/monitor",
        // The retired `/finance/invoices` address forwards here and lights this row.
        activeFor: ["path:/finance/monitor", "path:/finance/invoices"],
        section: "Payments",
      },
      {
        key: "payment-records",
        label: "Payment Records",
        icon: Receipt,
        path: "/finance/payments",
        activeFor: ["path:/finance/payments"],
        section: "Payments",
      },

      /* Carres-only: SHOWROOM, ISSUE TRACKER and the Operations report pages. */
      { key: "showroom", label: "Carres", icon: Store, section: "Showroom" },
      { key: "dealer-showroom", label: "Dealer", icon: Store, soon: true, section: "Showroom" },
      { key: "issue-tracker", label: "Issue Tracker", icon: ClipboardX, mIcon: "assignment_late", path: "/operation/issues", section: "Issue Tracker" },
      { key: "purchasing-report", label: "Purchasing report", icon: BarChart3, section: "Reports" },
      { key: "receiving-report", label: "Receiving report", icon: BarChart3, section: "Reports" },
      { key: "delivery-report", label: "Delivery report", icon: BarChart3, section: "Reports" },
      { key: "delivery-return-lines", label: "Delivery return lines", icon: BarChart3, section: "Reports" },
      { key: "sales-order-lines", label: "Sales order lines", icon: BarChart3, section: "Reports" },
      { key: "delivery-order-lines", label: "Delivery order lines", icon: BarChart3, section: "Reports" },
      { key: "sales-invoice-lines", label: "Sales invoice lines", icon: BarChart3, section: "Reports" },
    ],
  },
  {
    area: "finance",
    label: "Finance",
    base: "/finance",
    roles: ["finance", "principal"],
    defaultTab: "dashboard",
    items: [
      /* The Houzs Finance tree, in its order (Sidebar.tsx:740-861; Weisiang,
       * WhatsApp 2026-11-01). A row keeps its Carres word where Houzs has no row
       * for the same thing. Every address is unchanged. */
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, financePath: "/finance/dashboard", section: "Workspace" },

      /* MONEY IN. Carres-only: Monitor, Payment Records, Sales Invoices, Customer
       * Credit Notes (0730), Cancelled orders holding money (0729). */
      { key: "payments", label: "Monitor", icon: Wallet, financePath: "/finance/monitor", section: "Receivables" },
      { key: "payment-records", label: "Payment Records", icon: Receipt, financePath: "/finance/payments", section: "Receivables" },
      { key: "sales-invoices", label: "Sales Invoices", icon: FileText, financePath: "/finance/sales-invoices", section: "Receivables" },
      // 0478 — money in that is not a sale, and the parties billed for it.
      { key: "other-receipts", label: "Other receipts", icon: HandCoins, financePath: "/finance/other-receipts", section: "Receivables" },
      { key: "other-debtors", label: "Other Debtors", icon: Users, financePath: "/finance/other-debtors", section: "Receivables" },
      { key: "ar", label: "Outstanding", icon: ArrowDownLeft, financePath: "/finance/ar", section: "Receivables" },
      { key: "customer-credit-notes", label: "Customer Credit Notes", icon: ReceiptText, financePath: "/finance/customer-credit-notes", section: "Receivables" },
      { key: "cancelled-money", label: "Cancelled orders holding money", icon: Undo2, financePath: "/finance/cancelled-money", section: "Receivables" },

      /* MONEY OUT. Carres-only: Notes to follow up (0676), AP · Payables (0477,
       * what is still unpaid per supplier), and Credit and Debit Notes as two rows
       * where Houzs has one. */
      { key: "payment-vouchers", label: "Payment Vouchers", icon: Banknote, financePath: "/finance/payment-vouchers", section: "Payables" },
      { key: "bills", label: "AP Invoices", icon: Receipt, financePath: "/finance/bills", section: "Payables" },
      { key: "payment-requests", label: "Payment Requests", icon: HandCoins, financePath: "/finance/payment-requests", section: "Payables" },
      { key: "supplier-finance", label: "Supplier Maintenance", icon: Truck, financePath: "/finance/suppliers", section: "Payables" },
      { key: "credit-notes", label: "Credit Notes", icon: ReceiptText, financePath: "/finance/credit-notes", section: "Payables" },
      { key: "debit-notes", label: "Debit Notes", icon: ReceiptText, financePath: "/finance/debit-notes", section: "Payables" },
      { key: "notes-to-follow-up", label: "Notes to follow up", icon: ClipboardList, financePath: "/finance/notes-to-follow-up", section: "Payables" },
      { key: "ap", label: "AP · Payables", icon: ArrowUpRight, financePath: "/finance/ap-outstanding", section: "Payables" },

      /* BANK & CARDS. Carres-only: Card money waiting (0641), Money moves (0529). */
      { key: "daily-bank", label: "Daily Bank", icon: Landmark, financePath: "/finance/daily-bank", section: "Bank & Cards" },
      { key: "card-settlement", label: "Merchant Recon", icon: CreditCard, financePath: "/finance/card-settlement", section: "Bank & Cards" },
      { key: "card-money-waiting", label: "Card money waiting", icon: Hourglass, financePath: "/finance/card-money-waiting", section: "Bank & Cards" },
      { key: "money-moves", label: "Money moves", icon: ArrowLeftRight, financePath: "/finance/money-moves", section: "Bank & Cards" },

      /* BOOKS. */
      { key: "ledger", label: "Journal Entries", icon: BookOpen, financePath: "/finance/ledger", section: "Ledger" },
      { key: "general-ledger", label: "General Ledger", icon: BookOpenText, financePath: "/finance/ledger/general-ledger", section: "Ledger" },
      { key: "trial-balance", label: "Trial Balance", icon: Scale, financePath: "/finance/ledger/trial-balance", section: "Ledger" },
      { key: "self-check", label: "Self-check", icon: BadgeCheck, financePath: "/finance/ledger/self-check", section: "Ledger" },

      /* REPORTS. Carres-only: Dealer commission, Stock value, Stock drops, Payment. */
      { key: "profit-and-loss", label: "P&L", icon: BarChart3, financePath: "/finance/reports/profit-and-loss", section: "Reports" },
      { key: "balance-sheet", label: "Balance Sheet", icon: Scale, financePath: "/finance/reports/balance-sheet", section: "Reports" },
      { key: "cash-flow", label: "Cash Flow", icon: ArrowLeftRight, financePath: "/finance/reports/cash-flow", section: "Reports" },
      { key: "ar-aging", label: "AR Aging", icon: Hourglass, financePath: "/finance/reports/ar-aging", section: "Reports" },
      { key: "ap-aging", label: "AP Aging", icon: Hourglass, financePath: "/finance/reports/ap-aging", section: "Reports" },
      { key: "collection", label: "Collection", icon: HandCoins, financePath: "/finance/reports/collection", section: "Reports" },
      { key: "card-charges", label: "Merchant charges", icon: CreditCard, financePath: "/finance/reports/card-charges", section: "Reports" },
      { key: "dealer-commission", label: "Dealer commission", icon: Users, financePath: "/finance/reports/dealer-commission", section: "Reports" },
      { key: "stock-value", label: "Stock value", icon: Boxes, financePath: "/finance/reports/stock-value", section: "Reports" },
      { key: "stock-drops", label: "Stock drops", icon: Boxes, financePath: "/finance/reports/stock-drops", section: "Reports" },
      { key: "payment-report", label: "Payment", icon: Wallet, financePath: "/finance/reports/payment", section: "Reports" },

      /* FORECASTING and SETUP: one Carres page each, so plain rows. */
      { key: "forecast", label: "Forecast P&L", icon: TrendingUp, financePath: "/finance/reports/forecast", section: "Forecast" },
      { key: "opening-balances", label: "Opening Balance", icon: BookOpen, financePath: "/finance/ledger/opening-balances", section: "Setup" },

      /* Carres-only: the rent-to-own credit gate (0268), subscription months
       * (0538), and the dealer master (0543). */
      { key: "rental-approver", label: "Rental Approver", icon: UserCheck, financePath: "/finance/rental-approver" },
      { key: "subscriptions", label: "Subscriptions", icon: CalendarClock, financePath: "/finance/subscriptions" },
      { key: "dealers", label: "Dealers", icon: Users, financePath: "/finance/dealers" },
    ],
  },
  {
    // 0244/0245 (Loo 2026-07-25) — HR area: commission calculation for Carres'
    // OWN sales executives (showroom-channel staff; dealers excluded by the
    // gated hr_commission_source RPC). No base payroll — commission only.
    area: "hr",
    label: "HR",
    base: "/hr",
    roles: ["hr", "principal"],
    // O1 (2026-07-26): HR lands on Overview — "what needs me today" — rather
    // than opening straight into the commission table.
    defaultTab: "overview",
    items: [
      { key: "overview", label: "Overview", icon: LayoutDashboard },
      // HR-P4 (2026-07-26) — the employee master. Sits next to Team because
      // that is where a person is created; People is where their file lives.
      { key: "people", label: "People", icon: IdCard },
      // Commission is ONE entry (Loo 2026-07-27) — the month report and the
      // rates that compute it are one subject, so "Commission Setup" stopped
      // being a second rail item and became a sub-tab (`HrCommissionTabs`),
      // the same merge Stock (K0) and Purchasing made. `activeFor` keeps the
      // item lit on both `?tab=` values.
      {
        key: "commission",
        label: "Commission",
        icon: HandCoins,
        activeFor: ["tab:commission", "tab:setup"],
      },
      // Attribution retired (Loo 2026-07-27, "no more use for me") — the
      // unassigned-order worklist is empty on a healthy month, so it cost a
      // permanent rail item to say "nothing to do". It renders inside
      // Commission → Earnings now, only while an order is unassigned.
      // Team hierarchy (Loo 2026-07-25) — the org registry + THE account door:
      // every new user except dealers is minted here.
      { key: "team", label: "Team", icon: Users },
      // HR-P6 (0276, 2026-07-26) — targets + the scoreboard. Sits after People
      // because a target is set ON a person: you need the file to exist first.
      { key: "performance", label: "Performance", icon: Target },
      // HR-P7 (0278) — the Chairman's cost question. Last in the HR group: it is
      // the only screen carrying salary, and it reads the other tabs' figures.
      { key: "people-cost", label: "People cost", icon: Wallet },
      /* 0687 — Chew 2026-10-12 (Finance MASTER §3.3, 「hr & BD 也到能申请」): the HR
       * staff Finance or the boss allows ask Finance to pay a bill. Shown only to
       * them (`needs`), and to HR only: the principal finds it under Operations. */
      {
        key: "payment-requests",
        label: "Payment Requests",
        icon: HandCoins,
        path: "/finance/payment-requests",
        activeFor: ["path:/finance/payment-requests"],
        roles: ["hr"],
        needs: "payment-requester",
      },
    ],
  },
  {
    area: "principal",
    label: "Admin",
    base: "/principal",
    roles: ["principal"],
    defaultTab: "dashboard",
    items: [
      { key: "dashboard", label: "Overview", icon: LayoutDashboard },
      { key: "approvals", label: "Approvals", icon: BadgeCheck, pendingPill: true },
      // POS-parity (Loo 2026-07-03): the entry opens the POS *catalog* — named
      // like 2990s (the POS home IS the catalog), not "New order".
      { key: "pos", label: "Catalog", icon: LayoutGrid },
      // The principal trace-only Orders page is gone (Loo 2026-07-16) — Admin
      // "Orders" jumps straight to the Operations order control grid.
      //
      // ONE DESTINATION, ONE WORD (owner ruling 2026-09-23). A principal stands
      // in Operations AND Admin at once, so this row and the Operations child
      // above point at the same page and light together. Two different words on
      // two rows for one register is the duplicate the ruling names; the
      // word for that register is the Houzs `Sales Orders`. The address is
      // unchanged, so the principal's bookmark still lands.
      { key: "orders", label: "Sales Orders", icon: ClipboardList, path: "/operation/orders" },
      // YH, 2026-08-24 — the lead-time floor (earliest a store may sell) is a
      // principal-level decision, but its only editor lived under Operations
      // Settings. `role === "principal"` already grants edit there (checkDuty
      // short-circuits on role, never a duty — 0260), so this needs no new
      // page, no new API: same pattern as "Sales Orders" above, a path-driven
      // jump straight into the operations-owned surface it actually edits.
      {
        key: "purchasing-settings",
        label: "Purchasing settings",
        icon: SlidersHorizontal,
        path: "/operation/settings/purchasing",
      },
      // Loo 2026-07-19 — two separate doors: "Dealers" = external resellers,
      // "Showrooms" = the stores Carres owns. Same page, filtered by
      // `dealers.channel`.
      { key: "dealers", label: "Dealers", icon: Users },
      { key: "showrooms", label: "Showrooms", icon: Store },
      { key: "partners", label: "Partners", icon: Network },
      { key: "audit", label: "Audit log", icon: ScrollText },
      { key: "accounts", label: "Accounts", icon: Settings },
      // Catalog split (Loo 2026-07-25) — the SELLING catalog (retail / POS
      // prices, PWP, promos; the full 8-tab Product & Maintenance page) is an
      // ADMIN door: only the principal touches selling prices (0226). Costing
      // stays in Operations as the Operation Catalog above.
      { key: "catalog", label: "Product & Maintenance", icon: BookOpen },
      // Rental split out of P&M (Loo 2026-07-26): the rent/buy offer config
      // had outgrown a tab strip that is otherwise pure catalog work. Settings
      // only — the agreements/units registry stays the Operations "Rental" page.
      { key: "rental-setting", label: "Rental", icon: Repeat },
    ],
  },
];

/** The area-groups a given role may see (preserves PORTAL_NAV order). */
export function visibleGroups(role: Role | null): PortalNavGroup[] {
  if (!role) return [];
  return PORTAL_NAV.filter((g) => g.roles.includes(role));
}

/** The items of a group a given role may see (per-item `roles` narrowing, and
 *  an item that `needs` a capability only for a person who holds it). */
export function visibleItems(
  group: PortalNavGroup,
  role: Role | null,
  caps: ReadonlySet<NavCapability> = NO_CAPS,
): PortalNavItem[] {
  return group.items.filter((it) =>
    (!it.roles || (role != null && it.roles.includes(role))) && (!it.needs || caps.has(it.needs)));
}

/** The href a nav item points at. */
export function navItemHref(
  group: PortalNavGroup,
  item: PortalNavItem,
): string {
  if (group.area === "finance") {
    return (item as PortalNavItem).financePath ?? group.base;
  }
  if (item.path) return item.path; // path-driven section or page
  const query = item.query ? `&${item.query}` : "";
  return `${group.base}?tab=${item.tab ?? item.key}${query}`;
}

/** Does this tab-driven row stand on this URL? A row with a `query` needs its
 *  params too; the plain row of the same tab yields to a sibling that matches. */
export function rowMatchesTab(
  group: PortalNavGroup,
  item: PortalNavItem,
  tab: string,
  search: string,
): boolean {
  const params = new URLSearchParams(search);
  const hit = (it: PortalNavItem) =>
    [...new URLSearchParams(it.query)].every(([k, v]) => params.get(k) === v);
  if ((item.tab ?? item.key) !== tab || !hit(item)) return false;
  return !!item.query || !group.items.some((o) => o.query && (o.tab ?? o.key) === tab && hit(o));
}

/** Default landing href for an area (its dashboard / overview). */
export function areaDefaultHref(group: PortalNavGroup): string {
  if (group.area === "finance") return "/finance/dashboard";
  return `${group.base}?tab=${group.defaultTab}`;
}

/** One row-group of the rail: an expandable module, or a lone plain page. */
export type NavBlock =
  | { kind: "plain"; item: PortalNavItem }
  | { kind: "module"; module: PortalModule; pages: PortalNavItem[] };

/**
 * The rail's shape: the pages a role may see, grouped into module blocks.
 *
 * Presentation only — it never adds, renames or reorders a page. Sections keep
 * `SECTION_ORDER`; pages keep their order inside a section; an area with no
 * sections at all (Finance · HR · Admin) comes out as plain rows in its
 * declared order, exactly as it renders today.
 *
 * A module needs at least TWO pages to earn its parent row. One page behind a
 * chevron is a control that reveals a row of the same name, and the operator
 * pays a click to learn nothing.
 */
export function navBlocks(
  group: PortalNavGroup,
  role: Role | null,
  caps: ReadonlySet<NavCapability> = NO_CAPS,
): NavBlock[] {
  const items = visibleItems(group, role, caps);
  const bySection = new Map<PortalSection | "__none__", PortalNavItem[]>();
  for (const item of items) {
    const key = item.section ?? "__none__";
    const bucket = bySection.get(key);
    if (bucket) bucket.push(item);
    else bySection.set(key, [item]);
  }

  const sections = [...bySection.keys()].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a as PortalSection);
    const bi = SECTION_ORDER.indexOf(b as PortalSection);
    return (ai < 0 ? SECTION_ORDER.length : ai) - (bi < 0 ? SECTION_ORDER.length : bi);
  });

  const out: NavBlock[] = [];
  for (const section of sections) {
    const pages = bySection.get(section)!;
    const module = PORTAL_MODULES.find((m) => m.section === section);
    if (module && pages.length > 1) out.push({ kind: "module", module, pages });
    else for (const item of pages) out.push({ kind: "plain", item });
  }
  return out;
}

/* ── THE MENU GROUPS — the Houzs tree (Sidebar.tsx:1118-1123, 237-700). Two caps
 * words, Workspace and Operations; Supply Chain is an expandable row inside
 * Operations holding its five modules. Payments, Showroom, Issue Tracker and
 * the Operations reports have no Houzs row, so they follow Supply Chain. */
export interface MenuGroup {
  label: string | null;
  /** The group draws under one expandable row instead of a caps word. */
  row?: { key: string; label: string; icon: LucideIcon; mIcon?: string };
  sections: ReadonlyArray<PortalSection>;
}

export const OPERATION_MENU_GROUPS: ReadonlyArray<MenuGroup> = [
  { label: "Workspace", sections: ["Workspace"] },
  { label: "Operations", sections: ["Customer Care"] },
  {
    label: null,
    row: { key: "supply-chain", label: "Supply Chain", icon: Boxes, mIcon: "inventory_2" },
    sections: ["Sales", "Consignment", "Purchasing", "Delivery", "Warehouse"],
  },
  { label: null, sections: ["Payments", "Showroom", "Issue Tracker", "Reports"] },
];

/** The blocks of one area, cut into its menu groups. Only the Operations
 *  area has groups; every other area is one unlabelled group in the order
 *  `navBlocks` already gives it. A section no group names still shows, last. */
export function menuGroups(
  group: PortalNavGroup,
  role: Role | null,
  caps: ReadonlySet<NavCapability> = NO_CAPS,
): { label: string | null; row?: MenuGroup["row"]; blocks: NavBlock[] }[] {
  const blocks = navBlocks(group, role, caps);
  if (group.area !== "operation") return [{ label: null, blocks }];
  const sectionOf = (b: NavBlock): PortalSection | undefined =>
    b.kind === "module" ? b.module.section : b.item.section;
  const used = new Set<NavBlock>();
  const out: { label: string | null; row?: MenuGroup["row"]; blocks: NavBlock[] }[] = [];
  for (const g of OPERATION_MENU_GROUPS) {
    const mine: NavBlock[] = [];
    for (const section of g.sections) {
      for (const b of blocks) {
        if (!used.has(b) && sectionOf(b) === section) {
          mine.push(b);
          used.add(b);
        }
      }
    }
    if (mine.length) out.push({ label: g.label, row: g.row, blocks: mine });
  }
  const rest = blocks.filter((b) => !used.has(b));
  if (rest.length) out.push({ label: null, blocks: rest });
  return out;
}

/** The menu item a URL stands on, for the shell header's `crumb / title`
 *  when a page does not name itself (Layout Standard §1). Same matching as the
 *  menu's selected row: an item's own path, its `activeFor` matchers, then the
 *  `?tab=` it links to. The crumb is the module the item hangs under. */
export function activeNavTitle(
  pathname: string,
  search: string,
): { crumb: string | null; title: string } | null {
  const group = PORTAL_NAV.find((g) => g.area === "operation");
  if (!group) return null;
  const tab = new URLSearchParams(search).get("tab") ?? group.defaultTab;
  const onPath = (prefix: string) => pathname.startsWith(prefix);
  const pathItem = group.items.find(
    (it) =>
      (it.path && onPath(it.path)) ||
      it.activeFor?.some((m) => m.startsWith("path:") && onPath(m.slice(5))),
  );
  const item =
    pathItem ??
    (pathname === group.base || pathname === `${group.base}/`
      ? group.items.find(
          (it) =>
            !it.path &&
            (rowMatchesTab(group, it, tab, search) ||
              it.activeFor?.some((m) => m === `tab:${tab}`)),
        )
      : undefined);
  if (!item) return null;
  const moduleRow = PORTAL_MODULES.find((m) => m.section === item.section);
  const siblings = group.items.filter((it) => it.section === item.section).length;
  return {
    crumb: item.crumb ?? (moduleRow && siblings > 1 && moduleRow.label !== item.label ? moduleRow.label : null),
    title: item.label,
  };
}
