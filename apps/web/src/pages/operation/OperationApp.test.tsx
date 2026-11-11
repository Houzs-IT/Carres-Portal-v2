import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * The Operations shell after 11 Nov 2026: Service Cases, Projects and Supply Chain are the engine's pages at
 * `/operation/sc/<row>`; the old Carres pages of those areas are removed and their addresses move to the nearest
 * engine row; Carres's own pages (Workspace, Leave, Subscription, Issue Tracker, Settings) still mount here.
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
vi.mock("./SettingsWorkspace", () => ({
  default: () => <div data-testid="settings-stub">Settings</div>,
  settingsSectionLabel: (path: string) => (path.includes("staff-duties") ? "Staff & Duties" : null),
}));
vi.mock("./tasks/WorkspaceTasks", () => ({ default: () => <div data-testid="work-stub">work</div> }));
vi.mock("./OperationLeave", () => ({ default: () => <div data-testid="leave-stub">leave</div> }));
vi.mock("./OperationRental", () => ({ default: () => <div data-testid="rental-stub">rental</div> }));
vi.mock("./OperationIssueTracker", () => ({ default: () => <div data-testid="issues-stub">issues</div> }));
vi.mock("./IssueRelatedPartyReport", () => ({ default: () => <div data-testid="issue-report-stub">report</div> }));
vi.mock("./DocumentLinesReport", () => ({ SalesInvoiceLinesReport: () => <div data-testid="si-lines-stub">lines</div> }));

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
    ["/operation/settings/service", "/operation/sc/service-maintenance"],
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
    ["/operation?tab=sales-invoice-lines", "si-lines-stub"],
    ["/operation/issues", "issues-stub"],
    ["/operation/issues/reports", "issue-report-stub"],
    ["/operation/settings/staff-duties", "settings-stub"],
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
