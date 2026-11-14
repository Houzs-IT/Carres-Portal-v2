import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";

/**
 * PortalSidebar — role-filtered area accordion (Unified Internal Portal,
 * 2026-06-30), rebuilt as EXPANDABLE MODULE ROWS (Jess, 2026-08-19 afternoon —
 * CARD-2026-08-19-sidebar-expandable-modules).
 *
 * Every module is an icon + name + chevron row whose pages hang beneath it on
 * one tree line with a rounded elbow to each page (owner 12 Oct 2026; 01 §4
 * "Side menu": one rule for every module, drawn from data). The Operations
 * area follows the Houzs tree (Weisiang, WhatsApp 2026-11-01): two small caps
 * headings, Workspace (Overview first) and Operations, then the Supply Chain row
 * holding the Product Request row and five modules, then a small caps SYSTEM
 * heading over Houzs's Team module, Mail Center and IT Support (owner, 11 Nov 2026).
 * Service Cases, Projects and Supply Chain rows each open an engine page at
 * their own `/operation/sc/<row>` address (owner, 11 Nov 2026).
 */

/** The selected row (Layout Standard §2): the theme select colours, 600. */
const SELECTED = "bg-c-select-pill";
/** The row a page hangs in: its trunk and its elbow sit beside the link. */
const treeRow = (key: string) => screen.getByTestId(`nav-child-${key}`).parentElement as HTMLElement;
const trunk = (key: string) => treeRow(key).querySelector<HTMLElement>("[data-tree='trunk']")!;
const elbow = (key: string) => treeRow(key).querySelector<HTMLElement>("[data-tree='elbow']")!;
/** A Material Symbols icon (`MIcon`) — the Operations menu's icons and carets. */
const MICON = ".material-symbols-rounded";
/** The person's own « choice, remembered (handoff 2026-10-08). */
const COLLAPSE_KEY = "carres-menu-collapsed";

let mockRole: string | null = "operation";
// The signed-in person; the menu stores nothing under it (owner 12 Oct 2026).
let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  useAuth: (selector: (s: { role: string | null; session: unknown }) => unknown) =>
    selector({
      role: mockRole,
      session: { user: { email: "x@carres.com", id: mockUserId ?? undefined } },
    }),
}));

// The rail self-fetches badges / the pending count; stub them so no network.
let mockBadges:
  | { orders?: number; procurement?: number; serviceNotes?: number; lpRejected?: number }
  | undefined;
vi.mock("@/lib/queries", () => ({
  useOperationBadges: () => ({ data: mockBadges }),
  useMarkOperationBadgeSeen: () => ({ mutate: vi.fn() }),
  usePrincipalDashboard: () => ({ data: undefined }),
}));

import PortalSidebar from "./PortalSidebar";
import { retiredRedirect } from "./portal-nav";

/** Prints the live URL, so a control can be proved NOT to have navigated. */
function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-probe">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PortalSidebar />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const module_ = (slug: string) => screen.getByTestId(`nav-module-${slug}`);
const child = (key: string) => screen.getByTestId(`nav-child-${key}`);
const group_ = (key: string) => screen.getByTestId(`nav-group-${key}`);
/** The Supply Chain row: it opens by itself only when the page is inside it. */
const supply = () => screen.getByTestId("nav-fold-supply-chain");
/** Opens Supply Chain from a page outside it (no navigation; this location only). */
const openSupply = () => {
  if (supply().getAttribute("aria-expanded") === "false") fireEvent.click(supply());
};
/** The one page group left: Transportation's Maintenance. */
const MAINTENANCE = "transportation-maintenance";

beforeEach(() => {
  mockRole = "operation";
  mockBadges = undefined;
  mockUserId = null;
  localStorage.clear();
});

