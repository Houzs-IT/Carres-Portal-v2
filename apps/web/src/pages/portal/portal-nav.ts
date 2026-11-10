import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  Boxes,
  Repeat,
  ArrowLeftRight,
  Wallet,
  BookOpen,
  Truck,
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
  History,
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
  ClipboardCheck,
  Sofa,
  FolderKanban,
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
  /* Fairs, exhibitions and solo roadshows (0750, Houzs Projects). */
  | "Projects"
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
  "Projects",
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
 *  first live row" (owner review 2026-08-20): `Loading List`, the first page of
 *  Houzs's Warehouse (the engine page). Arrival Schedule, the landing before, was
 *  removed with the old Carres pages (11 Nov 2026). */
export const WAREHOUSE_LANDING_KEY = "wh-loading-list";

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
  { section: "Projects", label: "Projects", icon: FolderKanban, mIcon: "event" },
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
    // The Operations landing is the Houzs Sales Orders page (the old Carres Overview is removed).
    defaultTab: "orders",
    items: [
      /* THE ORDER IN THIS ARRAY IS THE ORDER ON SCREEN, section by section.
       *
       * Service Cases, Projects and Supply Chain are Houzs's own screens, run by the engine (engine/, the
       * Houzs-ERP code): these rows carry Houzs's words and order (Houzs frontend/src/components/Sidebar.tsx)
       * and every one opens its engine page, at its own `/operation/sc/<row>` address (ENGINE_PAGES). The
       * Carres pages these areas used to have are removed (owner, 11 Nov 2026); their old addresses open the
       * nearest engine page (RETIRED_ADDRESSES). The other rows are Carres modules outside those areas. */

      /* WORKSPACE */
      { key: "orders-shortcut", label: "Sales Orders", icon: ShoppingCart, mIcon: "shopping_cart", path: "/operation/sc/orders", shortcut: true, section: "Workspace" },
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

      /* SERVICE CASES */
      { key: "service-quality", label: "Quality Overview", icon: BarChart3, path: "/operation/sc/service-quality", section: "Customer Care" },
      { key: "service-notes", label: "Service Cases", icon: LifeBuoy, path: "/operation/sc/service-notes", section: "Customer Care" },
      { key: "service-maintenance", label: "Service Maintenance", icon: SlidersHorizontal, path: "/operation/sc/service-maintenance", section: "Customer Care" },
      { key: "service-mine", label: "My Cases", icon: UserCheck, path: "/operation/sc/service-mine", section: "Customer Care" },

      /* PROJECTS */
      { key: "project-overview", label: "Project Overview", icon: BarChart3, path: "/operation/sc/project-overview", section: "Projects" },
      { key: "projects", label: "Project List", icon: ClipboardList, path: "/operation/sc/projects", section: "Projects" },
      { key: "project-calendar", label: "Calendar", icon: CalendarDays, path: "/operation/sc/project-calendar", section: "Projects" },
      { key: "project-maintenance", label: "Project Maintenance", icon: SlidersHorizontal, path: "/operation/sc/project-maintenance", section: "Projects" },

      /* SUPPLY CHAIN · SALES ORDER */
      { key: "orders", label: "Sales Orders", crumb: "Sales Order", icon: ClipboardList, path: "/operation/sc/orders", section: "Sales" },
      { key: "fair-pending", label: "Fair Links to Settle", icon: MapPin, path: "/operation/sc/fair-pending", section: "Sales" },
      { key: "amendments", label: "Sales Order Amendment", icon: BadgeCheck, path: "/operation/sc/amendments", section: "Sales" },
      { key: "payment-backdate-requests", label: "Payment Backdate Requests", icon: ClipboardCheck, path: "/operation/sc/payment-backdate-requests", section: "Sales" },
      { key: "delivery-orders", label: "Delivery Orders", icon: FileText, path: "/operation/sc/delivery-orders", section: "Sales" },
      // Carres Finance's own page: it feeds the Carres books.
      { key: "sales-invoices", label: "Sales Invoices", icon: FileText, path: "/finance/sales-invoices", activeFor: ["path:/finance/sales-invoices"], section: "Sales" },
      { key: "delivery-returns", label: "Delivery Returns", icon: Undo2, path: "/operation/sc/delivery-returns", section: "Sales" },
      // Carres-only (`docs/rental/MASTER.md`): the second kind of customer order. Last, so the Houzs rows keep Houzs's order.
      { key: "rental", label: "Subscription", icon: Repeat, section: "Sales" },

      /* SUPPLY CHAIN · CONSIGNMENT */
      { key: "customer-consignment-orders", label: "Consignment Order", icon: FileText, path: "/operation/sc/customer-consignment-orders", section: "Consignment" },
      { key: "consignment-notes", label: "Consignment Note", icon: FileText, path: "/operation/sc/consignment-notes", section: "Consignment" },
      { key: "customer-consignment-returns", label: "Consignment Return", icon: Undo2, path: "/operation/sc/customer-consignment-returns", section: "Consignment" },
      { key: "purchase-consignment-orders", label: "Purchase Consignment Order", icon: HandCoins, path: "/operation/sc/purchase-consignment-orders", section: "Consignment" },
      { key: "product-requests", label: "Product Request", icon: Sofa, path: "/operation/sc/product-requests", section: "Consignment" },
      { key: "consignment-receives", label: "Purchase Consignment Receive", icon: PackageCheck, path: "/operation/sc/consignment-receives", section: "Consignment" },
      { key: "consignment-returns", label: "Purchase Consignment Return", icon: Undo2, path: "/operation/sc/consignment-returns", section: "Consignment" },

      /* SUPPLY CHAIN · PROCUREMENT */
      { key: "procurement-overview", label: "Procurement Overview", icon: LayoutDashboard, path: "/operation/sc/procurement-overview", section: "Purchasing" },
      { key: "op-catalog", label: "Products & Maintenance", icon: BookOpen, path: "/operation/sc/op-catalog", section: "Purchasing" },
      { key: "suppliers", label: "Suppliers", icon: Truck, path: "/operation/sc/suppliers", section: "Purchasing" },
      { key: "mrp", label: "MRP · Stock Status", icon: BarChart3, path: "/operation/sc/mrp", section: "Purchasing" },
      { key: "purchase-orders", label: "Purchase Orders", icon: FileText, path: "/operation/sc/purchase-orders", section: "Purchasing" },
      { key: "po-amendments", label: "PO Amendments", icon: BadgeCheck, path: "/operation/sc/po-amendments", section: "Purchasing" },
      { key: "po-cancellation-requests", label: "Cancellation Requests", icon: ClipboardX, path: "/operation/sc/po-cancellation-requests", section: "Purchasing" },
      { key: "receiving", label: "Goods Receipt", icon: PackageCheck, path: "/operation/sc/receiving", section: "Purchasing" },
      { key: "purchase-invoices", label: "Purchase Invoices", icon: Receipt, path: "/operation/sc/purchase-invoices", section: "Purchasing" },
      { key: "purchase-returns", label: "Purchase Returns", icon: Undo2, path: "/operation/sc/purchase-returns", section: "Purchasing" },

      /* SUPPLY CHAIN · TRANSPORTATION */
      { key: "logistic-overview", label: "Logistic Overview", icon: LayoutDashboard, path: "/operation/sc/logistic-overview", section: "Delivery" },
      { key: "delivery-planning", label: "Delivery Planning", icon: CalendarDays, path: "/operation/sc/delivery-planning", section: "Delivery" },
      { key: "delivery-planning-driver", label: "Last Mile Delivery (Driver)", icon: ClipboardList, path: "/operation/sc/delivery-planning-driver", section: "Delivery" },
      { key: "dp-orders", label: "DP Orders", icon: ClipboardList, path: "/operation/sc/dp-orders", section: "Delivery" },
      { key: "fleet-day", label: "Last Mile Delivery", icon: Users, path: "/operation/sc/fleet-day", section: "Delivery" },
      { key: "crew-leave", label: "Crew Leave", icon: CalendarOff, path: "/operation/sc/crew-leave", section: "Delivery" },
      { key: "coverage-fleet", label: "Coverage & Fleet", icon: Truck, path: "/operation/sc/coverage-fleet", section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "delivery-zones", label: "Delivery Zones", icon: MapPin, path: "/operation/sc/delivery-zones", section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "rate-cards", label: "Carriers & Rates", icon: Receipt, path: "/operation/sc/rate-cards", section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "fleet-health", label: "Fleet Health", icon: ShieldCheck, path: "/operation/sc/fleet-health", section: "Delivery", pageGroup: "transportation-maintenance" },

      /* SUPPLY CHAIN · WAREHOUSE */
      { key: "wh-loading-list", label: "Loading List", icon: ClipboardList, path: "/operation/sc/wh-loading-list", section: "Warehouse" },
      { key: "wh-warehouses", label: "Warehouses", icon: Warehouse, path: "/operation/sc/wh-warehouses", section: "Warehouse" },
      { key: "wh-racks", label: "Racks & Bins", icon: Boxes, path: "/operation/sc/wh-racks", section: "Warehouse" },
      { key: "stock", label: "Inventory", icon: Boxes, path: "/operation/sc/stock", section: "Warehouse" },
      { key: "stock-adjustments", label: "Adjustments", icon: SlidersHorizontal, path: "/operation/sc/stock-adjustments", section: "Warehouse" },
      { key: "stock-transfers", label: "Transfers", icon: ArrowLeftRight, path: "/operation/sc/stock-transfers", section: "Warehouse" },
      { key: "stock-takes", label: "Stock Take", icon: ClipboardList, path: "/operation/sc/stock-takes", section: "Warehouse" },

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

      /* Carres-only: ISSUE TRACKER and the Sales Invoices report (Carres Finance's invoices). */
      { key: "issue-tracker", label: "Issue Tracker", icon: ClipboardX, mIcon: "assignment_late", path: "/operation/issues", section: "Issue Tracker" },
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
      { key: "not-yet-billed", label: "Not Yet Billed", icon: HandCoins, financePath: "/finance/not-yet-billed", section: "Receivables" },
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
      { key: "corrections", label: "Corrections", icon: History, financePath: "/finance/corrections", section: "Reports" },
      { key: "payment-report", label: "Payment", icon: Wallet, financePath: "/finance/reports/payment", section: "Reports" },
      /* 0754: a project's money (Houzs event page finance, YH 3 Nov 2026). */
      { key: "project-money", label: "Project money", icon: BarChart3, financePath: "/finance/project-money", section: "Reports" },

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
/** Service Cases, Projects and Supply Chain: each row's engine page (engine/, Houzs's own screens), shown in a
 *  frame at the row's `/operation/sc/<row>` address. Keyed by row, valued by the engine address. */
export const ENGINE_PAGES: Readonly<Record<string, string>> = {
  "service-quality": "/assr?view=metrics", "service-notes": "/assr?view=cases",
  "service-maintenance": "/assr?view=settings", "service-mine": "/my-cases",
  "project-overview": "/projects?view=finances", projects: "/projects?view=list",
  "project-calendar": "/projects?view=calendar", "project-maintenance": "/projects?view=maintenance",
  orders: "/scm/sales-orders", "orders-shortcut": "/scm/sales-orders",
  "fair-pending": "/scm/fair-pending", amendments: "/scm/amendments",
  "payment-backdate-requests": "/scm/payment-backdate-requests",
  "delivery-orders": "/scm/delivery-orders", "delivery-returns": "/scm/delivery-returns",
  "customer-consignment-orders": "/scm/consignment-orders", "consignment-notes": "/scm/consignment-notes",
  "customer-consignment-returns": "/scm/consignment-returns", "purchase-consignment-orders": "/scm/purchase-consignment-orders",
  "product-requests": "/scm/product-requests", "consignment-receives": "/scm/purchase-consignment-receives",
  "consignment-returns": "/scm/purchase-consignment-returns",
  "procurement-overview": "/scm/procurement-overview", "op-catalog": "/scm/products", suppliers: "/scm/suppliers",
  mrp: "/scm/mrp", "purchase-orders": "/scm/purchase-orders", "po-amendments": "/scm/po-amendments",
  "po-cancellation-requests": "/scm/cancel-requests", receiving: "/scm/grns",
  "purchase-invoices": "/scm/purchase-invoices", "purchase-returns": "/scm/purchase-returns",
  "logistic-overview": "/scm/logistic-overview", "delivery-planning": "/scm/delivery-planning",
  "delivery-planning-driver": "/scm/delivery-planning-driver", "dp-orders": "/scm/dp-orders",
  "fleet-day": "/scm/fleet-day", "crew-leave": "/scm/driver-leave", "coverage-fleet": "/scm/delivery-maintenance",
  "delivery-zones": "/scm/delivery-zones", "rate-cards": "/scm/delivery-rate-cards", "fleet-health": "/fleet-health",
  "wh-loading-list": "/scm/loading-list", "wh-warehouses": "/scm/warehouses", "wh-racks": "/scm/warehouses/racks",
  stock: "/scm/inventory", "stock-adjustments": "/scm/stock-adjustments", "stock-transfers": "/scm/stock-transfers",
  "stock-takes": "/scm/stock-takes",
};

/** The Carres pages these three areas had before the engine, removed 11 Nov 2026 (owner). Their addresses
 *  (bookmarks, links in old messages) open the row of the nearest engine page. Paths match on whole segments,
 *  longest first; `?tab=` keys are the old tab-driven pages. */
const RETIRED_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["/operation/purchase-invoices", "purchase-invoices"], ["/operation/delivery-orders", "delivery-orders"],
  ["/operation/delivery/edit", "delivery-orders"], ["/operation/procurement", "purchase-orders"],
  ["/operation/purchasing", "purchase-orders"], ["/operation/old-orders", "orders"],
  ["/operation/amendments", "amendments"], ["/operation/stock/unit", "stock"],
  ["/operation/to-order", "purchase-orders"], ["/operation/orders", "orders"],
  ["/operation/settings/service", "service-maintenance"], ["/operation/settings/purchasing", "procurement-overview"],
  ["/operation/settings/delivery", "coverage-fleet"],
];
const RETIRED_TABS: Readonly<Record<string, string>> = {
  dashboard: "orders", "service-notes": "service-notes", guarantees: "service-notes", projects: "projects",
  "project-maintenance": "project-maintenance", orders: "orders", "all-orders": "orders",
  "delivery-returns": "delivery-returns", "load-scan": "delivery-orders",
  "customer-consignment-orders": "customer-consignment-orders", "consignment-notes": "consignment-notes",
  "customer-consignment-returns": "customer-consignment-returns", "consignment-receives": "consignment-receives",
  "consignment-returns": "consignment-returns", "display-requests": "customer-consignment-orders",
  "procurement-overview": "procurement-overview", "op-catalog": "op-catalog", catalog: "op-catalog",
  suppliers: "suppliers", "supplier-items": "suppliers", mrp: "mrp", purchase: "purchase-orders",
  "purchase-demands": "purchase-orders", "forecast-purchase": "purchase-orders", "manual-purchase": "purchase-orders",
  procurement: "purchase-orders", "po-amendments": "po-amendments", "po-cancellation-requests": "po-cancellation-requests",
  receiving: "receiving", "purchase-invoices": "purchase-invoices", "purchase-returns": "purchase-returns",
  claims: "purchase-returns", "repair-orders": "purchase-returns", "purchasing-settings": "procurement-overview",
  "purchasing-report": "procurement-overview", "receiving-report": "receiving",
  "logistic-overview": "logistic-overview", delivery: "delivery-planning", "delivery-planning": "delivery-planning",
  "dp-orders": "dp-orders", "auto-schedule": "delivery-planning", trips: "delivery-planning",
  "fleet-day": "fleet-day", "fleet-map": "coverage-fleet", "fleet-capacity": "coverage-fleet", fleet: "coverage-fleet",
  "crew-leave": "crew-leave", "coverage-fleet": "coverage-fleet", "delivery-zones": "delivery-zones",
  "rate-cards": "rate-cards", "fleet-health": "fleet-health", "delivery-report": "logistic-overview",
  "delivery-return-lines": "delivery-returns", "sales-order-lines": "orders", "delivery-order-lines": "delivery-orders",
  warehouses: "wh-warehouses", "stock-onhand": "stock", stock: "stock", showroom: "stock", warehouse: "stock",
  movements: "stock", "stock-plan": "stock", "ops-ready": "stock", "ops-reserved": "stock", "ops-repair": "stock",
  "ops-inventory": "stock", "ops-import": "orders", "ops-inbox": "orders",
  "stock-adjustments": "stock-adjustments", "stock-transfers": "stock-transfers", "stock-takes": "stock-takes",
  "warehouse-arrival-schedule": "receiving", "warehouse-monitor": "receiving", "warehouse-dashboard": "receiving",
  "warehouse-pickup-schedule": "wh-loading-list", "warehouse-inbound": "receiving",
  "warehouse-outbound": "delivery-orders", "arrival-source": "receiving",
};

