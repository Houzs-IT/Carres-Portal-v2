import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { useAuth } from "@/lib/auth";
import { useWorkActivity } from "@/lib/use-work-activity";
import { useProfileAppearance } from "@/lib/appearance";
import { useCompanyIdentitySync } from "@/lib/company-identity";
import { RequireRole } from "@/lib/require-role";
import { loginState } from "@/lib/return-to";
import { roleAllowedOnPortal } from "@/lib/portal";
import WrongPortal, { PortalMoved } from "@/components/WrongPortal";
import ErrorBoundary from "@/components/ErrorBoundary";
import Login from "@/pages/Login";
import UpdatePassword from "@/pages/UpdatePassword";
import Me from "@/pages/Me";
import DealerApp from "@/pages/dealer/DealerApp";
import PrincipalApp from "@/pages/principal/PrincipalApp";
import OperationApp from "@/pages/operation/OperationApp";
import FinanceApp from "@/pages/finance/FinanceApp";
import BDApp from "@/pages/bd/BDApp";
import { retiredRedirect } from "@/pages/portal/portal-nav";
import PickupEventPrintPage from "@/pages/print/PickupEventPrintPage";
import { PayCancelled, PaySuccess } from "@/pages/pay/PayResult";

/* `/ui` — UI-KIT's third body (card D0.5a). LAZY on purpose: it is a kit
 * reference, not a portal page, so it must not ride the main bundle that every
 * operator downloads (CF `phase-10-bundle-size-regression`). */
const UiShowcase = lazy(() => import("@/pages/dev/UiShowcase"));
/* 0581 — the external logistics link: public, lazy, its own chunk. */
const DeliveryLinkPage = lazy(() => import("@/pages/public/DeliveryLinkPage"));

function HomeRedirect() {
  const location = useLocation();
  const session = useAuth((s) => s.session);
  const role = useAuth((s) => s.role);
  const hydrated = useAuth((s) => s.hydrated);
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-body text-muted-foreground">Loading…</p>
      </div>
    );
  }
  // Both guards remember the same thing the same way — see lib/return-to.ts.
  if (!session) return <Navigate to="/login" state={loginState(location)} replace />;
  // POS/ERP domain split (2026-07-18): wrong-domain roles get the signpost
  // before any role-home navigation. pages.dev/localhost stay ungated.
  if (role && !roleAllowedOnPortal(role)) return <WrongPortal role={role} />;
  if (role === "principal") return <Navigate to="/principal" replace />;
  if (role === "operation") return <Navigate to="/operation" replace />;
  if (role === "finance") return <Navigate to="/finance" replace />;
  // The supplier, warehouse and delivery partner portals moved to Houzs (owner, 12 Nov 2026): no app here.
  if (role === "partner" || role === "supplier" || role === "warehouse") return <PortalMoved />;
  if (role === "bd") return <Navigate to="/bd" replace />;
  // The Carres HR area is removed (owner, 11 Nov 2026): HR staff open Houzs's Team, in Operations.
  if (role === "hr") return <Navigate to="/operation/sc/hub-team" replace />;
  if (role === "dealer" || role === "salesperson" || role === "showroom") return <Navigate to="/dealer" replace />;
  return <Navigate to="/me" replace />;
}

