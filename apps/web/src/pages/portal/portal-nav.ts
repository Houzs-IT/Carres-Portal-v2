import {
  LayoutDashboard,
  ClipboardList,
  Boxes,
  Repeat,
  ArrowLeftRight,
  Wallet,
  BookOpen,
  Truck,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  PackageCheck,
  Undo2,
  Scale,
  BarChart3,
  BadgeCheck,
  LayoutGrid,
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
  Handshake,
  ClipboardCheck,
  Sofa,
  FolderKanban,
  type LucideIcon,
  Package,
  Zap,
  Wrench,
  DollarSign,
  Calendar,
  MapPinned,
  Send,
  RotateCcw,
  CornerUpLeft,
  PackageOpen,
  Reply,
  Calculator,
  Map as MapIcon,
  Building2,
  Mail,
  LifeBuoy,
  ListChecks,
  AlertCircle,
  Activity,
  Sparkles,
  Server,
  Bot,
  ScanLine,
  Megaphone,
} from "lucide-react";
import type { Role } from "@carres/shared/domain";
import { PURCHASING_LANDING_KEY, type PageGroupKey } from "./menu-tree";
import type { EngineBadge } from "./engine-badges";
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

export type PortalArea = "operation" | "finance" | "principal";

/** Operation badge keys surfaced as nav counters (reuses the 0083 unread set). */
export type PortalBadge = "orders" | "procurement" | "service-notes" | EngineBadge;

export type PortalSection =
  | "Workspace"
  | "Sales"
  | "Consignment"
  | "Purchasing"
  | "Showroom"
  | "Delivery"
  | "Warehouse"
  | "Customer Care"
  /* Fairs, exhibitions and solo roadshows (0750, Houzs Projects). */
  | "Projects"
  /* Rows that hang directly under Supply Chain, outside its modules (Houzs: Product Request). */
  | "Supply Chain"
  /* SYSTEM (Houzs Sidebar.tsx section "system"; owner 11 Nov 2026): the Team module; Houzs's two plain
   * Operations rows Mail Center and Announcements ("Operations Rows", kept in SYSTEM where the owner put Mail
   * Center); Houzs's IT group (System Health, AI Usage); then Houzs's plain System rows ("System"). */
  | "Team"
  | "Operations Rows"
  | "IT"
  | "System"
  /* HOUZS FINANCE (engine; owner 11 Nov 2026): Houzs's Finance group (Sidebar.tsx:736-873), its plain rows
   * (To do, Money today), its five sub-groups and its one Reports entry. Kept apart from the Carres Finance
   * sections below, which belong to the old Carres Finance area. */
  | "Finance"
  | "Finance Money in"
  | "Finance Money out"
  | "Finance Bank"
  | "Finance Books"
  | "Finance Reports"
  | "Finance Setup"
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
  "Supply Chain",
  "Sales",
  "Consignment",
  "Purchasing",
  "Delivery",
  "Warehouse",
  "Showroom",
  /* Houzs Finance, after Supply Chain as in Houzs. */
  "Finance",
  "Finance Money in",
  "Finance Money out",
  "Finance Bank",
  "Finance Books",
  "Finance Reports",
  "Finance Setup",
  "Team",
  "Operations Rows",
  "IT",
  "System",
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

export const PORTAL_MODULES: ReadonlyArray<PortalModule> = [
  /* The Supply Chain modules carry the Houzs words (Sidebar.tsx:526-669). */
  { section: "Sales", label: "Sales Order", icon: ShoppingCart, mIcon: "receipt_long" },
  { section: "Consignment", label: "Consignment", icon: Handshake, mIcon: "handshake" },
  { section: "Purchasing", label: "Procurement", icon: Package, landingKey: PURCHASING_LANDING_KEY, handleOnly: true },
  { section: "Showroom", label: "Showroom", icon: Store, mIcon: "storefront" },
  { section: "Delivery", label: "Transportation", icon: Truck, mIcon: "local_shipping" },
  { section: "Warehouse", label: "Warehouse", icon: Warehouse, landingKey: WAREHOUSE_LANDING_KEY },
  { section: "Customer Care", label: "Service Cases", icon: Zap, mIcon: "support_agent" },
  { section: "Projects", label: "Projects", icon: FolderKanban, mIcon: "event" },
  /* Houzs Finance's sub-groups, Houzs words and icons (Sidebar.tsx:761-871). A Houzs group only opens and
   * shuts (it has no `to`), so the row goes nowhere. Reports is one entry, so it draws as a plain row. */
  { section: "Finance Money in", label: "Money in", icon: HandCoins, handleOnly: true },
  { section: "Finance Money out", label: "Money out", icon: Wallet, handleOnly: true },
  { section: "Finance Bank", label: "Bank & cards", icon: Landmark, handleOnly: true },
  { section: "Finance Books", label: "Books", icon: BookOpen, handleOnly: true },
  { section: "Finance Setup", label: "Setup", icon: Settings, handleOnly: true },
  /* System, Houzs words (Sidebar.tsx:963-1000). */
  { section: "Team", label: "Team", icon: Users },
  /* Houzs's IT group has no `to` (Sidebar.tsx:1004-1013): its row only opens and shuts. */
  { section: "IT", label: "IT", icon: Server, handleOnly: true },
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
  /** The roles an item WITHOUT its own `roles` shows to, when that is narrower than the group's: the
   *  Operations group admits `hr` for its System rows only (owner 11 Nov 2026). */
  itemRoles?: ReadonlyArray<Role>;
  /** the tab key the area lands on by default (operation/principal). */
  defaultTab: string;
  items: PortalNavItem[];
}

