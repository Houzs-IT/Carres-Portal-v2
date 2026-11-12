import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * The Operations shell after 11 Nov 2026: Service Cases, Projects and Supply Chain are the engine's pages at
 * `/operation/sc/<row>`; the old Carres pages of those areas are removed and their addresses move to the nearest
 * engine row; Carres's own pages (Workspace, Leave, Subscription) still mount here. The Issue Tracker, the Sales
 * invoice lines report, the Settings workspace and the HR area are removed (owner, 11 Nov 2026); `hr` opens
 * the System rows only.
 * Children are stubbed: this suite owns routing only.
 */
vi.mock("./SupplyChainEngine", () => ({
  default: ({ path }: { path: string }) => <div data-testid="engine-stub" data-path={path}>engine</div>,
}));
vi.mock("@/pages/portal/PortalSidebar", () => ({ default: () => <div data-testid="sidebar-stub">sidebar</div> }));
vi.mock("./components/ShellTasks", () => ({
  default: () => <div data-testid="shell-tasks-stub">tasks</div>,
  TasksPill: () => null,
  useShellTasks: (select: (state: { open: boolean; pageHosts: number }) => unknown) => select({ open: false, pageHosts: 0 }),
}));
vi.mock("./tasks/PendingWorkReminder", () => ({ default: () => null }));
vi.mock("./components/GlobalTopBar", () => ({
  default: () => <div data-testid="global-topbar-stub">topbar</div>,
  TopBarIcons: () => <div data-testid="topbar-icons-stub">icons</div>,
}));
vi.mock("./tasks/WorkspaceTasks", () => ({ default: () => <div data-testid="work-stub">work</div> }));
vi.mock("./OperationLeave", () => ({ default: () => <div data-testid="leave-stub">leave</div> }));
vi.mock("./OperationRental", () => ({ default: () => <div data-testid="rental-stub">rental</div> }));
import { useAuth } from "@/lib/auth";
import OperationApp from "./OperationApp";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{location.pathname}{location.search}</output>;
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/operation/*" element={<OperationApp />} />
        <Route path="/finance/*" element={<div data-testid="finance-stub">finance</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const at = () => screen.getByTestId("location-probe").textContent;

beforeEach(() => useAuth.setState({ role: "operation" as never }));

describe("OperationApp — the engine rows", () => {
  it.each([
    ["/operation/sc/orders", "/scm/sales-orders"],
    ["/operation/sc/purchase-orders", "/scm/purchase-orders"],
    ["/operation/sc/projects", "/projects?view=list"],
    ["/operation/sc/service-notes", "/assr?view=cases"],
    ["/operation/sc/consignment-receives", "/scm/purchase-consignment-receives"],
  ])("%s opens the engine page %s", (path, page) => {
    renderApp(path);
    expect(screen.getByTestId("engine-stub")).toHaveAttribute("data-path", page);
    // Houzs's own top bar is the one top row there: the Carres header and Tasks card stand down.
    expect(screen.queryByTestId("shell-header")).toBeNull();
    expect(screen.queryByTestId("shell-tasks-stub")).toBeNull();
  });
});

describe("OperationApp — retired Carres addresses move to the nearest engine row", () => {
  it.each([
    ["/operation", "/operation/sc/orders"],
    ["/operation?tab=dashboard", "/operation/sc/orders"],
    ["/operation/procurement", "/operation/sc/purchase-orders"],
    ["/operation/orders/so/abc", "/operation/sc/orders"],
    ["/operation/delivery-orders/DO-1", "/operation/sc/delivery-orders"],
    ["/operation?tab=claims", "/operation/sc/purchase-returns"],
    ["/operation?tab=guarantees", "/operation/sc/service-notes"],
    ["/operation?tab=projects", "/operation/sc/projects"],
    ["/operation?tab=warehouse-inbound", "/operation/sc/receiving"],
    // The Carres Settings workspace is removed: every Settings address opens Houzs's own Settings.
    ["/operation/settings/service", "/operation/sc/settings"],
    ["/operation/settings/staff-duties", "/operation/sc/settings"],
    ["/operation/settings", "/operation/sc/settings"],
    ["/operation?tab=staff-duties", "/operation/sc/settings"],
    // The Carres Issue Tracker and the Sales invoice lines report are removed: Sales Orders.
    ["/operation/issues", "/operation/sc/orders"],
    ["/operation/issues/reports", "/operation/sc/orders"],
    ["/operation?tab=sales-invoice-lines", "/operation/sc/orders"],
  ])("%s → %s", (from, to) => {
    renderApp(from);
    expect(at()).toBe(to);
    expect(screen.getByTestId("engine-stub")).toBeInTheDocument();
  });
});

describe("OperationApp — Carres's own pages stay", () => {
  it.each([
    ["/operation?tab=work", "work-stub"],
    ["/operation?tab=leave", "leave-stub"],
    ["/operation?tab=rental", "rental-stub"],
  ])("%s mounts its page", (path, id) => {
    renderApp(path);
    expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.queryByTestId("engine-stub")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("shell-header")).toHaveLength(1);
    expect(screen.getByTestId("shell-tasks-stub")).toBeInTheDocument();
  });

  it("the retired Payments desk forwards to the Finance monitor with its order", () => {
    renderApp("/operation?tab=payments&so=SO-1");
    expect(at()).toBe("/finance/monitor?order=SO-1");
  });
});

describe("OperationApp — the System rows (owner, 11 Nov 2026)", () => {
  it.each([
    ["/operation/sc/hub-team", "/team?tab=hub"],
    ["/operation/sc/team-directory", "/team?tab=directory"],
    ["/operation/sc/team-org-chart", "/team?tab=orgchart2"],
    ["/operation/sc/team-departments", "/team?tab=departments2"],
    ["/operation/sc/team-mailboxes", "/team?tab=mail2"],
    ["/operation/sc/team-roles", "/team?tab=permissions"],
    ["/operation/sc/mail-center", "/mail-center"],
    ["/operation/sc/it-support", "/it-support"],
    ["/operation/sc/settings", "/settings"],
  ])("%s opens the engine page %s", (path, page) => {
    renderApp(path);
    expect(screen.getByTestId("engine-stub")).toHaveAttribute("data-path", page);
  });
});

describe("OperationApp — hr opens the System rows only", () => {
  beforeEach(() => useAuth.setState({ role: "hr" as never }));

  it.each(["/operation/sc/hub-team", "/operation/sc/team-directory", "/operation/sc/mail-center", "/operation/sc/it-support"])(
    "%s opens for hr",
    (path) => {
      renderApp(path);
      expect(at()).toBe(path);
      expect(screen.getByTestId("engine-stub")).toBeInTheDocument();
    },
  );

  it.each(["/operation", "/operation/sc/orders", "/operation/sc/hub-scm", "/operation/sc/settings", "/operation?tab=work", "/operation/settings/office"])(
    "%s sends hr to the Team hub",
    (path) => {
      renderApp(path);
      expect(at()).toBe("/operation/sc/hub-team");
      expect(screen.getByTestId("engine-stub")).toHaveAttribute("data-path", "/team?tab=hub");
    },
  );
});
