/**
 * AI CONNECTOR PREVIEW — DEV ONLY (walk aid for System › AI Connector, owner 25 Nov 2026).
 *
 * Same contract as every `src/dev/*-preview.tsx` entry: the REAL Operations shell and AI Connector page, the REAL
 * stylesheet, only the session seeded and the API answered by a fixture. A separate vite entry: it cannot reach
 * production. `?role=operation&access=0` walks a staff member without access; `?role=operation` one with access;
 * the default is the principal's overview. `/ai-connect?request=x` walks the "Allow?" screen
 * (`&allowed=0` without access).
 */
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import OperationApp from "@/pages/operation/OperationApp";
import AiConnect from "@/pages/AiConnect";
import "@/index.css";

const q = new URLSearchParams(window.location.search);
const ROLE = q.get("role") ?? "principal";
const ACCESS = q.get("access") !== "0";
useAuth.setState({ role: ROLE as never, user: { email: `${ROLE}@carres.co` } as never, hydrated: true } as never);

const URL_ = "https://api.carresofficial.com/api/mcp";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ME = {
  allowed: ROLE === "principal" || ACCESS,
  eligible: true,
  isAdmin: ROLE === "principal",
  pendingRequest: null,
  connectorUrl: URL_,
  apps: ACCESS ? [{ tokenId: "mcpt_1", app: "Claude", connectedAt: ago(60 * 26), lastUsedAt: ago(4) }] : [],
};
const OVERVIEW = {
  connectorUrl: URL_,
  stats: { connectedPeople: 2, callsToday: 37, refusedToday: 3, waiting: 2 },
  requests: [
    { id: "mcpr_1", userId: "u1", name: "Nurul Ain binti Ismail", role: "operation", title: "Delivery coordinator", reason: "Connecting Claude", createdAt: ago(35) },
    { id: "mcpr_2", userId: "u2", name: "Tan Wei Ming", role: "bd", title: "", reason: "", createdAt: ago(60 * 5) },
  ],
  connected: [
    { tokenId: "mcpt_2", userId: "u3", name: "Chew Li Ying", role: "finance", title: "Accounts", app: "ChatGPT", connectedAt: ago(60 * 48), lastUsedAt: ago(12) },
    { tokenId: "mcpt_3", userId: "u4", name: "Muhammad Hafizuddin bin Abdul Rahman", role: "operation", title: "", app: "Claude", connectedAt: ago(60 * 72), lastUsedAt: null },
  ],
  allowed: [
    { userId: "u3", name: "Chew Li Ying", role: "finance", title: "Accounts", approvedAt: ago(60 * 50) },
    { userId: "u4", name: "Muhammad Hafizuddin bin Abdul Rahman", role: "operation", title: "", approvedAt: ago(60 * 80) },
  ],
  calls: Array.from({ length: 8 }, (_, i) => ({
    id: `mcpl_${i}`, userId: "u3", name: i % 3 ? "Chew Li Ying" : "Muhammad Hafizuddin bin Abdul Rahman", role: "finance", title: "",
    app: i % 3 ? "ChatGPT" : "Claude", tool: i % 4 === 0 ? "list_modules" : "erp_get",
    target: i % 4 === 0 ? "" : ["/api/orders?from=2026-11-01&to=2026-11-25", "/api/finance/payments", "/api/operation/delivery-orders?limit=20"][i % 3],
    status: i === 2 ? 403 : 200, ok: i !== 2, note: i === 2 ? "no permission" : "", ms: 120 + i * 7, at: ago(i * 9 + 2),
  })),
  staff: [
    { userId: "u5", name: "Lim Siew Peng", role: "hr", title: "" },
    { userId: "u6", name: "Ahmad Faiz", role: "operation", title: "Warehouse" },
  ],
};
const LEAK_PATHS = ["/api/orders", "/api/catalog", "/api/finance/payments", "/api/operation/orders", "/api/rental/config"];

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.includes("/api/mcp-admin/me")) return json(ME);
  if (url.includes("/api/mcp-admin/admin/overview")) return json(OVERVIEW);
  if (url.includes("/api/mcp-admin/admin/leak-check")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { offset?: number };
    const offset = body.offset ?? 0;
    const page = LEAK_PATHS.slice(offset, offset + 2);
    return json({
      total: LEAK_PATHS.length, offset, next: offset + page.length, done: offset + page.length >= LEAK_PATHS.length,
      rows: page.map((path) => path.includes("finance") || path.includes("rental")
        ? { path, outcome: "refused", status: 403, hidden: [], sensitive: [] }
        : { path, outcome: "opened", status: 200, hidden: [], sensitive: path === "/api/operation/orders" ? ["costTotal", "supplierName"] : [] }),
    });
  }
  if (url.includes("/api/mcp-admin/consent/")) {
    if (init?.method === "POST") return json({ redirect: "https://claude.ai/api/mcp/auth_callback?code=preview" });
    return json({ app: "Claude", clientName: "Claude", redirectHost: "claude.ai", user: { name: "Chew Li Ying", email: "chew@carres.co" }, eligible: true, allowed: q.get("allowed") !== "0" });
  }
  if (url.includes("/api/mcp-admin/")) return json({ ok: true });
  if (url.includes("/api/")) return json({}, 404);
  return realFetch(input, init);
};

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
if (window.location.pathname === "/" || window.location.pathname.endsWith(".html")) window.history.replaceState(null, "", `/operation/ai-connector${window.location.search}`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/operation/*" element={<OperationApp />} />
          <Route path="/ai-connect" element={<Suspense fallback={null}><AiConnect /></Suspense>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