describe("PortalSidebar — role visibility", () => {
  it("operation sees Operations only — no Finance / Admin", () => {
    renderAt("/operation");
    openSupply();
    expect(module_("purchasing")).toBeInTheDocument();
    /* Suppliers and Products & Maintenance are pages inside
       Procurement (Houzs tree, 2026-11-01): none is a module or a plain row. */
    expect(screen.queryByTestId("nav-module-suppliers")).not.toBeInTheDocument();
    fireEvent.click(module_("purchasing"));
    expect(child("op-catalog")).toBeInTheDocument();
    expect(child("suppliers")).toBeInTheDocument();
    // The selling catalog is principal-only, by area.
    expect(screen.queryByText("Product & Maintenance")).not.toBeInTheDocument();
    expect(screen.queryByText("Outstanding")).not.toBeInTheDocument();
    expect(screen.queryByText("Accounts")).not.toBeInTheDocument();
  });

  it("finance sees Finance items only — no Operations", () => {
    mockRole = "finance";
    renderAt("/finance/dashboard");
    // Chew 2026-10-03: Finance's own pages sit in Finance modules.
    expect(module_("payables")).toBeInTheDocument();
    expect(module_("receivables")).toBeInTheDocument();
    // §13 (payment/MASTER.md) — the Bank Matching workspace retired
    // 2026-09-07: its row must NOT come back.
    expect(screen.queryByText("Reconciliation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-module-purchasing")).not.toBeInTheDocument();
    expect(screen.queryByText("Accounts")).not.toBeInTheDocument();
  });

  it("principal sees the Finance and Admin area words (the HR area is removed, 11 Nov 2026), never an Operations area title; only the active area is expanded", () => {
    mockRole = "principal";
    renderAt("/operation");
    /* The Operations area has no area title to fold it by (owner ruling
       2026-10-08). `Operations` is a heading inside the one menu, the Houzs
       word for the Service Cases module's group, not an area title. */
    expect(screen.getByTestId("nav-group-head-operations")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-area-operation")).not.toBeInTheDocument();
    expect(screen.getAllByText("Finance").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("nav-area-finance")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-area-hr")).not.toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    openSupply();
    fireEvent.click(module_("purchasing"));
    expect(child("op-catalog")).toBeInTheDocument();
    expect(child("suppliers")).toBeInTheDocument();
    // Inactive areas are collapsed → their items are hidden until clicked.
    expect(screen.queryByText("Outstanding")).not.toBeInTheDocument();
    expect(screen.queryByText("Accounts")).not.toBeInTheDocument();
  });

  it("Finance keeps Dashboard on top and Money in above Money out (Houzs order, Weisiang 2026-11-01)", () => {
    mockRole = "finance";
    renderAt("/finance/ap-outstanding");
    const dashboard = child("dashboard");
    const receivables = module_("receivables");
    const payables = module_("payables");
    const ap = child("ap");
    expect(receivables).toHaveTextContent("Money in");
    expect(payables).toHaveTextContent("Money out");
    expect(ap).toHaveTextContent("AP · Payables");
    expect(ap).toHaveAttribute("href", "/finance/ap-outstanding");
    expect(screen.queryByText("Unpaid by Supplier")).not.toBeInTheDocument();
    expect(dashboard.compareDocumentPosition(receivables) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Money in sits above Money out, and AP sits inside Money out.
    expect(receivables.compareDocumentPosition(payables) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(payables.compareDocumentPosition(ap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("principal on the Finance base expands the Finance area", () => {
    mockRole = "principal";
    renderAt("/finance/ar");
    expect(child("ar")).toHaveTextContent("Outstanding");
    /* Operations has no area word to open it with, so it is always drawn —
       standing in Finance never hides the boss's Operations menu (fix
       2026-10-09, found by the shell test pass). Supply Chain is shut there,
       because nothing in Finance is inside it. */
    expect(screen.getByTestId("nav-group-head-operations")).toBeInTheDocument();
    expect(supply()).toHaveAttribute("aria-expanded", "false");
    openSupply();
    expect(screen.getByTestId("nav-module-purchasing")).toBeInTheDocument();
  });
});

/**
 * ⭐ THE AREA YOU ARE IN FOLDS (Chew, 2026-10-03; Finance MASTER §4). Its
 * title folds it and opens it again, and the page stays where it is. Another
 * area's title still jumps to that area, as before. One rule for every area.
 */
describe("PortalSidebar — the area you are in folds", () => {
  beforeEach(() => {
    mockRole = "principal";
  });

  it("its title folds it and opens it again, and the page does not move", () => {
    renderAt("/finance/dashboard");
    const finance = screen.getByTestId("nav-area-finance");
    /* Operations is always drawn too, so it has its own Dashboard row: count
       the Finance one inside the Finance area only. */
    const financeDashboards = () =>
      screen.queryAllByTestId("nav-child-dashboard").filter((el) => el.getAttribute("href") === "/finance/dashboard");
    expect(finance).toHaveAttribute("aria-expanded", "true");
    expect(financeDashboards()).toHaveLength(1);
    fireEvent.click(finance);
    expect(finance).toHaveAttribute("aria-expanded", "false");
    expect(financeDashboards()).toHaveLength(0);
    expect(screen.queryByTestId("nav-module-payables")).not.toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent(/^\/finance\/dashboard$/);
    fireEvent.click(finance);
    expect(finance).toHaveAttribute("aria-expanded", "true");
    expect(financeDashboards()).toHaveLength(1);
  });

  it("folded, its title is the one selected mark of where you are", () => {
    renderAt("/finance/dashboard");
    const finance = screen.getByTestId("nav-area-finance");
    // The theme select colour, never the retired blue (Layout Standard §2).
    expect(finance).not.toHaveClass("!text-c-select-fg");
    fireEvent.click(finance);
    expect(finance).toHaveClass("!text-c-select-fg");
    expect(screen.getByTestId("nav-area-principal")).not.toHaveClass("!text-c-select-fg");
  });

  it("every area title carries its caret, open or shut", () => {
    renderAt("/finance/dashboard");
    // Operations has no area title for the boss (owner ruling 2026-10-08).
    for (const area of ["finance", "principal"]) {
      expect(screen.getByTestId(`nav-area-${area}`).querySelector(MICON), area).not.toBeNull();
    }
  });

  it("another area's title still jumps there, and that area opens", () => {
    renderAt("/finance/dashboard");
    fireEvent.click(screen.getByTestId("nav-area-finance"));
    fireEvent.click(screen.getByTestId("nav-area-principal"));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/principal?tab=dashboard");
    expect(screen.getByTestId("nav-area-principal")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("nav-area-finance")).toHaveAttribute("aria-expanded", "false");
  });

  /* The Operations area has no area word to click, so standing in another
     area must not leave the boss without her Operations menu. */
  it("standing in Finance, the boss still has her Operations menu", () => {
    renderAt("/finance/dashboard");
    expect(screen.getByTestId("nav-group-head-operations")).toBeInTheDocument();
    openSupply();
    expect(module_("purchasing")).toBeInTheDocument();
  });

  /* "Operations folds too" is RETIRED: the Operations area has no area word
     for the boss (owner ruling 2026-10-08), so there is nothing to fold it by.
     Its headings draw open while she stands in it. */
  it("Operations has no area word to fold — its groups draw open where she stands", () => {
    renderAt("/operation");
    expect(screen.queryByTestId("nav-area-operation")).not.toBeInTheDocument();
    expect(screen.getByTestId("nav-group-head-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("nav-group-head-operations")).toBeInTheDocument();
    expect(supply()).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent(/^\/operation$/);
  });
});

describe("PortalSidebar — narrow desktop", () => {
  /* RETIRED: the 2026-09-25 auto-collapse below 1280px. The menu now OPENS at
     220px on every desktop width (handoff 2026-10-08, "Do NOT" 2); only the
     person's own « click closes it. */
  it("opens at 220px below 1280 too — no automatic icon rail", () => {
    const previous = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 1279px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    try {
      renderAt("/operation/sc/delivery-planning");
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "220px" });
      expect(screen.getByRole("button", { name: "Collapse menu" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: previous });
    }
  });

  it("the « button closes it to 64px, says so, and is remembered under its own key", () => {
    const view = renderAt("/operation/sc/delivery-planning");
    const toggle = screen.getByRole("button", { name: "Collapse menu" });
    expect(toggle).toHaveTextContent("«");
    fireEvent.click(toggle);
    expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
    expect(screen.getByRole("button", { name: "Expand menu" })).toHaveTextContent("»");
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe("1");
    view.unmount();
    // The next load keeps the person's choice.
    renderAt("/operation/sc/delivery-planning");
    expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
  });

  it("an older stored collapse never carries over — only the new key counts", () => {
    localStorage.setItem("ops-sidebar-collapsed", "1");
    renderAt("/operation/sc/delivery-planning");
    expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "220px" });
  });
});

/**
 * ⭐ THE CARD'S OWN SHAPE (Jess, 2026-08-19 afternoon), drawn to the Carres
 * Layout Standard §2 (owner-confirmed template, 2026-10-08).
 *
 * A module is an icon + a name + a caret. The Operations area has two small
 * uppercase HEADINGS — Workspace · Operations — which are labels, never
 * destinations; a module row itself is never an uppercase heading. Supply
 * Chain is a row, not a heading (see "the Supply Chain row" below).
 */
describe("a module is an expandable PARENT ROW, never a heading", () => {
  it("every module row carries an icon, its name and a caret", () => {
    renderAt("/operation");
    openSupply();
    for (const [slug, name] of [
      ["sales", "Sales Order"],
      ["consignment", "Consignment"],
      ["purchasing", "Procurement"],
      ["delivery", "Transportation"],
      ["warehouse", "Warehouse"],
      ["team", "Team"],
      // The Customer Care module's word is `Service Cases` (Houzs tree, 2026-11-01).
      ["customer-care", "Service Cases"],
      ["projects", "Projects"],
    ] as const) {
      const row = module_(slug);
      expect(row.tagName).toBe("BUTTON");
      expect(within(row).getByText(name)).toBeInTheDocument();
      // icon + caret. The Houzs modules wear Houzs's own (lucide) icon.
      expect(row.querySelectorAll(`${MICON}, svg`).length).toBe(2);
      expect(row.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("the Operations menu has three small uppercase headings, Workspace, Operations and System, in that order", () => {
    renderAt("/operation/sc/purchase-orders");
    const heads = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid^='nav-group-head-']"),
    );
    expect(heads.map((h) => h.textContent)).toEqual(["Workspace", "Operations", "System"]);
    for (const head of heads) {
      // A label rank: 11px semibold caps, never a link or a button.
      expect(head.tagName).toBe("SPAN");
      expect(head.closest("a, button")).toBeNull();
      expect(head.className).toContain("uppercase");
      expect(head.className).toContain("text-[11px]");
      expect(head.className).toContain("font-semibold");
    }
    // Supply Chain is a row with a chevron, not a heading.
    expect(screen.queryByTestId("nav-group-head-supply-chain")).toBeNull();
    expect(supply().tagName).toBe("BUTTON");
  });

  it("each group carries its own modules and rows, in order", () => {
    renderAt("/operation");
    const nav = screen.getByRole("navigation", { name: "Modules" });
    const walk = () =>
      Array.from(
        nav.querySelectorAll<HTMLElement>(
          "[data-testid^='nav-group-head-'], [data-testid^='nav-fold-'], [data-testid^='nav-module-'], [data-testid^='nav-child-']",
        ),
      ).map((el) => el.dataset.testid!.replace(/^nav-/, ""));
    // Supply Chain is shut where nothing in it is the current page.
    expect(walk()).toEqual([
      "group-head-workspace",
      "child-overview",
      "child-orders-shortcut",
      "child-work",
      "child-leave",
      "group-head-operations",
      "module-customer-care",
      "module-projects",
      "fold-supply-chain",
      "fold-finance",
      "group-head-system",
      "module-team",
      "child-mail-center",
      "child-announcements",
      "module-it",
      "child-change-log",
      "child-assistant",
      "child-agent-console",
      "child-it-support",
      "child-ocr",
    ]);
    openSupply();
    expect(walk()).toEqual([
      "group-head-workspace",
      "child-overview",
      "child-orders-shortcut",
      "child-work",
      "child-leave",
      "group-head-operations",
      "module-customer-care",
      "module-projects",
      "fold-supply-chain",
      "fold-children-supply-chain",
      "child-product-request",
      "module-sales",
      "module-consignment",
      "module-purchasing",
      "module-delivery",
      "module-warehouse",
      "fold-finance",
      "group-head-system",
      "module-team",
      "child-mail-center",
      "child-announcements",
      "module-it",
      "child-change-log",
      "child-assistant",
      "child-agent-console",
      "child-it-support",
      "child-ocr",
    ]);
  });

  it("no module row is an uppercase heading", () => {
    renderAt("/operation/sc/purchase-orders");
    for (const word of ["Procurement", "Warehouse", "Transportation", "Sales Order"]) {
      const uppercaseHeading = screen
        .queryAllByText(word)
        .some((el) => el.closest("a") === null && el.className.includes("uppercase"));
      expect(uppercaseHeading, word).toBe(false);
    }
  });

  it("single pages stay plain rows — no caret on Sales Orders, Workspace, Leave, Mail Center, IT Support", () => {
    renderAt("/operation");
    for (const key of ["orders-shortcut", "work", "leave", "mail-center", "it-support"]) {
      const row = child(key);
      expect(row.tagName).toBe("A");
      expect(row.getAttribute("aria-expanded")).toBeNull();
      // One icon, no caret: a plain row has nothing to expand. Mail Center and IT Support wear Houzs's lucide icon.
      expect(row.querySelectorAll(`${MICON}, svg`).length, key).toBe(1);
    }
    expect(child("mail-center")).toHaveAttribute("href", "/operation/sc/mail-center");
    expect(child("it-support")).toHaveAttribute("href", "/operation/sc/it-support");
  });

  /* The Carres bottom group is removed from Operations (owner, 11 Nov 2026): Payments, Issue Tracker and
     Sales invoice lines. Finance keeps its own Monitor and Payment Records. */
  it("Operations no longer carries Payments, Issue Tracker or Sales invoice lines", () => {
    renderAt("/operation");
    expect(screen.queryByTestId("nav-module-payments")).toBeNull();
    for (const key of ["payments", "payment-records", "issue-tracker", "sales-invoice-lines"]) {
      expect(screen.queryByTestId(`nav-child-${key}`), key).toBeNull();
    }
    expect(screen.queryByTestId("nav-group-head-carres")).toBeNull();
  });

  /* ⭐ THE TEAM MODULE (Houzs Sidebar.tsx:963-1000): its row opens Houzs's Team hub, its pages hang beneath. */
  it("Team holds Directory, Org Chart, Departments, Mailboxes and Roles & Permissions, and its row opens the Team hub", () => {
    renderAt("/operation");
    fireEvent.click(module_("team"));
    expect(screen.getByTestId("location-probe")).toHaveTextContent(/^\/operation\/sc\/hub-team$/);
    const rows = within(screen.getByTestId("nav-children-team")).getAllByRole("link");
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["Directory", "Org Chart", "Departments", "Mailboxes", "Roles & Permissions"]);
    expect(rows.map((r) => r.getAttribute("href"))).toEqual([
      "/operation/sc/team-directory", "/operation/sc/team-org-chart", "/operation/sc/team-departments",
      "/operation/sc/team-mailboxes", "/operation/sc/team-roles",
    ]);
    // Each page wears Houzs's own icon.
    expect(screen.getByTestId("houzs-icon-team-directory")).toBeInTheDocument();
  });

  it("on the Team hub the Team module is the open one", () => {
    renderAt("/operation/sc/hub-team");
    expect(module_("team")).toHaveAttribute("aria-expanded", "true");
  });

  it("hr sees only the System group", () => {
    mockRole = "hr";
    renderAt("/operation/sc/hub-team");
    const heads = Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='nav-group-head-']"));
    expect(heads.map((h) => h.textContent)).toEqual(["System"]);
    expect(module_("team")).toBeInTheDocument();
    expect(child("mail-center")).toBeInTheDocument();
    expect(child("it-support")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-fold-supply-chain")).toBeNull();
    expect(screen.queryByTestId("nav-settings")).toBeNull();
  });

  it("finance sees the same two Payments destinations — never a second Payment IA", () => {
    mockRole = "finance";
    renderAt("/finance/payments");
    expect(child("payments")).toHaveAttribute("href", "/finance/monitor");
    expect(child("payment-records")).toHaveAttribute("href", "/finance/payments");
    expect(child("payment-records").className).toContain("bg-c-select-pill");
    expect(screen.queryByText("Refunds & Credits")).not.toBeInTheDocument();
    expect(screen.queryByText("Invoices")).not.toBeInTheDocument();
    // Genuine finance-only capability keeps its own rows, in Finance's own modules.
    expect(module_("receivables")).toBeInTheDocument();
  });
});

/**
 * ⭐ THE SUPPLY CHAIN ROW (Weisiang, WhatsApp 2026-11-01; Houzs Sidebar.tsx:1137).
 * An expandable row inside Operations holding five modules: Sales Order,
 * Consignment, Procurement, Transportation, Warehouse. It is shut unless the
 * current page is inside it; a click opens or shuts it for the current location
 * only, and never navigates.
 */
describe("PortalSidebar — the Supply Chain row", () => {
  it("is shut on a page outside it, and its modules are not drawn", () => {
    renderAt("/operation");
    expect(supply().tagName).toBe("BUTTON");
    expect(supply()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("nav-fold-children-supply-chain")).toBeNull();
    for (const slug of ["sales", "consignment", "purchasing", "delivery", "warehouse"]) {
      expect(screen.queryByTestId(`nav-module-${slug}`), slug).toBeNull();
    }
  });

  it("opens itself when the current page is inside it, and only then", () => {
    for (const path of [
      "/operation/sc/orders",
      "/operation/sc/consignment-notes",
      "/operation/sc/purchase-orders",
      "/operation/sc/delivery-planning",
      "/operation/sc/stock",
      "/operation/sc/delivery-orders",
    ]) {
      const view = renderAt(path);
      expect(supply(), path).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("nav-fold-children-supply-chain"), path).toBeInTheDocument();
      view.unmount();
    }
    for (const path of ["/operation/sc/service-notes", "/operation/sc/projects", "/finance/monitor", "/operation/sc/mail-center"]) {
      const view = renderAt(path);
      expect(supply(), path).toHaveAttribute("aria-expanded", "false");
      view.unmount();
    }
  });

  it("holds the five modules in order, and Service Cases, Projects and the System rows stay outside", () => {
    renderAt("/operation");
    openSupply();
    const inside = screen.getByTestId("nav-fold-children-supply-chain");
    expect(
      Array.from(inside.querySelectorAll("[data-testid^='nav-module-']")).map((el) => el.getAttribute("data-testid")),
    ).toEqual(["nav-module-sales", "nav-module-consignment", "nav-module-purchasing", "nav-module-delivery", "nav-module-warehouse"]);
    for (const slug of ["team", "customer-care", "projects"]) {
      expect(inside.contains(module_(slug)), slug).toBe(false);
    }
    expect(inside.contains(child("mail-center"))).toBe(false);
    expect(inside.contains(child("it-support"))).toBe(false);
  });

  it("a click opens and shuts it without navigating", () => {
    renderAt("/operation");
    const before = screen.getByTestId("location-probe").textContent;
    fireEvent.click(supply());
    expect(supply()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("location-probe")).toHaveTextContent(before ?? "");
    fireEvent.click(supply());
    expect(supply()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("location-probe")).toHaveTextContent(before ?? "");
  });

  it("can be shut by hand while standing inside it, and the row then carries the selection", () => {
    renderAt("/operation/sc/purchase-orders");
    expect(supply().className).not.toContain(SELECTED);
    fireEvent.click(supply());
    expect(supply()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("nav-module-purchasing")).toBeNull();
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/operation/sc/purchase-orders");
    // Shut, it is the one mark of where you are (the same law as a shut module).
    expect(supply().className).toContain(SELECTED);
  });

  it("a click works for this location only: navigating retires it", () => {
    function Jump() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/operation?tab=work")}>jump</button>;
    }
    render(
      <MemoryRouter initialEntries={["/operation"]}>
        <PortalSidebar />
        <Jump />
      </MemoryRouter>,
    );
    fireEvent.click(supply());
    expect(supply()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByText("jump"));
    expect(supply()).toHaveAttribute("aria-expanded", "false");
  });

  it("working the row writes nothing to storage", () => {
    mockUserId = "user-a";
    renderAt("/operation");
    fireEvent.click(supply());
    fireEvent.click(supply());
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("the collapsed rail draws no Supply Chain row: its five modules are five icons", () => {
    localStorage.setItem(COLLAPSE_KEY, "1");
    try {
      renderAt("/operation");
      expect(screen.queryByTestId("nav-fold-supply-chain")).toBeNull();
      for (const title of ["Sales Order", "Consignment", "Procurement", "Transportation", "Warehouse"]) {
        expect(screen.getByTitle(title), title).toBeInTheDocument();
      }
    } finally {
      localStorage.removeItem(COLLAPSE_KEY);
    }
  });
});

/**
 * ONE MODULE OPEN AT A TIME — ten procurement pages and a Warehouse
 * module cannot stack, and the module you are standing in is the open one.
 */
describe("the accordion", () => {
  it("the module holding the current page is open on a direct URL load", () => {
    renderAt("/operation/sc/purchase-orders");
    expect(module_("purchasing").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("nav-children-purchasing")).toBeInTheDocument();
    // ...and every other module has hidden its pages.
    expect(screen.queryByTestId("nav-children-sales")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-child-orders")).not.toBeInTheDocument();
  });

  it("expanding Purchasing collapses Sales", () => {
    renderAt("/operation/sc/orders");
    expect(screen.getByTestId("nav-children-sales")).toBeInTheDocument();
    fireEvent.click(module_("purchasing"));
    expect(screen.getByTestId("nav-children-purchasing")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-children-sales")).not.toBeInTheDocument();
  });

  it("clicking a Houzs module opens its hub page, as Houzs's row does, with the module open", () => {
    renderAt("/operation");
    openSupply();
    fireEvent.click(module_("warehouse"));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/operation/sc/hub-warehouse");
    expect(screen.getByTestId("nav-children-warehouse")).toBeInTheDocument();
    expect(module_("warehouse").getAttribute("aria-expanded")).toBe("true");
  });

  it("Supply Chain opens Houzs's /scm hub and stays open there", () => {
    renderAt("/operation?tab=work");
    fireEvent.click(screen.getByTestId("nav-fold-supply-chain"));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/operation/sc/hub-scm");
    expect(screen.getByTestId("nav-fold-children-supply-chain")).toBeInTheDocument();
  });

  it("clicking the open module closes it again", () => {
    renderAt("/operation/sc/purchase-orders");
    fireEvent.click(module_("purchasing"));
    expect(screen.queryByTestId("nav-children-purchasing")).not.toBeInTheDocument();
    expect(module_("purchasing").getAttribute("aria-expanded")).toBe("false");
  });

  it("standing on a plain page, no module is open", () => {
    renderAt("/operation");
    expect(document.querySelectorAll("[data-testid^='nav-children-']").length).toBe(0);
  });

  /* A hand-worked chevron belongs to the page it was worked on. Leaving that
   * page retires it — otherwise a jump (⌘K, or any in-page link) into another
   * module would leave the OLD module open and the row you just moved to
   * hidden, which is the one rail defect §4.2 refuses to ship. */
  it("navigating away retires a hand-opened module — the new page's module opens", () => {
    renderAt("/operation");
    openSupply();
    fireEvent.click(module_("purchasing"));
    expect(screen.getByTestId("nav-children-purchasing")).toBeInTheDocument();
    // Now travel to a Warehouse page the way any in-page link would.
    fireEvent.click(module_("warehouse"));
    expect(screen.getByTestId("nav-children-warehouse")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-children-purchasing")).not.toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/operation/sc/hub-warehouse");
  });

  it("a module shut by hand stays shut while you stand on its page", () => {
    renderAt("/operation/sc/purchase-orders");
    fireEvent.click(module_("purchasing"));
    expect(screen.queryByTestId("nav-children-purchasing")).not.toBeInTheDocument();
    // ...and the shut module is the one carrying the light, so nothing is lost.
    expect(module_("purchasing").className).toContain("bg-c-select-pill");
  });
});

/**
 * THE TREE LINE (owner 12 Oct 2026; 01 §4): a 1.5px grey trunk beside each
 * page with a rounded elbow (radius 7) reaching it. The trunk stops at the
 * last page of each group, and the current page's elbow takes the theme
 * colour. Both pieces are decoration: `aria-hidden`, outside the link.
 */
describe("the tree line", () => {
  it("every page hangs on a trunk and a rounded elbow, 18px in", () => {
    renderAt("/operation/sc/orders");
    const group = screen.getByTestId("nav-children-sales");
    expect(group.className).toContain("ml-[18px]");
    for (const key of ["orders", "rental"]) {
      expect(trunk(key).className).toContain("border-l-[1.5px]");
      expect(trunk(key).className).toContain("border-c-tree-line");
      expect(elbow(key).className).toContain("rounded-bl-[7px]");
      expect(elbow(key).className).toContain("border-b-[1.5px]");
      expect(trunk(key).getAttribute("aria-hidden")).toBe("true");
      expect(elbow(key).getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("the trunk stops at the last page: full height before it, half at it", () => {
    renderAt("/operation/sc/orders");
    expect(trunk("orders").style.height).toBe("100%");
    expect(trunk("sales-invoices").style.height).toBe("100%");
    expect(trunk("delivery-returns").style.height).toBe("100%");
    expect(trunk("rental").style.height).toBe("calc(50% - 8px)");
  });

  it("the trunk stops at the last page of EACH group", () => {
    renderAt("/operation/sc/fleet-health"); // Maintenance holds the page, so it is open
    expect(trunk("fleet-day").style.height).toBe("100%");
    // Crew Leave is the last page before the group word: the line stops there.
    expect(trunk("crew-leave").style.height).toBe("calc(50% - 8px)");
    expect(trunk("coverage-fleet").style.height).toBe("100%");
    expect(trunk("rate-cards").style.height).toBe("100%");
    expect(trunk("fleet-health").style.height).toBe("calc(50% - 8px)");
  });

  it("the current page's elbow takes the theme colour; the others stay grey", () => {
    renderAt("/operation/sc/receiving");
    expect(elbow("receiving").className).toContain("border-c-select-fg");
    expect(elbow("purchase-orders").className).toContain("border-c-tree-line");
    expect(elbow("purchase-orders").className).not.toContain("border-c-select-fg");
  });

  it("the line is decoration beside the link, so a screen reader hears only the name", () => {
    renderAt("/operation/sc/orders");
    // The Houzs icon beside a page is aria-hidden decoration; the only text is the name.
    expect([...child("rental").children].filter((el) => el.getAttribute("aria-hidden") !== "true")).toHaveLength(1);
    expect(child("rental")).toHaveTextContent(/^Subscription$/);
  });

  it("the Houzs pages wear Houzs's icon; Carres's own Workspace rows do not change", () => {
    renderAt("/operation/sc/stock-adjustments");
    expect(screen.getByTestId("houzs-icon-stock-adjustments")).toBeInTheDocument();
    expect(screen.getByTestId("houzs-icon-stock")).toBeInTheDocument();
    expect(screen.queryByTestId("houzs-icon-work")).toBeNull();
  });

  it("a long name wraps to a second line and is never cut", () => {
    renderAt("/operation/sc/delivery-planning");
    const label = within(child("delivery-planning-driver")).getByText("Last Mile Delivery (Driver)");
    expect(label.className).toContain("break-words");
    expect(label.className).not.toContain("truncate");
    expect(document.querySelector("[data-testid='portal-sidebar'] .truncate")).toBeNull();
  });

  /* The menu draws its own tree; it does not import the connector the
   * ConnectedSections page draws, which stays in the ONE shared file. */
  it("ConnectedSections still draws the shared connector, from its one file", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sidebar = readFileSync(join(here, "PortalSidebar.tsx"), "utf8");
    expect(sidebar).not.toContain('from "@/components/tree-connector"');
    const sections = readFileSync(
      join(here, "..", "operation", "components", "ConnectedSections.tsx"),
      "utf8",
    );
    expect(sections).toContain('from "@/components/tree-connector"');
    expect(sections).not.toContain("borderBottomLeftRadius");
  });

  it("the menu names no module in its code: one rule, read from data", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const code = readFileSync(join(here, "PortalSidebar.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/"Purchasing"|"Warehouse"|"Payments"|PURCHASING|WAREHOUSE|PAYMENTS/);
  });
});

/**
 * A COUNT MEANS WORK WAITING, and collapse changed the fact the old ruling
 * rested on: a hidden child cannot show its own number, so the shut module
 * carries the sum. Open, the children say it themselves — the same figure
 * twice would read as two queues. (Since 11 Nov 2026 no Operations row carries
 * a count: the Sales Order and Procurement rows that did are engine pages now.)
 */
describe("badges across the collapse", () => {
  it("zero prints nothing — a quiet module carries no chip at all", () => {
    mockBadges = { orders: 0, procurement: 0, serviceNotes: 0, lpRejected: 0 };
    renderAt("/operation");
    openSupply();
    for (const slug of ["sales", "purchasing", "customer-care"]) {
      expect(module_(slug).querySelector("[data-testid^='nav-badge-']")).toBeNull();
    }
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

/**
 * ⭐ THE SELECTED ROW — Carres Layout Standard §2 (owner-confirmed template,
 * Jess 2026-10-08): `bg-c-select-pill text-c-select-fg font-semibold`, the
 * theme's own select colours.
 *
 * RETIRED: the governed BLUE treatment (`kit-blue-3` wash + 3px `kit-blue-9`
 * left bar). There is no blue and no left bar any more, so the bar assertions
 * are gone. It still may never be the flame `primary` — red in Carres means
 * late / act now.
 */
describe("the active page — theme select colours, never flame", () => {
  it("the active child wears the theme select colours at 600, with no blue and no left bar", () => {
    renderAt("/operation/sc/receiving");
    const row = child("receiving");
    expect(row.className).toContain(SELECTED);
    expect(row.className).toContain("text-c-select-fg");
    expect(row.className).toContain("font-semibold");
    expect(row.className).toContain("rounded-lg");
    expect(row.className).not.toMatch(/kit-blue/);
    expect(row.querySelector("[class*='kit-blue']")).toBeNull();
  });

  it("the active page sits INSIDE its auto-expanded module on a direct URL load", () => {
    renderAt("/operation/sc/receiving");
    const group = screen.getByTestId("nav-children-purchasing");
    expect(group.contains(child("receiving"))).toBe(true);
  });

  it("an inactive page carries no selection colour, and reads at 400", () => {
    renderAt("/operation/sc/receiving");
    const row = child("purchase-orders");
    expect(row.className).not.toContain(SELECTED);
    // 400 at rest, 600 selected (01 §4 "Side menu").
    expect(row.className).toContain("font-normal");
    expect(row.className).not.toContain("font-semibold");
    expect(row.className).toContain("text-c-body");
  });

  it("no flame and no grey wash survives in the active row", () => {
    renderAt("/operation/sc/orders");
    const row = child("orders");
    expect(row.className).not.toContain("bg-primary");
    expect(row.className).not.toContain("bg-base-100");
    expect(row.querySelector(".bg-primary")).toBeNull();
    expect(row.querySelector(".text-primary")).toBeNull();
  });

  it("a module that has SHUT on the page you are standing on lights instead", () => {
    renderAt("/operation/sc/purchase-orders");
    fireEvent.click(module_("purchasing")); // shut it, still on its page
    expect(module_("purchasing").className).toContain(SELECTED);
    expect(module_("purchasing").className).toContain("text-c-select-fg");
    // (the retired 3px blue bar assertion is gone — the approved row has none)
  });

  it("the COLLAPSED icon rail is selected the same way — same law, smaller rail", () => {
    localStorage.setItem(COLLAPSE_KEY, "1");
    try {
      renderAt("/operation/sc/orders");
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
      // Collapsed, the children disappear and the MODULE's one icon remains.
      const icon = screen.getByTitle("Sales Order") as HTMLAnchorElement;
      expect(icon).toHaveAttribute("href", "/operation/sc/orders");
      expect(icon.className).toContain(SELECTED);
      expect(icon.className).toContain("text-c-select-fg");
      expect(icon.querySelector("[class*='kit-blue']")).toBeNull();
      expect(icon.className).not.toContain("bg-base-100");
      expect(icon.querySelector(".text-primary")).toBeNull();
    } finally {
      localStorage.removeItem("carres-menu-collapsed");
    }
  });

  it("the collapsed rail navigates ten pages by ONE icon, not ten", () => {
    localStorage.setItem("carres-menu-collapsed", "1");
    try {
      renderAt("/operation/sc/purchase-orders");
      expect(screen.getByTitle("Procurement")).toBeInTheDocument();
      expect(screen.queryByTitle("Goods Receipt")).toBeNull();
      expect(screen.queryByTitle("Purchase Returns")).toBeNull();
    } finally {
      localStorage.removeItem("carres-menu-collapsed");
    }
  });
});

describe("PortalSidebar — catalog split into two doors (2026-07-25)", () => {
  beforeEach(() => {
    mockRole = "principal";
  });

  it("Admin lists the selling Product & Maintenance (last, after Accounts)", () => {
    renderAt("/principal?tab=dashboard");
    const pm = screen.getByText("Product & Maintenance").closest("a") as HTMLAnchorElement;
    expect(pm).toHaveAttribute("href", "/principal?tab=catalog");
    const accounts = screen.getByText("Accounts").closest("a") as HTMLAnchorElement;
    expect(
      accounts.compareDocumentPosition(pm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is active on /principal?tab=catalog — with NO section sub-links in the rail", () => {
    renderAt("/principal?tab=catalog");
    const pm = screen.getByText("Product & Maintenance").closest("a") as HTMLAnchorElement;
    expect(pm.className).toContain("bg-c-select-pill");
    expect(screen.queryByText("SKU Master")).not.toBeInTheDocument();
    expect(screen.queryByText("Promo / GWP")).not.toBeInTheDocument();
  });

  it("operation never sees the selling catalog — only the costing Products & Maintenance", () => {
    mockRole = "operation";
    renderAt("/operation/sc/op-catalog");
    expect(child("op-catalog")).toBeInTheDocument();
    expect(screen.queryByText("Product & Maintenance")).not.toBeInTheDocument();
  });
});

/* The Carres HR area (Overview, People, Commission, Team, Performance, People cost) is removed (owner,
   11 Nov 2026): no rail carries it; Houzs's Team, under System, keeps the people. */
describe("PortalSidebar — the HR area is gone", () => {
  it("the principal's rail carries no HR area and none of its rows", () => {
    mockRole = "principal";
    renderAt("/operation/sc/orders");
    expect(screen.queryByTestId("nav-area-hr")).toBeNull();
    for (const word of ["Commission", "People cost", "Performance"]) {
      expect(screen.queryByText(word), word).toBeNull();
    }
  });
});

/**
 * ⭐ THE SALES ORDER MODULE — the Houzs tree (Weisiang, WhatsApp 2026-11-01),
 * inside the Supply Chain row.
 *
 *     Sales Order
 *     ├─ Sales Orders
 *     ├─ Subscription
 *     ├─ Sales Order Amendment
 *     ├─ Delivery Orders
 *     ├─ Sales Invoices
 *     └─ Delivery Returns
 *
 * Sales Orders also has a second door under Workspace (`orders-shortcut`).
 * Every row opens its engine page at its own `/operation/sc/<row>` address;
 * the old addresses forward there (`retiredRedirect`, portal-nav.engine.test).
 */
describe("PortalSidebar — the Sales Order module", () => {
  it("is the Houzs Sales Order rows in Houzs order, then Subscription", () => {
    renderAt("/operation/sc/orders");
    expect(within(module_("sales")).getByText("Sales Order")).toBeInTheDocument();
    const group = screen.getByTestId("nav-children-sales");
    const rows = Array.from(group.querySelectorAll("[data-testid^='nav-child-']"));
    expect(rows.map((r) => r.textContent?.trim())).toEqual([
      "Sales Orders",
      "Fair Links to Settle",
      "Sales Order Amendment",
      "Payment Backdate Requests",
      "Delivery Orders",
      "Sales Invoices",
      "Delivery Returns",
      "Subscription",
    ]);
  });

  it("on /operation/sc/amendments only Sales Order Amendment is lit", () => {
    renderAt("/operation/sc/amendments");
    expect(child("amendments")).toHaveAttribute("href", "/operation/sc/amendments");
    expect(child("amendments").className).toContain("bg-c-select-pill");
    expect(child("orders").className).not.toContain("bg-c-select-pill");
  });

  it("links the register to its engine address and Subscription to its Carres page", () => {
    renderAt("/operation/sc/orders");
    // The register is the engine's Sales Orders page, at the row's own address.
    expect(child("orders")).toHaveAttribute("href", "/operation/sc/orders");
    // The Subscription-owned destination (`docs/rental/MASTER.md`) — unmoved.
    expect(child("rental")).toHaveAttribute("href", "/operation?tab=rental");
  });

  it("`Purchase` is never the word for a Sales Order child", () => {
    renderAt("/operation/sc/orders");
    const group = screen.getByTestId("nav-children-sales");
    expect(group.textContent).not.toMatch(/Purchase/);
  });

  it("on /operation/sc/orders Sales Orders is lit, and so is its second door under Workspace", () => {
    renderAt("/operation/sc/orders");
    expect(child("orders").className).toContain("bg-c-select-pill");
    expect(child("rental").className).not.toContain("bg-c-select-pill");
    // The shortcut is the same page by another door, so it lights with it.
    expect(child("orders-shortcut")).toHaveAttribute("href", "/operation/sc/orders");
    expect(child("orders-shortcut").className).toContain("bg-c-select-pill");
    expect(child("amendments").className).not.toContain("bg-c-select-pill");
  });

  it("Workspace starts with Houzs's Overview, then the Sales Orders shortcut, Workspace and Leave", () => {
    renderAt("/operation");
    // Houzs's Overview opens the engine's landing page at its own address (owner, 11 Nov 2026).
    expect(child("overview")).toHaveTextContent(/^Overview$/);
    expect(child("overview")).toHaveAttribute("href", "/operation/sc/overview");
    const shortcut = child("orders-shortcut");
    expect(shortcut).toHaveTextContent(/^Sales Orders$/);
    expect(shortcut.closest("[data-testid='nav-fold-children-supply-chain']")).toBeNull();
    expect(
      Array.from(screen.getByTestId("portal-sidebar-list").querySelectorAll("[data-testid^='nav-child-']"))
        .slice(0, 4)
        .map((el) => el.getAttribute("data-testid")),
    ).toEqual(["nav-child-overview", "nav-child-orders-shortcut", "nav-child-work", "nav-child-leave"]);
    // The old Carres Overview dashboard row is removed (owner, 11 Nov 2026).
    expect(screen.queryByTestId("nav-child-dashboard")).toBeNull();
  });

  it("Product Request is a plain row first under Supply Chain, above the Sales Order module", () => {
    renderAt("/operation/sc/product-request");
    const fold = screen.getByTestId("nav-fold-children-supply-chain");
    const first = fold.firstElementChild as HTMLElement;
    const row = within(fold).getAllByTestId("nav-child-product-request")[0];
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("aria-expanded")).toBeNull();
    expect(row).toHaveAttribute("href", "/operation/sc/product-request");
    expect(row.closest("[data-testid^='nav-children-']")).toBeNull();
    expect(first.contains(row)).toBe(true);
  });

  it("Sales Invoices opens the engine's Sales Invoices page at its own address", () => {
    renderAt("/operation/sc/sales-invoices");
    expect(child("sales-invoices")).toHaveAttribute("href", "/operation/sc/sales-invoices");
    expect(child("sales-invoices").className).toContain("bg-c-select-pill");
  });

  it("the bottom group sits under the caps SYSTEM heading, in Houzs's order: Team, Mail Center, Announcements, IT, Change Log, Assistant, Agent Console, IT Support, OCR", () => {
    renderAt("/operation");
    const head = screen.getByTestId("nav-group-head-system");
    expect(head).toHaveTextContent(/^System$/);
    expect(head.className).toMatch(/uppercase/);
    const nav = screen.getByRole("navigation", { name: "Modules" });
    const order = Array.from(
      nav.querySelectorAll<HTMLElement>("[data-testid^='nav-group-head-'], [data-testid^='nav-module-'], [data-testid^='nav-child-']"),
    ).map((el) => el.dataset.testid!);
    expect(order.slice(order.indexOf("nav-group-head-system"))).toEqual([
      "nav-group-head-system",
      "nav-module-team",
      "nav-child-mail-center",
      "nav-child-announcements",
      "nav-module-it",
      "nav-child-change-log",
      "nav-child-assistant",
      "nav-child-agent-console",
      "nav-child-it-support",
      "nav-child-ocr",
    ]);
  });

  it("the IT module opens on System Health and AI Usage and lights the page; a page under OCR lights OCR", () => {
    renderAt("/operation/sc/system-health");
    expect(module_("it")).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByTestId("nav-children-it")).getAllByTestId(/^nav-child-/).map((el) => el.dataset.testid)).toEqual([
      "nav-child-system-health",
      "nav-child-ai-usage",
    ]);
    expect(child("system-health")).toHaveAttribute("aria-current", "page");
    expect(child("system-health")).toHaveAttribute("href", "/operation/sc/system-health");
    expect(screen.getByTestId("houzs-icon-system-health")).toBeInTheDocument();
  });

  it("each new System row is a plain link to its own address, lit where it stands (and under ?at=)", () => {
    for (const key of ["announcements", "change-log", "assistant", "agent-console", "ocr"]) {
      const { unmount } = renderAt(`/operation/sc/${key}?at=${encodeURIComponent(`/${key}/x`)}`);
      expect(child(key), key).toHaveAttribute("href", `/operation/sc/${key}`);
      expect(child(key), key).toHaveAttribute("aria-current", "page");
      expect(child(key).getAttribute("aria-expanded"), key).toBeNull();
      unmount();
    }
  });

  it("on ?tab=rental only Subscription is lit, and it opens the Sales Order module", () => {
    renderAt("/operation?tab=rental");
    expect(child("rental").className).toContain("bg-c-select-pill");
    expect(child("orders").className).not.toContain("bg-c-select-pill");
    expect(module_("sales").getAttribute("aria-expanded")).toBe("true");
  });

  /* THE ROW MOVED; IT WAS NOT COPIED. Two rows to one page are two rows the
     rail would light at once — Law C, a door and never a duplicate. */
  it("Subscription left Customer Care — it is not in both places", () => {
    renderAt("/operation?tab=rental");
    expect(screen.getAllByTestId("nav-child-rental")).toHaveLength(1);
    expect(screen.queryByText("Rental")).not.toBeInTheDocument();
  });

  it("Service Cases carries its four pages, under the `Service Cases` module word", () => {
    renderAt("/operation/sc/service-notes");
    expect(within(module_("customer-care")).getByText("Service Cases")).toBeInTheDocument();
    const group = screen.getByTestId("nav-children-customer-care");
    const rows = Array.from(group.querySelectorAll("[data-testid^='nav-child-']"));
    expect(rows.map((r) => r.textContent?.trim())).toEqual([
      "Quality Overview",
      "Service Cases",
      "Service Maintenance",
      "My Cases",
    ]);
    expect(child("service-quality")).toHaveAttribute("href", "/operation/sc/service-quality");
    expect(child("service-notes")).toHaveAttribute("href", "/operation/sc/service-notes");
    expect(child("service-maintenance")).toHaveAttribute("href", "/operation/sc/service-maintenance");
    expect(child("service-mine")).toHaveAttribute("href", "/operation/sc/service-mine");
    // The removed Guarantees row stays gone.
    expect(screen.queryByTestId("nav-child-guarantees")).toBeNull();
    // The Carres Issue Tracker row is removed (owner, 11 Nov 2026).
    expect(screen.queryByTestId("nav-child-issue-tracker")).toBeNull();
  });

  it("the four Service Cases rows light one at a time", () => {
    for (const [path, lit] of [
      ["/operation/sc/service-notes", "service-notes"],
      ["/operation/sc/service-quality", "service-quality"],
      ["/operation/sc/service-mine", "service-mine"],
      ["/operation/sc/service-maintenance", "service-maintenance"],
    ] as const) {
      const view = renderAt(path);
      const group = screen.getByTestId("nav-children-customer-care");
      expect(
        Array.from(group.querySelectorAll("[data-testid^='nav-child-']"))
          .filter((el) => el.className.includes("bg-c-select-pill"))
          .map((el) => el.getAttribute("data-testid")),
        path,
      ).toEqual([`nav-child-${lit}`]);
      view.unmount();
    }
  });

  /* ⭐ THE MENU ROW IS REMOVED. THE PAGE IS NOT. "Menu removal does not delete
     orders, history, documents or valid existing deep links." The route test
     that proves the page still mounts lives in OperationApp.test.tsx; this one
     proves only that the RAIL no longer offers it. */
  it("Old Orders has left the rail", () => {
    renderAt("/operation/sc/orders");
    expect(screen.queryByText("Old Orders (temporary)")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nav-child-old-orders")).not.toBeInTheDocument();
  });

  it("standing on the legacy route still shows the rail, and lights nothing falsely", () => {
    renderAt("/operation/old-orders");
    // The de-navigated page keeps working; no Sales Order child claims to be it.
    openSupply();
    expect(module_("sales")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-child-old-orders")).not.toBeInTheDocument();
  });

  it("Delivery Orders and Delivery Returns are Sales Order pages, at their own addresses", () => {
    renderAt("/operation/sc/orders");
    const group = screen.getByTestId("nav-children-sales");
    expect(within(group).getByTestId("nav-child-delivery-orders")).toHaveAttribute("href", "/operation/sc/delivery-orders");
    expect(within(group).getByTestId("nav-child-delivery-returns")).toHaveAttribute("href", "/operation/sc/delivery-returns");
    expect(within(screen.getByTestId("nav-module-delivery")).queryByText("Delivery Orders")).toBeNull();
  });

  /* ONE DESTINATION, ONE WORD. A principal stands in Operations AND Admin at
     once; both rows open the one Sales Orders register, so two different
     words would be the duplicate the ruling names. The Admin area is
     a shut accordion on an Operations URL, so the word is proved at the model
     it is read from — see `portal-nav.sales.test.ts` for the whole tree. */
  it("a principal sees the Sales Order parent, and the register is `Sales Orders`", () => {
    mockRole = "principal";
    renderAt("/operation/sc/orders");
    expect(within(module_("sales")).getByText("Sales Order")).toBeInTheDocument();
    expect(child("orders")).toHaveTextContent(/^Sales Orders$/);
  });
});

/**
 * ⭐ THE PROCUREMENT MAP — TEN PAGES, NO DRAWERS (Weisiang, WhatsApp
 * 2026-11-01; Houzs Sidebar.tsx:579-588).
 *
 * Procurement is one flat list on its tree line. The four drawers it wore
 * (BUY · RECEIVE · PROBLEMS · SHOWROOM, Jess 2026-08-22) are gone, with the
 * page-group registry that drew them. Suppliers is a page inside it; the
 * consignment rows live in Consignment. The Carres-only rows (Supplier items,
 * SO Batch, Forecast and Manual Purchase, Supplier Claims, Repair Orders) left
 * with the old Carres pages (owner, 11 Nov 2026); every row is an engine page.
 */
describe("PortalSidebar — the Procurement map", () => {
  it("opens onto ten direct rows — no drawer, no Report, no hairline", () => {
    renderAt("/operation/sc/purchase-orders");
    const tree = screen.getByTestId("nav-children-purchasing");
    // Every child of the tree line IS a page row — no group word sits among them.
    expect(tree.querySelectorAll("[data-testid^='nav-group-']")).toHaveLength(0);
    expect(tree.querySelectorAll("[data-testid^='nav-child-']")).toHaveLength(10);
    // Reports moved to the central Reports area, so the rule above them went too.
    expect(tree.querySelector(".border-t")).toBeNull();
  });

  it("ten pages in the Houzs order, and not an eleventh", () => {
    renderAt("/operation/sc/purchase-orders");
    const tree = screen.getByTestId("nav-children-purchasing");
    const rows = Array.from(tree.querySelectorAll("[data-testid^='nav-child-']")).map(
      (el) => el.textContent?.replace("Coming soon", "").trim(),
    );
    expect(rows).toEqual([
      "Procurement Overview",
      "Products & Maintenance",
      "Suppliers",
      "MRP · Stock Status",
      "Purchase Orders",
      /* 0717 · Weisiang's decision (Mr Lim, WhatsApp 2026-10-22; Jess was not part of this decision). */
      "PO Amendments",
      "Cancellation Requests",
      "Goods Receipt",
      "Purchase Invoices",
      "Purchase Returns",
    ]);
  });

  /* THE EIGHT ROWS THE OWNER DELETED. Each one was a destination the rail
   * offered and the business does not have; a rail that still offers them
   * sends an operator to a page nobody owns. */
  it("every retired row and every old drawer word is gone from the whole rail", () => {
    renderAt("/operation/sc/purchase-orders");
    for (const key of [
      "purchasing-home",
      "purchasing-work",
      "new-supplier-requests",
      "new-sku-requests",
      "purchase-demands",
      "consignment-overview",
      "consignment-receipts",
      "consignment-orders",
      /* Removed with the old Carres Supply Chain pages (owner, 11 Nov 2026). */
      "supplier-items",
      "purchase",
      "forecast-purchase",
      "manual-purchase",
      "claims",
      "repair-orders",
    ]) {
      expect(screen.queryByTestId(`nav-child-${key}`), key).not.toBeInTheDocument();
    }
    // The Purchasing report left with the old Carres pages, from the whole rail.
    expect(screen.queryByTestId("nav-child-purchasing-report")).toBeNull();
    for (const word of [
      "Purchasing Home",
      "My Purchasing Work",
      "New Supplier Requests",
      "New SKU Requests",
      "Purchase Demands",
      "Consignment Overview",
      "Consignment Receipts",
      "Manual Purchase Requests",
      "Supplier items",
      "SO Batch Purchase",
      "Forecast Purchase",
      "Manual Purchase Request",
      "Supplier Claims",
      "Repair Orders",
      "BUY",
      "RECEIVE",
      "PROBLEMS",
      "SHOWROOM",
      "REQUESTS",
      "CONSIGNMENT",
      "Report",
    ]) {
      expect(screen.queryByText(word), word).not.toBeInTheDocument();
    }
    expect(document.querySelector("[data-testid^='nav-group-purchasing-']")).toBeNull();
  });

  it("the rail word is `Goods Receipt`", () => {
    renderAt("/operation/sc/receiving");
    const tree = within(screen.getByTestId("nav-children-purchasing"));
    // Houzs word for the receipt (Weisiang, 2026-11-01); the old `Receiving` is gone.
    expect(tree.getByText("Goods Receipt")).toBeInTheDocument();
    expect(screen.queryByText("Receiving")).not.toBeInTheDocument();
    // The plural and the GRN stay out of navigation (ERP-ARCHITECTURE §2.1).
    expect(screen.queryByText("Goods Receipts")).not.toBeInTheDocument();
    expect(screen.queryByText(/GRN/)).not.toBeInTheDocument();
    expect(tree.queryByText("Manual Purchase")).toBeNull();
    expect(screen.queryByText("Manual Purchase Requests")).not.toBeInTheDocument();
    expect(screen.queryByText("To Order")).not.toBeInTheDocument();
    expect(screen.queryByText("Claims")).not.toBeInTheDocument();
  });

  it("a live row IS a link, on its own engine address", () => {
    renderAt("/operation/sc/receiving");
    const row = child("receiving");
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("href")).toBe("/operation/sc/receiving");
    expect(row.textContent).not.toContain("Coming soon");
    expect(child("purchase-invoices")).toHaveAttribute("href", "/operation/sc/purchase-invoices");
  });

  it("Products & Maintenance, Suppliers and MRP are Procurement pages on their own addresses", () => {
    renderAt("/operation/sc/suppliers");
    expect(screen.getByTestId("nav-children-purchasing").contains(child("suppliers"))).toBe(true);
    expect(child("suppliers").className).toContain("bg-c-select-pill");
    expect(child("op-catalog")).toHaveAttribute("href", "/operation/sc/op-catalog");
    expect(child("suppliers")).toHaveAttribute("href", "/operation/sc/suppliers");
    expect(child("mrp")).toHaveAttribute("href", "/operation/sc/mrp");
    expect(screen.queryByTestId("nav-child-supplier-items")).toBeNull();
  });

  it("`Purchase Orders` links to its own engine address, not to the old path or a ?tab=", () => {
    renderAt("/operation/sc/receiving");
    expect(child("purchase-orders").getAttribute("href")).toBe("/operation/sc/purchase-orders");
  });

  it("Purchase Returns is a real door", () => {
    renderAt("/operation/sc/purchase-orders");
    const row = child("purchase-returns");
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("href")).toBe("/operation/sc/purchase-returns");
    expect(row.getAttribute("aria-disabled")).not.toBe("true");
    expect(row.textContent).not.toContain("Coming soon");
  });

  it("no Procurement row is unbuilt, so none says Coming soon", () => {
    renderAt("/operation/sc/purchase-orders");
    const tree = screen.getByTestId("nav-children-purchasing");
    expect(tree.querySelectorAll("[data-soon='1']")).toHaveLength(0);
    expect(tree.textContent).not.toContain("Coming soon");
  });

  it("a Procurement page lights alone — Goods Receipt does not light next to Purchase Orders", () => {
    renderAt("/operation/sc/purchase-orders");
    expect(child("purchase-orders").className).toContain("bg-c-select-pill");
    expect(child("receiving").className).not.toContain("bg-c-select-pill");
  });
});

/**
 * THE PROCUREMENT ROW IS A HANDLE, NOT A DOOR. Clicking it reveals the list
 * and leaves the URL where it was — the operator clicks this row to LOOK far
 * more often than to travel.
 */
describe("PortalSidebar — the Procurement parent toggles without navigating", () => {
  it("a click opens Houzs's Procurement hub and the tree", () => {
    renderAt("/operation");
    openSupply();
    fireEvent.click(module_("purchasing"));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/operation/sc/hub-procurement");
    expect(screen.getByTestId("nav-children-purchasing")).toBeInTheDocument();
    expect(module_("purchasing").getAttribute("aria-expanded")).toBe("true");
  });

  it("the whole row is one button carrying its own aria-expanded", () => {
    renderAt("/operation");
    openSupply();
    const row = module_("purchasing");
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("opening Procurement still shuts the module that was open", () => {
    renderAt("/operation/sc/orders");
    expect(screen.getByTestId("nav-children-sales")).toBeInTheDocument();
    fireEvent.click(module_("purchasing"));
    expect(screen.getByTestId("nav-children-purchasing")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-children-sales")).not.toBeInTheDocument();
  });

  it("shutting Procurement while standing on a Procurement page is allowed", () => {
    renderAt("/operation/sc/receiving");
    expect(screen.getByTestId("nav-children-purchasing")).toBeInTheDocument();
    fireEvent.click(module_("purchasing"));
    expect(screen.queryByTestId("nav-children-purchasing")).not.toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/operation/sc/receiving",
    );
  });

  /* ⭐ WHERE YOU ARE IS ALWAYS MARKED (owner 12 Oct 2026; 01 §4): the module
   * holding the current page wears the selection, open or shut. Open, its
   * page wears it too. Shut, the module is the one mark. `aria-current` stays
   * on the page alone. */
  it("shut, the module is the one mark of where you are", () => {
    renderAt("/operation/sc/receiving");
    fireEvent.click(module_("purchasing")); // shut it, still on Goods Receipt
    expect(module_("purchasing").className).toContain("bg-c-select-pill");
    expect(module_("purchasing").className).toContain("font-semibold");
    expect(module_("purchasing").className).toContain("text-c-select-fg");
  });

  it("open, the module and its current page both wear the selection", () => {
    renderAt("/operation/sc/receiving");
    expect(module_("purchasing").className).toContain("bg-c-select-pill");
    expect(child("receiving").className).toContain("bg-c-select-pill");
    expect(module_("purchasing").getAttribute("aria-current")).toBeNull();
    expect(child("receiving").getAttribute("aria-current")).toBe("page");
  });

  it("open tree: exactly ONE page is selected — never a sibling", () => {
    renderAt("/operation/sc/receiving");
    const lit = screen
      .getByTestId("nav-children-purchasing")
      .querySelectorAll(".bg-c-select-pill");
    expect(lit.length).toBe(1);
    expect(child("receiving").className).toContain("bg-c-select-pill");
    expect(document.querySelectorAll("[aria-current='page']")).toHaveLength(1);
  });

  it("a module that does not hold the current page stays neutral", () => {
    renderAt("/operation/sc/orders");
    expect(module_("purchasing").className).not.toContain("bg-c-select-pill");
    expect(module_("sales").className).toContain("bg-c-select-pill");
  });

  it("arriving by URL opens Supply Chain and Procurement so the destination is never hidden", () => {
    renderAt("/operation/sc/purchase-returns");
    expect(supply().getAttribute("aria-expanded")).toBe("true");
    expect(module_("purchasing").getAttribute("aria-expanded")).toBe("true");
    expect(child("purchase-returns").className).toContain("bg-c-select-pill");
  });

  it("arriving at Goods Receipt opens Procurement and lights ONE row", () => {
    renderAt("/operation/sc/receiving");
    expect(module_("purchasing").getAttribute("aria-expanded")).toBe("true");
    expect(child("receiving").className).toContain("bg-c-select-pill");
    const lit = screen
      .getByTestId("nav-children-purchasing")
      .querySelectorAll(".bg-c-select-pill");
    expect(lit.length).toBe(1);
  });

  /* THE 64px ICON. Procurement's named landing (`PURCHASING_LANDING_KEY`, SO
   * Batch Purchase) left with the old Carres pages, so the icon lands on the
   * module's first live page, Procurement Overview (`moduleLandingPage`). */
  it("the collapsed Procurement icon links to its first live page, and lights on any Procurement page", () => {
    localStorage.setItem("carres-menu-collapsed", "1");
    try {
      renderAt("/operation/sc/receiving");
      const icon = screen.getByTitle("Procurement") as HTMLAnchorElement;
      expect(icon).toHaveAttribute("href", "/operation/sc/procurement-overview");
      // Standing on Goods Receipt still lights the module's one icon.
      expect(icon.className).toContain("bg-c-select-pill");
    } finally {
      localStorage.removeItem("carres-menu-collapsed");
    }
  });

  it("collapsed to 64px, every Procurement row disappears", () => {
    localStorage.setItem("carres-menu-collapsed", "1");
    try {
      renderAt("/operation/sc/receiving");
      expect(screen.getByTitle("Procurement")).toBeInTheDocument();
      expect(screen.queryByTestId("nav-fold-supply-chain")).not.toBeInTheDocument();
      expect(screen.queryByText("Goods Receipt")).not.toBeInTheDocument();
      expect(screen.queryByText("Purchase Returns")).not.toBeInTheDocument();
      expect(screen.queryByText("Suppliers")).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem("carres-menu-collapsed");
    }
  });
});

/**
 * TRANSPORTATION'S ONE GROUP. `Maintenance` (Fleet · Delivery Zones · Carriers
 * & Rates · Fleet Health; Houzs Sidebar.tsx:649) is the only page group left.
 * It is a word on the tree with its own chevron, never a destination, drawn in
 * normal case at 13px like the rows beside it. The group holding the current
 * page is open and cannot be shut; elsewhere in the module it opens and shuts
 * by hand, for the page it was worked on only.
 */
describe("PortalSidebar — the Maintenance group", () => {
  it("is a full-width button with its own aria-expanded", () => {
    renderAt("/operation/sc/fleet-day");
    const row = group_(MAINTENANCE);
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("aria-expanded")).not.toBeNull();
    /* Full width by its column: the button is a stretched child of a flex
       column (the `w-full` class itself left with the 2026-10-08 drawing). */
    expect(row.parentElement?.className).toContain("flex-col");
    expect(within(row).getByText("Maintenance")).toBeInTheDocument();
  });

  it("the word is a normal-case 13px row label, never a caps heading or a destination", () => {
    renderAt("/operation/sc/fleet-day");
    const row = group_(MAINTENANCE);
    expect(row.className).toContain("text-[13px]");
    expect(row.className).toContain("font-normal");
    expect(row.className).not.toContain("uppercase");
    expect(row.className).not.toContain("text-[11px]");
    expect(row.getAttribute("href")).toBeNull();
  });

  it("holds Coverage & Fleet, Delivery Zones, Carriers & Rates and Fleet Health, in that order", () => {
    renderAt("/operation/sc/fleet-day");
    const rows = Array.from(
      screen.getByTestId(`nav-group-children-${MAINTENANCE}`).querySelectorAll("[data-testid^='nav-child-']"),
    ).map((el) => el.textContent?.trim());
    expect(rows).toEqual(["Coverage & Fleet", "Delivery Zones", "Carriers & Rates", "Fleet Health"]);
  });

  it("the group holding the current page opens itself and REFUSES to shut", () => {
    renderAt("/operation/sc/fleet-health");
    const group = group_(MAINTENANCE);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(group.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(group);
    expect(group_(MAINTENANCE).getAttribute("aria-expanded")).toBe("true");
    expect(child("fleet-health")).toBeInTheDocument();
    expect(child("fleet-health").className).toContain("bg-c-select-pill");
  });

  it("a group you are NOT standing in stays an ordinary handle", () => {
    renderAt("/operation/sc/fleet-day");
    expect(group_(MAINTENANCE).getAttribute("aria-disabled")).toBeNull();
  });

  it("a group worked by hand shuts and opens again on the next click", () => {
    renderAt("/operation/sc/fleet-day");
    expect(group_(MAINTENANCE).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(group_(MAINTENANCE));
    expect(group_(MAINTENANCE).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId(`nav-group-children-${MAINTENANCE}`)).not.toBeInTheDocument();
    fireEvent.click(group_(MAINTENANCE));
    expect(group_(MAINTENANCE).getAttribute("aria-expanded")).toBe("true");
    expect(child("coverage-fleet")).toBeInTheDocument();
  });

  /* The group word sits on the same 46px as the page text under it: the tree
   * is 18 in, the word is padded 28, the page is 18 + its own 10. */
  it("the group word is aligned with the page text beneath it", () => {
    renderAt("/operation/sc/fleet-day");
    expect(screen.getByTestId("nav-children-delivery").className).toContain("ml-[18px]");
    expect(group_(MAINTENANCE).className).toContain("pl-7");
    expect(treeRow("fleet-day").className).toContain("pl-[18px]");
    expect(child("coverage-fleet").className).toContain("px-2.5");
    expect(child("coverage-fleet").className).toContain("text-[13px]");
  });

  it("the group word carries no trunk and no elbow: the line stops before it", () => {
    renderAt("/operation/sc/fleet-day");
    expect(group_(MAINTENANCE).querySelector("[data-tree]")).toBeNull();
    const beside = Array.from(group_(MAINTENANCE).parentElement?.children ?? []);
    expect(beside.some((el) => el.hasAttribute("data-tree"))).toBe(false);
  });

  it("the group holding the current page is open when the page loads", () => {
    renderAt("/operation/sc/delivery-zones");
    expect(group_(MAINTENANCE).getAttribute("aria-expanded")).toBe("true");
    expect(child("delivery-zones").className).toContain("bg-c-select-pill");
    expect(group_(MAINTENANCE).className).not.toContain("bg-c-select-pill");
  });

  it("a module opened to look, from another module's page, shows the group open", () => {
    renderAt("/operation/sc/orders");
    fireEvent.click(module_("delivery"));
    expect(group_(MAINTENANCE).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Carriers & Rates")).toBeVisible();
  });

  it("the group has its own chevron: up while open, down while shut", () => {
    renderAt("/operation/sc/fleet-day");
    expect(group_(MAINTENANCE).querySelector(MICON)?.getAttribute("data-icon")).toBe("expand_less");
    fireEvent.click(group_(MAINTENANCE));
    expect(group_(MAINTENANCE).querySelector(MICON)?.getAttribute("data-icon")).toBe("expand_more");
  });

  it("a group shut by hand does not outlive the page it was shut on", () => {
    function Jump() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/operation/sc/crew-leave")}>jump</button>;
    }
    render(
      <MemoryRouter initialEntries={["/operation/sc/fleet-day"]}>
        <PortalSidebar />
        <Jump />
      </MemoryRouter>,
    );
    fireEvent.click(group_(MAINTENANCE));
    expect(group_(MAINTENANCE).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByText("jump"));
    expect(group_(MAINTENANCE).getAttribute("aria-expanded")).toBe("true");
  });

  it("collapsed to 64px, the group word and its rows disappear", () => {
    localStorage.setItem("carres-menu-collapsed", "1");
    try {
      renderAt("/operation/sc/fleet-health");
      expect(screen.getByTitle("Transportation")).toBeInTheDocument();
      expect(screen.queryByTestId(`nav-group-${MAINTENANCE}`)).not.toBeInTheDocument();
      expect(screen.queryByText("Maintenance")).not.toBeInTheDocument();
      expect(screen.queryByText("Fleet Health")).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem("carres-menu-collapsed");
    }
  });
});

/**
 * NOTHING ABOUT THE MENU IS STORED PER PERSON (owner 12 Oct 2026). Which module
 * and which group are open is read from the page on every load, so the menu
 * can never hide the page you are on and never opens a group you are not in.
 * The one thing remembered is the person's own « choice.
 */
describe("PortalSidebar — the menu stores no open groups", () => {
  it("working the chevrons writes nothing to storage", () => {
    mockUserId = "user-a";
    renderAt("/operation/sc/fleet-day");
    fireEvent.click(group_(MAINTENANCE));
    fireEvent.click(module_("delivery"));
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("an older stored preference is ignored: the page still decides", () => {
    mockUserId = "user-a";
    localStorage.setItem(
      "carres:portal-sidebar:purchasing:v2:user-a",
      JSON.stringify({ moduleOpen: true, openGroups: ["purchasing-showroom"] }),
    );
    renderAt("/operation/sc/orders");
    expect(screen.queryByTestId("nav-children-purchasing")).toBeNull();
    expect(screen.getByTestId("nav-children-sales")).toBeInTheDocument();
  });
});

/* Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): customer consignment
 * sits in its own Consignment module right after Sales, the Houzs placement
 * (Houzs-ERP Sidebar.tsx:558-567). The unbuilt Display Requests row was
 * removed with the old Carres pages (owner, 11 Nov 2026). */
describe("PortalSidebar — the Consignment module", () => {
  it("carries the seven Houzs consignment rows in Houzs order", () => {
    renderAt("/operation/sc/consignment-notes");
    expect(screen.getByTestId("nav-module-consignment")).toBeInTheDocument();
    const rows = Array.from(
      screen
        .getByTestId("nav-children-consignment")
        .querySelectorAll("[data-testid^='nav-child-']"),
    ).map((el) => el.textContent?.replace("Coming soon", "").trim());
    expect(rows).toEqual([
      "Consignment Order",
      "Consignment Note",
      "Consignment Return",
      "Purchase Consignment Order",
      "Product Request",
      "Purchase Consignment Receive",
      "Purchase Consignment Return",
    ]);
  });

  it("every consignment row links to its own engine address", () => {
    renderAt("/operation/sc/consignment-notes");
    for (const key of [
      "customer-consignment-orders",
      "consignment-notes",
      "customer-consignment-returns",
      "purchase-consignment-orders",
      "product-requests",
      "consignment-receives",
      "consignment-returns",
    ]) {
      expect(child(key), key).toHaveAttribute("href", `/operation/sc/${key}`);
    }
  });

  it("Purchase Consignment Return is a real door; the removed Display Requests row is gone", () => {
    renderAt("/operation/sc/consignment-notes");
    expect(child("consignment-returns").tagName).toBe("A");
    expect(child("consignment-returns").textContent).not.toContain("Coming soon");
    expect(screen.queryByTestId("nav-child-display-requests")).not.toBeInTheDocument();
    // The retired Consignment Orders row stays gone.
    expect(screen.queryByTestId("nav-child-consignment-orders")).not.toBeInTheDocument();
  });

  it("no row is unbuilt, and none renders a count or a `0`", () => {
    mockBadges = { orders: 0, procurement: 0, serviceNotes: 0, lpRejected: 0 };
    renderAt("/operation/sc/consignment-notes");
    const tree = screen.getByTestId("nav-children-consignment");
    expect(tree.querySelectorAll("[data-soon='1']")).toHaveLength(0);
    expect(tree.textContent).not.toContain("Coming soon");
    expect(tree.querySelector("[data-testid^='nav-badge-']")).toBeNull();
    expect(tree.textContent).not.toMatch(/\b0\b/);
  });
});

describe("PortalSidebar — the Transportation module", () => {
  /* Delivery Orders and Delivery Returns moved to Sales Order (Houzs tree,
   * 2026-11-01), so Transportation is the job of the lorry: plan, load and
   * deliver, then set-up under Maintenance. The module record is still keyed
   * `delivery`. */
  it("Transportation carries its pages in the order of the job, Maintenance last", () => {
    renderAt("/operation/sc/delivery-planning");
    expect(screen.getByTestId("nav-module-delivery")).toBeInTheDocument();
    expect(within(screen.getByTestId("nav-module-delivery")).getByText("Transportation")).toBeInTheDocument();
    const rows = Array.from(
      screen
        .getByTestId("nav-children-delivery")
        .querySelectorAll("[data-testid^='nav-child-']"),
    ).map((el) => el.textContent?.replace("Coming soon", "").trim());
    expect(rows).toEqual([
      "Logistic Overview",
      "Delivery Planning",
      "Last Mile Delivery (Driver)",
      "DP Orders",
      "Last Mile Delivery",
      "Crew Leave",
      "Coverage & Fleet",
      "Delivery Zones",
      "Carriers & Rates",
      "Fleet Health",
    ]);
  });

  it("every Transportation row links to its own engine address", () => {
    renderAt("/operation/sc/delivery-planning");
    for (const key of [
      "logistic-overview",
      "delivery-planning",
      "delivery-planning-driver",
      "dp-orders",
      "fleet-day",
      "crew-leave",
      "coverage-fleet",
      "delivery-zones",
      "rate-cards",
      "fleet-health",
    ]) {
      expect(child(key), key).toHaveAttribute("href", `/operation/sc/${key}`);
    }
  });

  it("Logistic Overview opens its own address and is the ONLY active row there", () => {
    renderAt("/operation/sc/logistic-overview");
    const overview = child("logistic-overview");
    expect(overview.tagName).toBe("A");
    expect(overview).toHaveAttribute("href", "/operation/sc/logistic-overview");
    expect(overview.className).toContain("bg-c-select-pill");
    expect(child("delivery-planning").className).not.toContain("bg-c-select-pill");
    expect(screen.getByTestId("nav-children-delivery").querySelectorAll(".bg-c-select-pill")).toHaveLength(1);
  });

  it("Delivery Orders opens its own address and lights only itself", () => {
    renderAt("/operation/sc/delivery-orders");
    const register = child("delivery-orders");
    expect(register).toHaveAttribute("href", "/operation/sc/delivery-orders");
    expect(register.className).toContain("bg-c-select-pill");
    expect(child("orders").className).not.toContain("bg-c-select-pill");
    expect(module_("sales").getAttribute("aria-expanded")).toBe("true");
  });

  it("an old DO object deep link forwards to the Delivery Orders row, which lights", () => {
    const forwarded = retiredRedirect("/operation/delivery-orders/DO-040926-0001", "");
    expect(forwarded).toBe("/operation/sc/delivery-orders");
    renderAt(forwarded!);
    expect(child("delivery-orders").className).toContain("bg-c-select-pill");
    expect(child("orders").className).not.toContain("bg-c-select-pill");
  });

  it("Delivery Returns lights only itself, inside Sales Order", () => {
    renderAt("/operation/sc/delivery-returns");
    expect(child("delivery-returns").className).toContain("bg-c-select-pill");
    expect(module_("sales").getAttribute("aria-expanded")).toBe("true");
    expect(child("delivery-orders").className).not.toContain("bg-c-select-pill");
  });

  it("does not show retired Delivery destinations", () => {
    renderAt("/operation/sc/delivery-planning");
    const tree = screen.getByTestId("nav-children-delivery");
    for (const key of [
      "delivery-schedule",
      "delivery-history",
      "delivery-exceptions",
      "delivery-partners",
      "delivery-report",
      /* Removed with the old Carres pages (owner, 11 Nov 2026): Monitor, Load
         Scan, Lorry Live Map and Lorry Capacity. */
      "delivery",
      "load-scan",
      "fleet-map",
      "fleet-capacity",
      // Moved to Sales Order.
      "delivery-orders",
      "delivery-returns",
    ]) {
      expect(tree.querySelector(`[data-testid='nav-child-${key}']`), key).toBeNull();
    }
    for (const key of ["delivery-schedule", "delivery-history", "delivery-exceptions", "delivery-partners", "delivery-report", "load-scan"]) {
      expect(screen.queryByTestId(`nav-child-${key}`), key).toBeNull();
    }
  });
});

describe("PortalSidebar — the Warehouse module", () => {
  /* THE MAP is the Houzs Warehouse list (Sidebar.tsx:679-696, Weisiang
   * 2026-11-01): Loading List, Warehouses and Racks & Bins first, then the
   * office stock pages. The Carres schedules, Inbound and Outbound left with
   * the old Carres pages (owner, 11 Nov 2026). No Warehouse-local Dashboard
   * label remains (Stock MASTER §2, ERP-ARCHITECTURE §2.1). */
  it("the map starts Loading List, Warehouses, Racks & Bins, and carries seven pages in order", () => {
    renderAt("/operation/sc/stock");
    const rows = Array.from(
      screen
        .getByTestId("nav-children-warehouse")
        .querySelectorAll("[data-testid^='nav-child-']"),
    ).map((el) => el.textContent?.replace("Coming soon", "").trim());
    expect(rows).toEqual([
      "Loading List",
      "Warehouses",
      "Racks & Bins",
      "Inventory",
      // Weisiang's decision (Mr Lim, WhatsApp 2026-10-22): office Stock
      // Adjustment, Transfer and Take join the rail after Inventory; renamed
      // Adjustments and Transfers on 2026-11-01.
      "Adjustments",
      "Transfers",
      "Stock Take",
    ]);
  });

  /* Loading List, Warehouses and Racks & Bins are three engine views, each at
   * its own address; each lights alone. */
  it("Loading List, Warehouses and Racks & Bins light one at a time", () => {
    for (const [path, lit] of [
      ["/operation/sc/wh-warehouses", "wh-warehouses"],
      ["/operation/sc/wh-loading-list", "wh-loading-list"],
      ["/operation/sc/wh-racks", "wh-racks"],
    ] as const) {
      const view = renderAt(path);
      expect(supply(), path).toHaveAttribute("aria-expanded", "true");
      const group = screen.getByTestId("nav-children-warehouse");
      expect(
        Array.from(group.querySelectorAll("[data-testid^='nav-child-']"))
          .filter((el) => el.className.includes("bg-c-select-pill"))
          .map((el) => el.getAttribute("data-testid")),
        path,
      ).toEqual([`nav-child-${lit}`]);
      view.unmount();
    }
    renderAt("/operation/sc/wh-warehouses");
    expect(child("wh-loading-list")).toHaveAttribute("href", "/operation/sc/wh-loading-list");
    expect(child("wh-warehouses")).toHaveAttribute("href", "/operation/sc/wh-warehouses");
    expect(child("wh-racks")).toHaveAttribute("href", "/operation/sc/wh-racks");
  });

  it("Inventory is a live door at its own engine address", () => {
    renderAt("/operation/sc/stock");
    expect(child("stock")).toHaveAttribute("href", "/operation/sc/stock");
    expect(screen.getByTestId("nav-child-stock")).toHaveTextContent("Inventory");
  });

  it("the removed Carres warehouse pages are gone — both Schedules, Inbound, Outbound", () => {
    renderAt("/operation/sc/stock");
    for (const key of ["wh-arrival-schedule", "wh-pickup-schedule", "wh-inbound", "wh-outbound"]) {
      expect(screen.queryByTestId(`nav-child-${key}`), key).toBeNull();
    }
    // No Warehouse-local Dashboard label remains, and the retired combined
    // Monitor is gone from the rail (owner ruling 2026-09-14).
    const warehouseRail = within(screen.getByTestId("nav-children-warehouse"));
    expect(warehouseRail.queryByText("Dashboard")).toBeNull();
    expect(warehouseRail.queryByText("Monitor")).toBeNull();
  });

  /* The superseded subtree is GONE from the rail. The pages behind
   * `?tab=stock-plan` and `?tab=movements` keep their routes until their
   * capabilities are relocated (Stock MASTER §13) — de-navigated, not
   * deleted. */
  it("the superseded rows are gone — Stock, Ready stock, In & out, the old transfers key, Counts", () => {
    renderAt("/operation/sc/stock");
    for (const key of ["stock-plan", "movements", "transfers", "counts"]) {
      expect(screen.queryByTestId(`nav-child-${key}`)).toBeNull();
    }
    const railWords = Array.from(
      document.querySelectorAll("[data-testid^='nav-child-'], [data-testid^='nav-module-']"),
    ).map((el) => el.textContent?.replace("Coming soon", "").trim());
    /* `Transfers` is NOT in this list: it is the 2026-11-01 word of the live
       Stock Transfer row (`stock-transfers`); the retired row was `transfers`. */
    for (const retired of ["Stock", "Ready stock", "In & out", "Counts"]) {
      expect(railWords).not.toContain(retired);
    }
    expect(within(module_("warehouse")).getByText("Warehouse")).toBeInTheDocument();
  });

  /* THE 64px ICON. Warehouse's named landing (`WAREHOUSE_LANDING_KEY`, Arrival
   * Schedule) left with the old Carres pages, so the icon lands on the
   * module's first live page, Loading List (`moduleLandingPage`). */
  it("the collapsed Warehouse icon links to its first live page, and lights on a Warehouse page", () => {
    localStorage.setItem("carres-menu-collapsed", "1");
    try {
      renderAt("/operation/sc/stock");
      const icon = screen.getByTitle("Warehouse") as HTMLAnchorElement;
      expect(icon).toHaveAttribute("href", "/operation/sc/wh-loading-list");
      expect(icon.className).toContain("bg-c-select-pill");
    } finally {
      localStorage.removeItem("carres-menu-collapsed");
    }
  });
});

/**
 * SETTINGS SITS AT THE BOTTOM OF THE MENU (Carres Layout Standard §2, owner
 * ruling 2026-10-08). The 2026-08-19 "no rail Settings row — the header gear
 * is the one Settings entry" rule is RETIRED by the owner: the header gear is
 * gone, and the ONE Settings entry is the row above the avatar.
 */
describe("the one Settings row, at the bottom of the menu", () => {
  it("operation — one Settings row, below every module, on every page", () => {
    for (const path of [
      "/operation",
      "/operation/sc/orders",
      "/operation/sc/purchase-orders",
      "/operation/sc/delivery-planning",
      "/operation/sc/stock",
    ]) {
      const view = renderAt(path);
      const settings = screen.getByTestId("nav-settings");
      expect(screen.getAllByTestId("nav-settings"), path).toHaveLength(1);
      // Houzs's own Settings (owner, 11 Nov 2026; the Carres Settings workspace is removed).
      expect(settings).toHaveAttribute("href", "/operation/sc/settings");
      expect(settings).toHaveTextContent("Settings");
      // Below the module list, never inside it; inside the one Modules landmark.
      const list = screen.getByTestId("portal-sidebar-list");
      expect(list.contains(settings)).toBe(false);
      expect(list.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByRole("navigation", { name: "Modules" }).contains(settings)).toBe(true);
      // ...and no module grows a Settings page of its own.
      expect(screen.queryByTestId("nav-child-purchasing-settings")).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("principal — the same one row, to Houzs's Settings or to Finance Settings where she stands", () => {
    mockRole = "principal";
    const view = renderAt("/operation/sc/purchase-orders");
    expect(screen.getByTestId("nav-settings")).toHaveAttribute("href", "/operation/sc/settings");
    view.unmount();
    renderAt("/finance/dashboard");
    expect(screen.getByTestId("nav-settings")).toHaveAttribute("href", "/finance/settings");
  });

  /* Owner 14 Nov 2026: no separate "Report a problem to IT" row; IT Support sits in the SYSTEM group. */
  it("has no Report a problem to IT row at the bottom", () => {
    for (const [role, path] of [["operation", "/operation"], ["principal", "/finance/dashboard"], ["hr", "/operation/sc/hub-team"], ["finance", "/finance/dashboard"]] as const) {
      mockRole = role;
      const view = renderAt(path);
      expect(screen.queryByTestId("nav-report-problem"), role).toBeNull();
      view.unmount();
    }
  });

  it("finance has Finance Settings; hr has no Settings page, so no row", () => {
    mockRole = "finance";
    const view = renderAt("/finance/dashboard");
    expect(screen.getByTestId("nav-settings")).toHaveAttribute("href", "/finance/settings");
    view.unmount();
    mockRole = "hr";
    renderAt("/operation/sc/hub-team");
    expect(screen.queryByTestId("nav-settings")).not.toBeInTheDocument();
  });

  it("collapsed, the Settings row keeps its icon and its name for a screen reader", () => {
    localStorage.setItem(COLLAPSE_KEY, "1");
    renderAt("/operation");
    const settings = screen.getByTestId("nav-settings");
    expect(settings).toHaveAttribute("aria-label", "Settings");
    expect(settings.querySelector(MICON)).not.toBeNull();
  });
});


it("Houzs's Settings does not select a menu row or restore a permanent Staff & Duties menu row", () => {
  renderAt("/operation/sc/settings");
  expect(child("orders-shortcut")).not.toHaveClass(SELECTED);
  expect(child("work")).not.toHaveClass(SELECTED);
  expect(screen.queryByTestId("nav-child-staff-duties")).toBeNull();
  // The one selected row is Settings itself.
  expect(screen.getByTestId("nav-settings")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("nav-settings").className).toContain(SELECTED);
  // No module or page in the list is selected with it.
  expect(screen.getByTestId("portal-sidebar-list").querySelectorAll("[aria-current='page']")).toHaveLength(0);
  expect(document.querySelectorAll("[aria-current='page']")).toHaveLength(1);
});


describe("the menu frame (01 §4)", () => {
  it("the whole menu is the one Modules landmark and carries the right hairline", () => {
    renderAt("/operation");
    const menu = screen.getByRole("navigation", { name: "Modules" });
    expect(menu).toBe(screen.getByTestId("portal-sidebar"));
    expect(menu.className).toContain("border-r");
    expect(menu.className).toContain("border-c-head-line");
    expect(screen.getAllByRole("navigation", { name: "Modules" })).toHaveLength(1);
  });

  it("only the list scrolls: one scroller for the whole menu", () => {
    renderAt("/operation/sc/purchase-orders");
    const scrollers = Array.from(screen.getByTestId("portal-sidebar").querySelectorAll<HTMLElement>("*"))
      .filter((el) => /overflow-y-auto|overflow-auto|overflow-y-scroll/.test(el.className));
    expect(scrollers).toEqual([screen.getByTestId("portal-sidebar-list")]);
  });
});

// Detail auto-fit is temporary; lists keep the person's saved menu choice.
describe("PortalSidebar — Sales Order detail fit", () => {
  it("uses 64px below 1100 and restores the named menu on return", () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1025 });
    function ReturnToList() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/operation/orders")}>Return to list</button>;
    }
    try {
      render(<MemoryRouter initialEntries={["/operation/orders/so/test-order"]}>
        <PortalSidebar /><ReturnToList />
      </MemoryRouter>);
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
      expect(localStorage.getItem(COLLAPSE_KEY)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Expand menu" }));
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "220px" });
      expect(localStorage.getItem(COLLAPSE_KEY)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Return to list" }));
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "220px" });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  });
});

describe("PortalSidebar — common Tasks canvas fit", () => {
  it("temporarily compacts a narrow list and delegates expansion without changing the saved preference", () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1025 });
    const expand = vi.fn();
    try {
      render(<MemoryRouter initialEntries={["/operation/sc/purchase-orders"]}>
        <PortalSidebar compactForCanvas onExpandForCanvas={expand} />
      </MemoryRouter>);
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
      expect(localStorage.getItem(COLLAPSE_KEY)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Expand menu" }));
      expect(expand).toHaveBeenCalledOnce();
      // The shared host may still be asking whether to keep an unsaved task.
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
      expect(localStorage.getItem(COLLAPSE_KEY)).toBeNull();
      // Once the host lets it through, the same sidebar opens in place, for now only.
      act(() => expand.mock.calls[0][0]());
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "220px" });
      expect(localStorage.getItem(COLLAPSE_KEY)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Collapse menu" }));
      expect(expand).toHaveBeenCalledOnce();
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  });

  it("once opened, stays open while the person clicks from page to page (owner, 9 Nov 2026)", () => {
    const expand = vi.fn((open: () => void) => open());
    // As in App.tsx: the route boundary is keyed on the path, so every page change re-mounts the sidebar.
    function Keyed() {
      const { pathname } = useLocation();
      return <div key={pathname}><PortalSidebar compactForCanvas onExpandForCanvas={expand} /></div>;
    }
    render(<MemoryRouter initialEntries={["/operation/sc/purchase-orders"]}><Keyed /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Expand menu" }));
    expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "220px" });
    fireEvent.click(screen.getAllByRole("link", { name: "Sales Orders" })[0]); // /operation/sc/orders: a new path
    expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "220px" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse menu" }));
    expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
  });

  it("stays 64 by default at 1280 too (MASTER 4: 64px compact navigation)", () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    try {
      render(<MemoryRouter initialEntries={["/operation/sc/purchase-orders"]}>
        <PortalSidebar compactForCanvas onExpandForCanvas={vi.fn()} />
      </MemoryRouter>);
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  });
});

describe("PortalSidebar — owner17Oct temporary module rail", () => {
  it("keeps a module detail64 without changing preference or hiding another panel", () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1025 });
    localStorage.setItem(COLLAPSE_KEY, "0");
    try {
      render(<MemoryRouter initialEntries={["/operation/orders/so/test-order"]}><PortalSidebar compactForCanvas /></MemoryRouter>);
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
      expect(screen.getByRole("button", { name: "Expand menu" })).toBeEnabled();
      expect(localStorage.getItem(COLLAPSE_KEY)).toBe("0");
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1164 });
      fireEvent(window, new Event("resize"));
      expect(screen.getByTestId("portal-sidebar")).toHaveStyle({ width: "64px" });
      expect(localStorage.getItem(COLLAPSE_KEY)).toBe("0");
    } finally { Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth }); }
  });
});

/* Whole segments: an engine row whose address starts another row's address never lights both. */
describe("one lit row on engine addresses that share a prefix", () => {
  it.each([
    ["/operation/sc/stock-adjustments", "stock-adjustments", "stock"],
    ["/operation/sc/stock-takes", "stock-takes", "stock"],
    ["/operation/sc/delivery-planning-driver", "delivery-planning-driver", "delivery-planning"],
  ])("%s lights %s, not %s", (path, on, off) => {
    renderAt(path);
    expect(child(on).className).toContain(SELECTED);
    expect(child(off).className).not.toContain(SELECTED);
  });
});

/* ⭐ HOUZS FINANCE (owner, 11 Nov 2026; Houzs Sidebar.tsx:736-873): one Finance row after Supply Chain, the old
   Carres Finance at the very bottom as "Finance (old)". */
describe("PortalSidebar — Houzs Finance", () => {
  it("the Finance row opens Finance's To do, as Houzs's row does", () => {
    renderAt("/operation");
    fireEvent.click(screen.getByTestId("nav-fold-finance"));
    expect(screen.getByTestId("location-probe")).toHaveTextContent(/^\/operation\/sc\/fin-todo$/);
  });

  it("on a Finance page its group is open and the page wears Houzs's icon", () => {
    renderAt("/operation/sc/fin-receipts");
    expect(screen.getByTestId("nav-fold-finance")).toHaveAttribute("aria-expanded", "true");
    expect(module_("finance-money-in")).toHaveAttribute("aria-expanded", "true");
    expect(child("fin-receipts")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("houzs-icon-fin-receipts")).toBeInTheDocument();
    const rows = within(screen.getByTestId("nav-children-finance-money-in")).getAllByRole("link");
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["Receipts", "Invoices", "Debtor maintenance", "Credit / debit notes", "Outstanding", "Not yet billed"]);
  });

  it("the principal sees the old Carres Finance last, as Finance (old)", () => {
    mockRole = "principal";
    renderAt("/operation");
    const areas = Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='nav-area-']")).map((el) => el.dataset.testid);
    expect(areas).toEqual(["nav-area-principal", "nav-area-finance"]);
    expect(screen.getByTestId("nav-area-finance")).toHaveTextContent("Finance (old)");
  });

  it("finance sees the Houzs Finance row and its own old Finance, and its home is still its Finance area", () => {
    mockRole = "finance";
    renderAt("/finance/dashboard");
    expect(screen.getByTestId("nav-fold-finance")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-fold-supply-chain")).toBeNull();
    expect(screen.getByTitle("Carres home")).toHaveAttribute("href", "/finance/dashboard");
  });
});