/** An old HR address: the Team hub (portal-nav retiredRedirect). */
function HrRetired() {
  const location = useLocation();
  return <Navigate to={retiredRedirect(location.pathname, location.search) ?? "/operation/sc/hub-team"} replace />;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useAuth((s) => s.session);
  const hydrated = useAuth((s) => s.hydrated);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-body text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!session) {
    // Path + query + hash, so a document-number deep link survives the login.
    return <Navigate to="/login" state={loginState(location)} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  useWorkActivity();
  /* Each person's own theme and focus outline (handoff v4, UI Kit §9). */
  useProfileAppearance();
  /* The company identity every printed document carries (Settings → Company). */
  useCompanyIdentitySync();
  const hydrate = useAuth((s) => s.hydrate);
  const location = useLocation();
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <>
      {/* Route-level net. Keyed on pathname so navigating AWAY from a page that
          crashed clears the error — otherwise the operator would be stuck on
          the failure screen until a full reload. The root boundary in main.tsx
          still backs this up. */}
      <ErrorBoundary key={location.pathname} area="Carres Portal" variant="route">
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Step 02 of recovery — the destination the reset email has always
            named. NOT behind RequireAuth: an expired link leaves no session,
            and the guard would bounce that person to /login with no word about
            why, which is the silent dead end this route exists to end. The page
            checks the session itself and says which case it is. */}
        <Route path="/update-password" element={<UpdatePassword />} />
        <Route path="/me" element={<RequireAuth><Me /></RequireAuth>} />
        <Route
          path="/dealer/*"
          element={
            <RequireAuth>
              <RequireRole roles={["dealer", "salesperson", "showroom"]}>
                <DealerApp />
              </RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/principal/*"
          element={
            <RequireAuth>
              <RequireRole roles={["principal"]}>
                <PrincipalApp />
              </RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/operation/*"
          element={
            <RequireAuth>
              {/* Unified Internal Portal (2026-06-30) — principal admitted
                  alongside operation so the merged PortalSidebar's Operations
                  area is reachable by the boss. DB twin: migration 0189 widens
                  is_operation(); API twin: requireOperation admits principal. */}
              {/* `hr` for the System rows only (Team, Mail Center, IT Support; owner 11 Nov 2026):
                  OperationApp sends it to the Team hub from every other address. */}
              {/* `finance` for the Houzs Finance rows only (owner 11 Nov 2026). */}
              <RequireRole roles={["operation", "principal", "hr", "finance"]}>
                <OperationApp />
              </RequireRole>
            </RequireAuth>
          }
        />
        <Route
          path="/finance/*"
          element={
            <RequireAuth>
              {/* Payment MASTER §12 — the Responsible Delivery Operation
                  (role: operation) do daily collection, so the Payments and
                  Invoices destinations must open for them. FinanceApp itself
                  bounces operation off the finance-only pages. HR and BD reach
                  Payment Requests only (0687, Chew 2026-10-12, Finance MASTER
                  §3.3); FinanceApp sends them nowhere else. */}
              <RequireRole roles={["finance", "principal", "operation", "hr", "bd"]}>
                <FinanceApp />
              </RequireRole>
            </RequireAuth>
          }
        />
        {/* The supplier (`/supplier/*`), warehouse (`/warehouse/*`) and delivery partner (`/delivery-partner/*`)
            portals were removed on 12 Nov 2026 (owner: Houzs has its own pages for outside parties). Their old
            addresses fall to HomeRedirect, which shows those roles "This portal moved". */}
        <Route
          path="/bd/*"
          element={
            <RequireAuth>
              <RequireRole roles={["bd"]}>
                <BDApp />
              </RequireRole>
            </RequireAuth>
          }
        />
        {/* The Carres HR area is removed (owner, 11 Nov 2026): its old addresses open Houzs's Team. */}
        <Route path="/hr/*" element={<HrRetired />} />
        {/* Task 13 (2026-05-15) — pickup-event DO reprint landing.
         *  Role-agnostic URL pattern; the server endpoint
         *  (`/api/pickup-events/:id/print`) gates per-role via RLS. */}
        <Route
          path="/print/pickup-event/:eventId"
          element={
            <RequireAuth>
              <PickupEventPrintPage />
            </RequireAuth>
          }
        />
        {/* The run sheet, service case and service note print pages were removed on 12 Nov 2026 (owner):
            Houzs's engine prints its own. */}
        {/* 0223 — Stripe Checkout landings. PUBLIC on purpose: the CUSTOMER's
         *  browser arrives here after paying; there is no session and nothing
         *  sensitive on the page. */}
        {/* `/ui` — the kit showcase (UI-KIT §13.4 screenshots it in CI).
         *  PUBLIC on purpose: it renders components and tokens, reads no
         *  session and fetches no row, and CI has no login. */}
        <Route
          path="/ui"
          element={
            <Suspense fallback={<div className="p-8 text-body text-kit-slate-11">Loading…</div>}>
              <UiShowcase />
            </Suspense>
          }
        />
        {/* 0581 — a logistics company with no portal login answers here.
            NOT behind RequireAuth: the link's token is the whole boundary. */}
        {/* `/survey/:token` was removed on 12 Nov 2026 (owner): Houzs's engine serves its own survey page. */}
        <Route
          path="/delivery-link/:token"
          element={
            <Suspense fallback={<div className="p-4 text-body text-kit-slate-11">Loading…</div>}>
              <DeliveryLinkPage />
            </Suspense>
          }
        />
        <Route path="/pay/success" element={<PaySuccess />} />
        <Route path="/pay/cancelled" element={<PayCancelled />} />
        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
      </ErrorBoundary>
      {/* Global toast surface — top-right per dealer-portal convention.
       *  rich-colors uses sonner's theme classes so success / error / warning
       *  pick up our --success / --warning / --destructive tokens via the
       *  default Tailwind cascade. closeButton lets dealers dismiss long
       *  messages (e.g. server validation errors) before auto-fade. */}
      <Toaster position="top-right" richColors closeButton />
    </>
  );
}