/** The engine row a retired address opens, by key; null for every other address. */
export function retiredTarget(pathname: string, search: string): string | null {
  const hit = RETIRED_PATHS.find(([root]) => pathname === root || pathname.startsWith(`${root}/`));
  if (hit) return hit[1];
  if (pathname !== "/operation" && pathname !== "/operation/") return null;
  const tab = new URLSearchParams(search).get("tab");
  return RETIRED_TABS[tab ?? "dashboard"] ?? null;
}

/** Where a retired address goes: the engine row's own address, so the title, the lit row and the address agree. */
export function retiredRedirect(pathname: string, search: string): string | null {
  const key = retiredTarget(pathname, search);
  return key ? `/operation/sc/${key}` : null;
}

/** The engine page for this address: an engine row's own `/operation/sc/<row>` address. */
export function engineFor(pathname: string, _search = ""): string | null {
  const m = /^\/operation\/sc\/([a-z0-9-]+)\/?$/.exec(pathname);
  return (m && ENGINE_PAGES[m[1]]) || null;
}


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
  { label: "Operations", sections: ["Customer Care", "Projects"] },
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

/** The row of one area a URL stands on: its own path (or `financePath`), its
 *  `activeFor` matchers, then the `?tab=` it links to. */
function activeItem(group: PortalNavGroup, pathname: string, search: string): PortalNavItem | undefined {
  const tab = new URLSearchParams(search).get("tab") ?? group.defaultTab;
  // Whole segments: `/operation/sc/stock` is not standing on `/operation/sc/stock-adjustments`.
  const onPath = (prefix: string) => pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
  // A shortcut repeats a page that has its own row; the row, not the shortcut, is where the URL stands.
  const pathItem = group.items.find(
    (it) =>
      (it.path && !it.shortcut && onPath(it.path)) ||
      (it.financePath && onPath(it.financePath)) ||
      it.activeFor?.some((m) => m.startsWith("path:") && onPath(m.slice(5))),
  );
  return (
    pathItem ??
    (pathname === group.base || pathname === `${group.base}/`
      ? group.items.find(
          (it) =>
            !it.path &&
            (rowMatchesTab(group, it, tab, search) ||
              it.activeFor?.some((m) => m === `tab:${tab}`)),
        )
      : undefined)
  );
}

/** The module a URL stands in, named as the rail names it, for an IT request:
 *  the IT Hub's Reports group requests by it. Operations modules go by their own
 *  word ("Sales Order", "Procurement"); another area carries its name
 *  ("Finance · Money in"). "" when no row covers the URL. */
export function activeNavModule(pathname: string, search: string): string {
  for (const group of PORTAL_NAV) {
    const item = activeItem(group, pathname, search);
    if (!item) continue;
    const name = PORTAL_MODULES.find((m) => m.section === item.section)?.label ?? item.section ?? "";
    if (group.area === "operation") return name;
    return name ? `${group.label} · ${name}` : group.label;
  }
  return "";
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
  const item = activeItem(group, pathname, search);
  if (!item) return null;
  const moduleRow = PORTAL_MODULES.find((m) => m.section === item.section);
  const siblings = group.items.filter((it) => it.section === item.section).length;
  return {
    crumb: item.crumb ?? (moduleRow && siblings > 1 && moduleRow.label !== item.label ? moduleRow.label : null),
    title: item.label,
  };
}
