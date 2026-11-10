import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import PhoneTasksDoor from "./components/rail/PhoneTasksDoor";
import PendingWorkReminder from "./tasks/PendingWorkReminder";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
// Unified Internal Portal (2026-06-30) — the three private rails (Operation /
// Principal / Finance) merged into ONE role-aware PortalSidebar.
import PortalSidebar from "@/pages/portal/PortalSidebar";
import { useAuth } from "@/lib/auth";
import SettingsWorkspace, { settingsSectionLabel } from "./SettingsWorkspace";
import WorkspaceTasks from "./tasks/WorkspaceTasks";
import OperationLeave from "./OperationLeave";
import OperationRental from "./OperationRental";
import SupplyChainEngine from "./SupplyChainEngine";
import { SalesInvoiceLinesReport } from "./DocumentLinesReport";
import OperationIssueTracker from "./OperationIssueTracker";
import IssueRelatedPartyReport from "./IssueRelatedPartyReport";
import { CATALOG_TAB_PARAM } from "@/pages/catalog/catalog-tabs";
import ShellHeader, { ShellHeaderContext, useShellHeaderHost } from "./components/ShellHeader";
import ShellTasks, { useShellTasks } from "./components/ShellTasks";
import { useTasksHost } from "./tasks/tasks-host";
import { activeNavTitle, engineFor, retiredRedirect } from "@/pages/portal/portal-nav";

/**
 * The Operations shell: the menu, one header over the page and the Tasks panel.
 *
 * Service Cases, Projects and Supply Chain are Houzs's own screens, run by the engine (engine/) and shown here
 * in a frame: every such menu row has its own `/operation/sc/<row>` address (portal-nav ENGINE_PAGES). The Carres
 * pages those areas used to have were removed on 11 Nov 2026 (owner: the Houzs pages are the system); their
 * old addresses move to the nearest engine row (portal-nav retiredRedirect). What stays here is Carres's own:
 * Workspace, Leave, Subscription, the Issue Tracker, the Sales invoice lines report and Settings.
 */
export default function OperationApp() {
  const location = useLocation();
  const phone = usePhone();
  const shellHost = useShellHeaderHost();
  const [menuOpen, setMenuOpen] = useState(false);
  /* A chosen page closes the drawer. */
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);
  const role = useAuth((s) => s.role);
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");

  const enginePage = engineFor(location.pathname, location.search);
  const retired = enginePage ? null : retiredRedirect(location.pathname, location.search);
  const isSettingsUrl = location.pathname.startsWith("/operation/settings");
  const isIssuesUrl = location.pathname.startsWith("/operation/issues");

  const navTitle = isSettingsUrl
    ? { crumb: "Settings", title: settingsSectionLabel(location.pathname) ?? "Settings" }
    : activeNavTitle(location.pathname, location.search);
  if (retired) return <Navigate to={retired} replace />;

  /* The page for a tab-driven Carres row. The retired Payments desk and the staff-duties bookmark forward to
     their one home; a principal's stale `?tab=catalog` goes to the selling catalog in Admin. */
  function tabPage() {
    switch (tab) {
      case "work": return <WorkspaceTasks />;
      case "leave": return <OperationLeave />;
      case "rental": return <OperationRental />;
      case "sales-invoice-lines": return <SalesInvoiceLinesReport />;
      case "payments": {
        const so = searchParams.get("so");
        return <Navigate to={`/finance/monitor${so ? `?order=${encodeURIComponent(so)}` : ""}`} replace />;
      }
      case "staff-duties":
        return <Navigate replace state={location.state} to={`/operation/settings/staff-duties?${new URLSearchParams([...searchParams].filter(([key]) => key !== "tab"))}`} />;
      case "catalog": {
        if (role !== "principal") return <Navigate to="/operation/sc/op-catalog" replace />;
        const section = searchParams.get(CATALOG_TAB_PARAM);
        return <Navigate to={`/principal?tab=catalog${section ? `&${CATALOG_TAB_PARAM}=${encodeURIComponent(section)}` : ""}`} replace />;
      }
      default:
        return <Navigate to="/operation/sc/orders" replace />;
    }
  }

  return (
    <div
      className="grid h-screen bg-background text-c-body"
      style={{ gridTemplateColumns: phone ? "minmax(0, 1fr)" : "auto minmax(0, 1fr)" }}
    >
      {phone ? (
        <>
          {menuOpen ? (
            <button
              type="button"
              aria-label="Close menu"
              data-testid="phone-menu-backdrop"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-40 bg-base-900/40"
            />
          ) : null}
          <div
            data-testid="phone-menu"
            aria-hidden={!menuOpen}
            className={`fixed inset-y-0 left-0 z-50 shadow-lg transition-transform duration-[180ms] motion-reduce:transition-none ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}
          >
            <PortalSidebar drawer />
          </div>
        </>
      ) : (
        <PortalSidebar compactForCanvas
          onExpandForCanvas={(expand) => useTasksHost.getState().guard(() => {
            useShellTasks.getState().setOpen(false);
            expand();
          })} />
      )}
      <ShellHeaderContext.Provider value={shellHost.value}>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {phone ? (
          <div className="flex h-11 shrink-0 items-center border-b border-c-line bg-white px-2">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              data-testid="phone-menu-button"
              className="inline-flex h-9 items-center gap-2 rounded-control px-2 text-control text-c-ink hover:bg-c-hover"
            >
              <Menu size={18} />
              Menu
            </button>
            <div className="ml-auto flex items-center gap-1">
              {/* The phone shell has no Tasks card; `Tasks` opens the same Tasks list in a Drawer. */}
              <PhoneTasksDoor />
            </div>
          </div>
        ) : (
          <ShellHeader
            slotRef={shellHost.slotRef}
            claimed={shellHost.claimed}
            crumb={navTitle?.crumb}
            title={navTitle?.title ?? "Carres"}
          />
        )}
        <div className={`flex min-h-0 min-w-0 flex-1 ${phone ? "" : "gap-3 p-3"}`}>
        <main className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-auto ${phone ? "" : "rounded-lg"}`}>
          {enginePage ? (
            <SupplyChainEngine path={enginePage} />
          ) : isSettingsUrl || isIssuesUrl ? (
            // Relative paths: this is a descendant <Routes> inside App.tsx's `/operation/*`.
            <Routes>
              <Route path="settings/*" element={<SettingsWorkspace />} />
              <Route path="issues" element={<OperationIssueTracker />} />
              <Route path="issues/reports" element={<IssueRelatedPartyReport />} />
            </Routes>
          ) : (
            tabPage()
          )}
        </main>
        {phone ? null : <ShellTasks />}
        </div>
      </div>
      </ShellHeaderContext.Provider>
      {/* The first-entry `Pending work` reminder (owner direction 2026-10-05). */}
      <PendingWorkReminder />
    </div>
  );
}

/** Below 768px the shell is the phone shell (owner review 2026-09-25). */
function usePhone(): boolean {
  const query = "(max-width: 767px)";
  const [phone, setPhone] = useState<boolean>(() => {
    try {
      return window.matchMedia?.(query).matches === true;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return phone;
}