/** Who sees the System rows: everyone who sees Operations, and `hr` (owner 11 Nov 2026). */
const SYSTEM_ROLES: ReadonlyArray<Role> = ["operation", "principal", "hr"];
/** Who sees the Houzs Finance rows: everyone who sees Operations, and `finance` (owner 11 Nov 2026). What each
 *  person may open inside it is the engine's own role (Team > Roles & Permissions), as in Houzs. */
const FINANCE_ROLES: ReadonlyArray<Role> = ["operation", "principal", "finance"];

export const PORTAL_NAV: PortalNavGroup[] = [
  {
    area: "operation",
    label: "Operations",
    base: "/operation",
    /* `hr` sees only the rows that name it (Payment Requests by grant, and the System rows): the Carres
     * HR area is removed (owner, 11 Nov 2026) and Houzs's Team is where people are kept now. */
    /* `finance` sees only the Houzs Finance rows (FINANCE_ROLES). */
    roles: ["operation", "principal", "hr", "finance"],
    itemRoles: ["operation", "principal"],
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

      /* WORKSPACE — Houzs's Overview first, as in Houzs. */
      { key: "overview", label: "Overview", icon: LayoutDashboard, path: "/operation/sc/overview", section: "Workspace" },
      { key: "orders-shortcut", label: "Sales Orders", icon: ShoppingCart, mIcon: "shopping_cart", path: "/operation/sc/orders", shortcut: true, section: "Workspace" },
      /* The one Workspace row shown by a grant, not a role (0645; Chew 2026-10-03,
       * Finance MASTER §3.3). It opens Houzs's own Payment Requests (the engine page Finance > Money out
       * opens too; owner 11 Nov 2026, the Houzs pages are the system), with the same count. Its own row key,
       * so `hr`, who does not see the Houzs Finance rows, may still open it (roleMayOpenEngineRow). */
      {
        key: "payment-requests",
        label: "Payment Requests",
        icon: HandCoins,
        path: "/operation/sc/payment-requests",
        badge: "payment-requests-waiting",
        section: "Workspace",
        roles: ["operation", "principal", "hr"],
        needs: "payment-requester",
      },
      // Carres-only: My Work / Team Work and a person's own leave (0670).
      { key: "work", label: "Workspace", icon: Home, mIcon: "home", section: "Workspace" },
      { key: "leave", label: "Leave", icon: CalendarOff, mIcon: "event_busy", section: "Workspace" },

      /* SERVICE CASES */
      { key: "service-quality", label: "Quality Overview", icon: ShieldCheck, path: "/operation/sc/service-quality", section: "Customer Care" },
      { key: "service-notes", label: "Service Cases", icon: ClipboardList, path: "/operation/sc/service-notes", section: "Customer Care" },
      { key: "service-maintenance", label: "Service Maintenance", icon: Wrench, path: "/operation/sc/service-maintenance", section: "Customer Care" },
      { key: "service-mine", label: "My Cases", icon: ClipboardCheck, path: "/operation/sc/service-mine", section: "Customer Care" },

      /* PROJECTS */
      { key: "project-overview", label: "Project Overview", icon: DollarSign, path: "/operation/sc/project-overview", section: "Projects" },
      { key: "projects", label: "Project List", icon: ClipboardList, path: "/operation/sc/projects", section: "Projects" },
      { key: "project-calendar", label: "Calendar", icon: Calendar, path: "/operation/sc/project-calendar", section: "Projects" },
      { key: "project-maintenance", label: "Project Maintenance", icon: Wrench, path: "/operation/sc/project-maintenance", section: "Projects" },

      /* SUPPLY CHAIN — Houzs's Product Request row directly under Supply Chain (it is also in Consignment). */
      { key: "product-request", label: "Product Request", icon: Sofa, path: "/operation/sc/product-request", badge: "product-request-approvals", section: "Supply Chain" },

      /* SUPPLY CHAIN · SALES ORDER */
      { key: "orders", label: "Sales Orders", crumb: "Sales Order", icon: ShoppingCart, path: "/operation/sc/orders", section: "Sales" },
      { key: "fair-pending", label: "Fair Links to Settle", icon: MapPinned, path: "/operation/sc/fair-pending", badge: "fair-links-to-settle", section: "Sales" },
      { key: "amendments", label: "Sales Order Amendment", icon: History, path: "/operation/sc/amendments", badge: "amendment-approvals", section: "Sales" },
      { key: "payment-backdate-requests", label: "Payment Backdate Requests", icon: ClipboardCheck, path: "/operation/sc/payment-backdate-requests", badge: "payment-backdate-approvals", section: "Sales" },
      { key: "delivery-orders", label: "Delivery Orders", icon: Send, path: "/operation/sc/delivery-orders", section: "Sales" },
      { key: "sales-invoices", label: "Sales Invoices", icon: FileText, path: "/operation/sc/sales-invoices", section: "Sales" },
      { key: "delivery-returns", label: "Delivery Returns", icon: RotateCcw, path: "/operation/sc/delivery-returns", section: "Sales" },
      // Carres-only (`docs/rental/MASTER.md`): the second kind of customer order. Last, so the Houzs rows keep Houzs's order.
      { key: "rental", label: "Subscription", icon: Repeat, section: "Sales" },

      /* SUPPLY CHAIN · CONSIGNMENT */
      { key: "customer-consignment-orders", label: "Consignment Order", icon: Handshake, path: "/operation/sc/customer-consignment-orders", section: "Consignment" },
      { key: "consignment-notes", label: "Consignment Note", icon: FileText, path: "/operation/sc/consignment-notes", section: "Consignment" },
      { key: "customer-consignment-returns", label: "Consignment Return", icon: CornerUpLeft, path: "/operation/sc/customer-consignment-returns", section: "Consignment" },
      { key: "purchase-consignment-orders", label: "Purchase Consignment Order", icon: HandCoins, path: "/operation/sc/purchase-consignment-orders", section: "Consignment" },
      { key: "product-requests", label: "Product Request", icon: Sofa, path: "/operation/sc/product-requests", badge: "product-request-approvals", section: "Consignment" },
      { key: "consignment-receives", label: "Purchase Consignment Receive", icon: PackageOpen, path: "/operation/sc/consignment-receives", section: "Consignment" },
      { key: "consignment-returns", label: "Purchase Consignment Return", icon: Reply, path: "/operation/sc/consignment-returns", section: "Consignment" },

      /* SUPPLY CHAIN · PROCUREMENT */
      { key: "procurement-overview", label: "Procurement Overview", icon: LayoutDashboard, path: "/operation/sc/procurement-overview", section: "Purchasing" },
      { key: "op-catalog", label: "Products & Maintenance", icon: Sofa, path: "/operation/sc/op-catalog", section: "Purchasing" },
      { key: "suppliers", label: "Suppliers", icon: Truck, path: "/operation/sc/suppliers", section: "Purchasing" },
      { key: "mrp", label: "MRP · Stock Status", icon: Calculator, path: "/operation/sc/mrp", section: "Purchasing" },
      { key: "purchase-orders", label: "Purchase Orders", icon: ClipboardList, path: "/operation/sc/purchase-orders", section: "Purchasing" },
      { key: "po-amendments", label: "PO Amendments", icon: History, path: "/operation/sc/po-amendments", badge: "po-amendment-approvals", section: "Purchasing" },
      { key: "po-cancellation-requests", label: "Cancellation Requests", icon: ClipboardCheck, path: "/operation/sc/po-cancellation-requests", section: "Purchasing" },
      { key: "receiving", label: "Goods Receipt", icon: PackageCheck, path: "/operation/sc/receiving", section: "Purchasing" },
      { key: "purchase-invoices", label: "Purchase Invoices", icon: ReceiptText, path: "/operation/sc/purchase-invoices", section: "Purchasing" },
      { key: "purchase-returns", label: "Purchase Returns", icon: Undo2, path: "/operation/sc/purchase-returns", section: "Purchasing" },

      /* SUPPLY CHAIN · TRANSPORTATION */
      { key: "logistic-overview", label: "Logistic Overview", icon: LayoutDashboard, path: "/operation/sc/logistic-overview", section: "Delivery" },
      { key: "delivery-planning", label: "Delivery Planning", icon: Send, path: "/operation/sc/delivery-planning", section: "Delivery" },
      { key: "delivery-planning-driver", label: "Last Mile Delivery (Driver)", icon: ClipboardList, path: "/operation/sc/delivery-planning-driver", section: "Delivery" },
      { key: "dp-orders", label: "DP Orders", icon: ClipboardList, path: "/operation/sc/dp-orders", section: "Delivery" },
      { key: "fleet-day", label: "Last Mile Delivery", icon: MapPinned, path: "/operation/sc/fleet-day", section: "Delivery" },
      { key: "crew-leave", label: "Crew Leave", icon: CalendarOff, path: "/operation/sc/crew-leave", section: "Delivery" },
      { key: "coverage-fleet", label: "Coverage & Fleet", icon: MapIcon, path: "/operation/sc/coverage-fleet", section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "delivery-zones", label: "Delivery Zones", icon: MapPinned, path: "/operation/sc/delivery-zones", section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "rate-cards", label: "Carriers & Rates", icon: Handshake, path: "/operation/sc/rate-cards", section: "Delivery", pageGroup: "transportation-maintenance" },
      { key: "fleet-health", label: "Fleet Health", icon: Wrench, path: "/operation/sc/fleet-health", section: "Delivery", pageGroup: "transportation-maintenance" },

      /* SUPPLY CHAIN · WAREHOUSE */
      { key: "wh-loading-list", label: "Loading List", icon: ClipboardList, path: "/operation/sc/wh-loading-list", section: "Warehouse" },
      { key: "wh-warehouses", label: "Warehouses", icon: Warehouse, path: "/operation/sc/wh-warehouses", section: "Warehouse" },
      { key: "wh-racks", label: "Racks & Bins", icon: Boxes, path: "/operation/sc/wh-racks", section: "Warehouse" },
      { key: "stock", label: "Inventory", icon: Package, path: "/operation/sc/stock", section: "Warehouse" },
      { key: "stock-adjustments", label: "Adjustments", icon: SlidersHorizontal, path: "/operation/sc/stock-adjustments", section: "Warehouse" },
      { key: "stock-transfers", label: "Transfers", icon: ArrowLeftRight, path: "/operation/sc/stock-transfers", section: "Warehouse" },
      { key: "stock-takes", label: "Stock Take", icon: ClipboardCheck, path: "/operation/sc/stock-takes", section: "Warehouse" },

      /* FINANCE — Houzs's whole Finance group (Sidebar.tsx:736-873; owner 11 Nov 2026): its rows, order,
       * words, icons and addresses. Also shown to `finance`. */
      { key: "fin-todo", label: "To do", icon: ListChecks, path: "/operation/sc/fin-todo", badge: "finance-todo", section: "Finance", roles: FINANCE_ROLES },
      { key: "fin-money-today", label: "Money today", icon: Landmark, path: "/operation/sc/fin-money-today", section: "Finance", roles: FINANCE_ROLES },
      { key: "fin-receipts", label: "Receipts", icon: Receipt, path: "/operation/sc/fin-receipts", section: "Finance Money in", roles: FINANCE_ROLES },
      { key: "fin-invoices", label: "Invoices", icon: FileText, path: "/operation/sc/fin-invoices", section: "Finance Money in", roles: FINANCE_ROLES },
      { key: "fin-debtors", label: "Debtor maintenance", icon: Settings, path: "/operation/sc/fin-debtors", section: "Finance Money in", roles: FINANCE_ROLES },
      { key: "fin-credit-notes", label: "Credit / debit notes", icon: FileText, path: "/operation/sc/fin-credit-notes", section: "Finance Money in", roles: FINANCE_ROLES },
      { key: "fin-outstanding", label: "Outstanding", icon: AlertCircle, path: "/operation/sc/fin-outstanding", section: "Finance Money in", roles: FINANCE_ROLES },
      { key: "fin-not-billed", label: "Not yet billed", icon: HandCoins, path: "/operation/sc/fin-not-billed", section: "Finance Money in", roles: FINANCE_ROLES },
      { key: "fin-payment-vouchers", label: "Payment vouchers", icon: Wallet, path: "/operation/sc/fin-payment-vouchers", section: "Finance Money out", roles: FINANCE_ROLES },
      { key: "fin-payment-listing", label: "Payment listing", icon: ListChecks, path: "/operation/sc/fin-payment-listing", section: "Finance Money out", roles: FINANCE_ROLES },
      { key: "fin-payment-requests", label: "Payment requests", icon: HandCoins, path: "/operation/sc/fin-payment-requests", badge: "payment-requests-waiting", section: "Finance Money out", roles: FINANCE_ROLES },
      { key: "fin-supplier-bills", label: "Supplier bills", icon: FileText, path: "/operation/sc/fin-supplier-bills", section: "Finance Money out", roles: FINANCE_ROLES },
      { key: "fin-supplier-maintenance", label: "Supplier maintenance", icon: Truck, path: "/operation/sc/fin-supplier-maintenance", section: "Finance Money out", roles: FINANCE_ROLES },
      { key: "fin-official-docs", label: "Official invoices owed", icon: FileText, path: "/operation/sc/fin-official-docs", section: "Finance Money out", roles: FINANCE_ROLES },
      { key: "fin-supplier-notes", label: "Supplier & other creditor CN / DN", icon: FileText, path: "/operation/sc/fin-supplier-notes", section: "Finance Money out", roles: FINANCE_ROLES },
      { key: "fin-merchant-recon", label: "Merchant reports", icon: CreditCard, path: "/operation/sc/fin-merchant-recon", section: "Finance Bank", roles: FINANCE_ROLES },
      { key: "fin-bank-recon", label: "Bank statements", icon: Banknote, path: "/operation/sc/fin-bank-recon", section: "Finance Bank", roles: FINANCE_ROLES },
      { key: "fin-daily-bank", label: "Daily Bank", icon: Landmark, path: "/operation/sc/fin-daily-bank", section: "Finance Bank", roles: FINANCE_ROLES },
      { key: "fin-unmatched", label: "Unmatched Payments", icon: AlertCircle, path: "/operation/sc/fin-unmatched", section: "Finance Bank", roles: FINANCE_ROLES },
      { key: "fin-journal", label: "Journal entries", icon: BookOpen, path: "/operation/sc/fin-journal", section: "Finance Books", roles: FINANCE_ROLES },
      { key: "fin-gl", label: "General ledger", icon: FileText, path: "/operation/sc/fin-gl", section: "Finance Books", roles: FINANCE_ROLES },
      { key: "fin-tb", label: "Trial balance", icon: Receipt, path: "/operation/sc/fin-tb", section: "Finance Books", roles: FINANCE_ROLES },
      { key: "fin-self-check", label: "Self-check", icon: ClipboardCheck, path: "/operation/sc/fin-self-check", section: "Finance Books", roles: FINANCE_ROLES },
      { key: "fin-stock-close", label: "Stock close", icon: History, path: "/operation/sc/fin-stock-close", section: "Finance Books", roles: FINANCE_ROLES },
      /* Houzs's one Reports entry: it opens the first report (P&L); every report lights it (ENGINE_ROW_ALIASES). */
      { key: "fin-reports", label: "Reports", icon: BarChart3, path: "/operation/sc/fin-reports", section: "Finance Reports", roles: FINANCE_ROLES },
      { key: "fin-coa", label: "Chart of accounts", icon: Settings, path: "/operation/sc/fin-coa", section: "Finance Setup", roles: FINANCE_ROLES },
      { key: "fin-opening-balance", label: "Opening balance", icon: Settings, path: "/operation/sc/fin-opening-balance", section: "Finance Setup", roles: FINANCE_ROLES },
      { key: "fin-item-groups", label: "Item groups", icon: Settings, path: "/operation/sc/fin-item-groups", section: "Finance Setup", roles: FINANCE_ROLES },
      { key: "fin-recon-setup", label: "Recon setup", icon: Settings, path: "/operation/sc/fin-recon-setup", section: "Finance Setup", roles: FINANCE_ROLES },
      { key: "fin-currencies", label: "Currencies", icon: DollarSign, path: "/operation/sc/fin-currencies", section: "Finance Setup", roles: FINANCE_ROLES },
      { key: "fin-deposit-invoices", label: "Deposit invoices", icon: Receipt, path: "/operation/sc/fin-deposit-invoices", section: "Finance Setup", roles: FINANCE_ROLES },
      { key: "fin-todo-rules", label: "To do rules", icon: ListChecks, path: "/operation/sc/fin-todo-rules", section: "Finance Setup", roles: FINANCE_ROLES },

      /* SYSTEM — Houzs's Team, Mail Center and IT Support (Sidebar.tsx:922-1085; owner 11 Nov 2026), and every
       * other Houzs row the engine keeps (navOnly.ts KEEP; 12 Nov 2026): Announcements beside Mail Center, the
       * IT group, Change Log, Assistant, Agent Console and OCR, in Houzs's order with Houzs's words and icons.
       * Houzs's own gates (it.pages.view, `*`, scm.changelog.read, org.assistant.use) stay inside the engine.
       * Also shown to `hr`. */
      { key: "team-directory", label: "Directory", icon: Users, path: "/operation/sc/team-directory", section: "Team", roles: SYSTEM_ROLES },
      { key: "team-org-chart", label: "Org Chart", icon: Network, path: "/operation/sc/team-org-chart", section: "Team", roles: SYSTEM_ROLES },
      { key: "team-departments", label: "Departments", icon: Building2, path: "/operation/sc/team-departments", section: "Team", roles: SYSTEM_ROLES },
      { key: "team-mailboxes", label: "Mailboxes", icon: Mail, path: "/operation/sc/team-mailboxes", section: "Team", roles: SYSTEM_ROLES },
      { key: "team-roles", label: "Roles & Permissions", icon: ShieldCheck, path: "/operation/sc/team-roles", section: "Team", roles: SYSTEM_ROLES },
      { key: "mail-center", label: "Mail Center", icon: Mail, path: "/operation/sc/mail-center", section: "Operations Rows", roles: SYSTEM_ROLES },
      { key: "announcements", label: "Announcements", icon: Megaphone, path: "/operation/sc/announcements", section: "Operations Rows", roles: SYSTEM_ROLES },
      { key: "system-health", label: "System Health", icon: Activity, path: "/operation/sc/system-health", section: "IT", roles: SYSTEM_ROLES },
      { key: "ai-usage", label: "AI Usage", icon: Sparkles, path: "/operation/sc/ai-usage", section: "IT", roles: SYSTEM_ROLES },
      { key: "change-log", label: "Change Log", icon: History, path: "/operation/sc/change-log", section: "System", roles: SYSTEM_ROLES },
      { key: "assistant", label: "Assistant", icon: Bot, path: "/operation/sc/assistant", section: "System", roles: SYSTEM_ROLES },
      { key: "agent-console", label: "Agent Console", icon: Bot, path: "/operation/sc/agent-console", section: "System", roles: SYSTEM_ROLES },
      { key: "it-support", label: "IT Support", icon: LifeBuoy, path: "/operation/sc/it-support", section: "System", roles: SYSTEM_ROLES },
      { key: "ocr", label: "OCR", icon: ScanLine, path: "/operation/sc/ocr", section: "System", roles: SYSTEM_ROLES },
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
      { key: "orders", label: "Sales Orders", icon: ShoppingCart, path: "/operation/orders" },
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
  {
    area: "finance",
    /* The old Carres Finance, moved to the very bottom of the menu (owner, 11 Nov 2026) under its own word, so
     * it is not a second "Finance" beside Houzs's Finance group in Operations. Nothing in it is removed. */
    label: "Finance (old)",
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
];
/** Service Cases, Projects and Supply Chain: each row's engine page (engine/, Houzs's own screens), shown in a
 *  frame at the row's `/operation/sc/<row>` address. Keyed by row, valued by the engine address. */
export const ENGINE_PAGES: Readonly<Record<string, string>> = {
  // The hub pages Houzs opens when a module's own row is clicked (ENGINE_HUBS).
  "hub-scm": "/scm", "hub-service": "/assr?view=hub", "hub-projects": "/projects?view=hub",
  "hub-sales": "/scm/sales-order", "hub-consignment": "/scm/consignment", "hub-procurement": "/scm/procurement",
  "hub-transportation": "/scm/transportation", "hub-warehouse": "/scm/warehouse",
  "service-quality": "/assr?view=metrics", "service-notes": "/assr?view=cases",
  overview: "/", "product-request": "/scm/product-requests", "sales-invoices": "/scm/sales-invoices",
  "service-maintenance": "/assr?view=settings", "service-mine": "/my-cases",
  "project-overview": "/projects?view=finances", projects: "/projects?view=list",
  "project-calendar": "/projects?view=calendar", "project-maintenance": "/projects?view=maintenance",
  orders: "/scm/sales-orders", "orders-shortcut": "/scm/sales-orders",
  // The Workspace door to Houzs's Payment Requests (the same page as `fin-payment-requests`).
  "payment-requests": "/scm/payment-requests",
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
  "hub-team": "/team?tab=hub", "team-directory": "/team?tab=directory", "team-org-chart": "/team?tab=orgchart2",
  "team-departments": "/team?tab=departments2", "team-mailboxes": "/team?tab=mail2", "team-roles": "/team?tab=permissions",
  "mail-center": "/mail-center", "it-support": "/it-support",
  // The rest of Houzs's System rows the engine keeps (navOnly.ts KEEP), and Announcements.
  announcements: "/announcements", "system-health": "/system-health", "ai-usage": "/ai-usage",
  "change-log": "/change-log", assistant: "/assistant", "agent-console": "/agents", ocr: "/ocr",
  // Houzs Finance (Sidebar.tsx:736-873).
  "fin-todo": "/scm/finance", "fin-money-today": "/scm/daily-bank?view=board", "fin-receipts": "/scm/receipts",
  "fin-invoices": "/scm/ar-invoices", "fin-debtors": "/scm/other-debtors",
  "fin-credit-notes": "/scm/credit-notes", "fin-outstanding": "/scm/outstanding",
  "fin-not-billed": "/scm/unbilled-deliveries", "fin-payment-vouchers": "/scm/payment-vouchers",
  "fin-payment-listing": "/scm/payment-listing", "fin-payment-requests": "/scm/payment-requests",
  "fin-supplier-bills": "/scm/ap-invoices", "fin-supplier-maintenance": "/scm/supplier-maintenance",
  "fin-official-docs": "/scm/official-docs", "fin-supplier-notes": "/scm/supplier-notes",
  "fin-merchant-recon": "/scm/merchant-recon", "fin-bank-recon": "/scm/bank-recon",
  "fin-daily-bank": "/scm/daily-bank", "fin-unmatched": "/scm/unmatched-payments",
  "fin-journal": "/scm/accounting?tab=je", "fin-gl": "/scm/accounting?tab=gl",
  "fin-tb": "/scm/accounting?tab=tb", "fin-self-check": "/scm/accounting?tab=check",
  "fin-stock-close": "/scm/accounting?tab=close", "fin-reports": "/scm/accounting?tab=pnl",
  "fin-coa": "/scm/chart-of-accounts", "fin-opening-balance": "/scm/opening-balance",
  "fin-item-groups": "/scm/accounting?tab=groups", "fin-recon-setup": "/scm/settlement-setup",
  "fin-currencies": "/scm/currencies", "fin-deposit-invoices": "/scm/finance/deposit-invoices",
  "fin-todo-rules": "/scm/finance/rules",
  // Houzs's own Settings: the menu's Settings gear opens it (owner, 11 Nov 2026). No menu row of its own.
  settings: "/settings",
};

/** Engine pages a row stands for beyond its own page: Houzs's one Reports entry is lit on every report (its
 *  reports catalogue, pages/scm-v2/reports-catalog.ts) and on a Books page opened from the report list
 *  (`in=reports`, Sidebar.tsx `alsoActive`). An alias outranks a row page of the same length. */
export const ENGINE_ROW_ALIASES: Readonly<Record<string, ReadonlyArray<string>>> = {
  "fin-reports": [
    "/scm/accounting?tab=bs", "/scm/accounting?tab=rp", "/scm/accounting?tab=ar", "/scm/accounting?tab=ap",
    "/scm/accounting?tab=collection", "/scm/accounting?tab=performance", "/scm/accounting?tab=products",
    "/scm/accounting?tab=events", "/scm/accounting?tab=commission", "/scm/accounting?tab=logistics",
    "/scm/accounting?tab=charges", "/scm/accounting?tab=corrections", "/scm/accounting?in=reports",
    "/scm/forecast", "/scm/finance-dashboard", "/reports/fair-report",
  ],
};

/** The Settings gear's address outside Finance: Houzs's own Settings (ENGINE_PAGES `settings`). */
export const ENGINE_SETTINGS_HREF = "/operation/sc/settings";
/** Report a problem to IT opens Houzs's IT Support row. */
export const IT_SUPPORT_HREF = "/operation/sc/it-support";

/** The Carres pages these three areas had before the engine, removed 11 Nov 2026 (owner). Their addresses
 *  (bookmarks, links in old messages) open the row of the nearest engine page. Paths match on whole segments,
 *  longest first; `?tab=` keys are the old tab-driven pages. */
const RETIRED_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["/operation/purchase-invoices", "purchase-invoices"], ["/operation/delivery-orders", "delivery-orders"],
  ["/operation/delivery/edit", "delivery-orders"], ["/operation/procurement", "purchase-orders"],
  ["/operation/purchasing", "purchase-orders"], ["/operation/old-orders", "orders"],
  ["/operation/amendments", "amendments"], ["/operation/stock/unit", "stock"],
  ["/operation/to-order", "purchase-orders"], ["/operation/orders", "orders"],
  /* The Carres Staff & Duties page went to Houzs Team (owner, 12 Nov 2026): its old address opens Team › Departments. */
  ["/operation/settings/staff-duties", "team-departments"],
  /* The Carres Settings workspace, removed 11 Nov 2026 (owner): every old Settings address opens Houzs's own. */
  ["/operation/settings", "settings"],
  /* The Carres Issue Tracker and its monthly report, removed from the menu 11 Nov 2026 (owner). */
  ["/operation/issues", "orders"],
  /* The Carres HR area, removed 11 Nov 2026 (owner): Houzs's Team keeps the people now. */
  ["/hr", "hub-team"],
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
  // The Carres Sales invoice lines report, removed from the menu 11 Nov 2026 (owner).
  "sales-invoice-lines": "orders",
};

/** Houzs's module rows open a hub page (Houzs Sidebar.tsx `to`): Service Cases, Projects, each Supply Chain
 *  module, and Supply Chain itself ("supply-chain", the Operations fold row). Keyed by section, valued by
 *  the ENGINE_PAGES key. */
export const ENGINE_HUBS: Readonly<Partial<Record<PortalSection | "supply-chain" | "finance", string>>> = {
  "supply-chain": "hub-scm",
  /* Houzs's Finance row opens Finance's To do (Sidebar.tsx:741 `to: "/scm/finance"`). */
  finance: "fin-todo", "Customer Care": "hub-service", Projects: "hub-projects", Sales: "hub-sales",
  Consignment: "hub-consignment", Purchasing: "hub-procurement", Delivery: "hub-transportation", Warehouse: "hub-warehouse",
  Team: "hub-team",
};

/** The section whose hub this address shows, or null. */
export function hubSectionFor(pathname: string): PortalSection | "supply-chain" | null {
  const m = /^\/operation\/sc\/(hub-[a-z-]+)\/?$/.exec(pathname);
  if (!m) return null;
  const hit = Object.entries(ENGINE_HUBS).find(([, key]) => key === m[1]);
  return (hit?.[0] as PortalSection | "supply-chain" | undefined) ?? null;
}

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
export function engineFor(pathname: string, search = ""): string | null {
  const m = /^\/operation\/sc\/([a-z0-9-]+)\/?$/.exec(pathname);
  const page = (m && ENGINE_PAGES[m[1]]) || null;
  if (!page) return null;
  // `?at=` keeps the exact engine page the frame moved to (a record, a form), so a refresh reopens it.
  const at = new URLSearchParams(search).get("at");
  return at && at.startsWith("/") && !at.startsWith("//") ? at : page;
}

/** Rows that only repeat another row's page: never the row a frame move lights. */
const ENGINE_SHORTCUT_ROWS = new Set(["orders-shortcut", "product-request", "payment-requests"]);
/** Shortcut rows that keep their own address when the frame moves under their page: the Workspace door to
 *  Payment Requests, which `hr` may open though it may not open the Finance row of the same page. */
const ENGINE_DOOR_ROWS = new Set(["payment-requests"]);

/** How closely the engine page `page` covers `url` (a longer, more specific page scores higher), or null when
 *  `url` is neither that page nor under it. */
function coverScore(page: string, url: URL): number | null {
  const p = new URL(page, "http://engine");
  const onPath = p.pathname === "/" ? url.pathname === "/" : url.pathname === p.pathname || url.pathname.startsWith(`${p.pathname}/`);
  if (!onPath) return null;
  const params = [...p.searchParams];
  if (!params.every(([k, v]) => url.searchParams.get(k) === v)) return null;
  return p.pathname.length * 10 + params.length;
}

/** The menu row for a page the frame moved to: the row whose engine page it is, or sits under (a record or
 *  form below a list), the most specific match winning. Null when no row covers it. */
export function engineRowFor(enginePath: string): string | null {
  let url: URL;
  try { url = new URL(enginePath, "http://engine"); } catch { return null; }
  let best: { key: string; score: number } | null = null;
  const pages: Array<[string, string, number]> = [
    ...Object.entries(ENGINE_PAGES).map(([key, page]): [string, string, number] => [key, page, 0]),
    ...Object.entries(ENGINE_ROW_ALIASES).flatMap(([key, list]) => list.map((page): [string, string, number] => [key, page, 0.5])),
  ];
  for (const [key, page, bonus] of pages) {
    if (ENGINE_SHORTCUT_ROWS.has(key)) continue;
    const covered = coverScore(page, url);
    if (covered == null) continue;
    const score = covered + bonus;
    if (!best || score > best.score) best = { key, score };
  }
  return best?.key ?? null;
}

/** The portal address for a page the frame moved to: its row's own address, plus `?at=` when the page is not
 *  the row's own page. Null when no row covers it. `stayOn` is the row the address shows now: when it is a
 *  door that repeats the found row's page (ENGINE_DOOR_ROWS), the door keeps it, so a person who may open
 *  only the door (`hr` and Payment Requests) is never sent to a row they may not open. */
export function engineAddressFor(enginePath: string, stayOn?: string | null): string | null {
  let key = engineRowFor(enginePath);
  if (key && stayOn && ENGINE_DOOR_ROWS.has(stayOn) && ENGINE_PAGES[stayOn] === ENGINE_PAGES[key]) key = stayOn;
  if (!key) return null;
  return ENGINE_PAGES[key] === enginePath ? `/operation/sc/${key}` : `/operation/sc/${key}?at=${encodeURIComponent(enginePath)}`;
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
  return group.items.filter((it) => {
    const roles = it.roles ?? group.itemRoles;
    return (!roles || (role != null && roles.includes(role))) && (!it.needs || caps.has(it.needs));
  });
}

/** May this role open the engine row `key` (an ENGINE_PAGES key)? Operations staff and the principal open
 *  every row; a role the Operations group admits only for some rows (`hr`) opens those rows and the hub of
 *  their module. A grant (`needs`) is not asked here: the page it opens checks it. */
export function roleMayOpenEngineRow(role: Role | null, key: string): boolean {
  const group = PORTAL_NAV.find((g) => g.area === "operation");
  if (!group || role == null || !group.roles.includes(role) || !(key in ENGINE_PAGES)) return false;
  if (role === "operation" || role === "principal") return true;
  const allowed = (it: PortalNavItem) => (it.roles ?? group.itemRoles ?? group.roles).includes(role);
  const item = group.items.find((it) => it.key === key && it.path === `/operation/sc/${key}`);
  if (item) return allowed(item);
  const hub = Object.entries(ENGINE_HUBS).find(([, k]) => k === key)?.[0];
  if (!hub) return false;
  return hub !== "supply-chain" && group.items.some((it) => it.section === hub && allowed(it));
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

/* ── THE MENU GROUPS — the Houzs tree (Sidebar.tsx:1118-1123, 237-1085). Three caps
 * words, Workspace, Operations and System; Supply Chain is an expandable row inside
 * Operations holding its five modules. */
export interface MenuGroup {
  label: string | null;
  /** The group draws under one expandable row instead of a caps word. */
  row?: { key: string; label: string; icon: LucideIcon; mIcon?: string };
  sections: ReadonlyArray<PortalSection>;
}

/** The Houzs areas of the Operations menu: their pages wear Houzs's own icon, as in Houzs's menu. */
export const HOUZS_ICON_SECTIONS: ReadonlySet<PortalSection> = new Set<PortalSection>([
  "Customer Care", "Projects", "Supply Chain", "Sales", "Consignment", "Purchasing", "Delivery", "Warehouse", "Team", "IT",
  "Finance", "Finance Money in", "Finance Money out", "Finance Bank", "Finance Books", "Finance Reports", "Finance Setup",
]);

export const OPERATION_MENU_GROUPS: ReadonlyArray<MenuGroup> = [
  { label: "Workspace", sections: ["Workspace"] },
  { label: "Operations", sections: ["Customer Care", "Projects"] },
  {
    label: null,
    row: { key: "supply-chain", label: "Supply Chain", icon: Boxes },
    sections: ["Supply Chain", "Sales", "Consignment", "Purchasing", "Delivery", "Warehouse"],
  },
  /* Houzs's Finance group after Supply Chain (Sidebar.tsx:736; owner 11 Nov 2026): one expandable row holding
   * To do, Money today, its five groups and Reports. */
  {
    label: null,
    row: { key: "finance", label: "Finance", icon: BookOpen },
    sections: ["Finance", "Finance Money in", "Finance Money out", "Finance Bank", "Finance Books", "Finance Reports", "Finance Setup"],
  },
  /* Houzs's SYSTEM group after Supply Chain (owner, 11 Nov 2026): the Team module, Mail Center and
   * Announcements, the IT module, then Change Log · Assistant · Agent Console · IT Support · OCR. The Carres
   * bottom group (Payments, Issue Tracker, Sales invoice lines) is removed. */
  { label: "System", sections: ["Team", "Operations Rows", "IT", "System"] },
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
  // A Houzs hub page is named by its module (Supply Chain for the /scm hub).
  const hub = hubSectionFor(pathname);
  if (hub) return { crumb: null, title: hub === "supply-chain" ? "Supply Chain" : PORTAL_MODULES.find((m) => m.section === hub)?.label ?? hub };
  const item = activeItem(group, pathname, search);
  if (!item) return null;
  const moduleRow = PORTAL_MODULES.find((m) => m.section === item.section);
  const siblings = group.items.filter((it) => it.section === item.section).length;
  return {
    crumb: item.crumb ?? (moduleRow && siblings > 1 && moduleRow.label !== item.label ? moduleRow.label : null),
    title: item.label,
  };
}
