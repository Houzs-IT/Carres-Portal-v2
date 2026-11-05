/**
 * PROJECTS PREVIEW — DEV ONLY. The REAL Project List and detail (Houzs layout) on invented
 * projects: one running today, two starting within 30 days, one cancelled, one later.
 * Reads are answered here; every save is refused, so nothing reaches production.
 */
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { ProjectsPage } from "@/pages/operation/OperationProjects";
import PreviewFrame from "./preview-frame";
import "@/index.css";

useAuth.setState({ role: "operation", user: { email: "preview@carres.test" } as never });

const project = (id: string, over: Record<string, unknown>) => ({
  id, code: "", name: "", stage: "draft", status: "pending", eventType: "exhibition", brand: "Carres", state: "Selangor",
  venue: "Mid Valley Exhibition Centre", venueAddress: null, organizer: "HOMEDEC", contractor: null, boothNo: null, sizeSqm: null,
  startDate: "2026-11-20", endDate: "2026-11-23", picId: null, picName: "Shasha", notes: null, archivedAt: null, createdAt: "2026-10-01T00:00:00Z",
  ...over,
});
const projects = [
  project("p1", { code: "2026-11-HOMEDEC-SELANGOR-MID-VALLEY-CARRES", name: "SELANGOR [CARRES] HOMEDEC @ MID VALLEY", stage: "live", status: "confirmed",
    startDate: "2026-11-04", endDate: "2026-11-08", boothNo: "A-12", sizeSqm: 54, contractor: "Booth Pro", venueAddress: "Lingkaran Syed Putra, KL" }),
  project("p2", { code: "2026-11-IEC-JOHOR-PARADIGM-CARRES", name: "JOHOR [CARRES] IEC @ PARADIGM MALL", status: "confirmed", state: "Johor",
    venue: "Paradigm Mall", organizer: "IEC", startDate: "2026-11-20", endDate: "2026-11-23", picName: "Jess" }),
  project("p3", { code: "2026-12-SOLO-PENANG-SPICE-CARRES", name: "PENANG [CARRES] SOLO @ SPICE", eventType: "solo", organizer: null, state: "Penang",
    venue: "SPICE Convention Centre", startDate: "2026-12-01", endDate: "2026-12-03", picName: null }),
  project("p4", { code: "2026-11-HOMEDEC-PERAK-IPOH-CARRES", name: "PERAK [CARRES] HOMEDEC @ IPOH PARADE", status: "cancelled", state: "Perak",
    venue: "Ipoh Parade", startDate: "2026-11-15", endDate: "2026-11-17" }),
  project("p5", { code: "2027-02-HOMEDEC-SELANGOR-MID-VALLEY-CARRES", name: "SELANGOR [CARRES] HOMEDEC @ MID VALLEY (FEB)", startDate: "2027-02-12", endDate: "2027-02-15" }),
];
const checklist = [
  ["Booth", "Floor plan", -30, "done"], ["Booth", "3D design", -21, "done"], ["Booth", "Booth contractor booked", -14, "pending"],
  ["Stock", "Stock out to the fair", -2, "done"], ["Stock", "Stock back to warehouse", 5, "pending"],
  ["Payment", "Rental payment", -20, "done"], ["Payment", "Security deposit", -20, "na"],
].map(([section, title, dueOffsetDays, status], i) => ({ id: `t${i}`, section, seq: i, title, dueOffsetDays, status, notes: null,
  completedByName: status === "done" ? "Shasha" : null, completedAt: null }));
const detail = (id: string) => ({
  project: projects.find((p) => p.id === id) ?? projects[0],
  activity: [
    { id: "a2", action: "stage_change", fromValue: "setup", toValue: "live", note: null, byName: "Shasha", createdAt: "2026-11-04T01:00:00Z" },
    { id: "a1", action: "created", fromValue: null, toValue: null, note: null, byName: "Jess", createdAt: "2026-10-01T02:00:00Z" },
  ],
  team: [{ id: "m1", userId: "u1", name: "Shasha", role: "onsite" }, { id: "m2", userId: "u2", name: "Adrian", role: "sales" }],
  checklist,
  stockTransfers: [],
});
const orders = [
  { id: "o1", so: "SO-2611-0012", status: "confirmed", customerName: "Tan Mei Ling", placedAt: "2026-11-04T05:00:00Z", total: 4890, paid: 1000, balance: 3890 },
  { id: "o2", so: "SO-2611-0015", status: "confirmed", customerName: "Kumar", placedAt: "2026-11-05T03:00:00Z", total: 2390, paid: 2390, balance: 0 },
];
const ROUTES: Array<[RegExp, (m: RegExpMatchArray, q: URLSearchParams) => unknown]> = [
  [/\/projects\/masters$/, () => ({ masters: [{ id: "b1", kind: "brand", name: "Carres", state: null, address: null, notes: null, active: true }] })],
  [/\/projects\/checklist-templates$/, () => ({ templates: [] })],
  [/\/projects\/([^/?]+)\/sales-orders$/, () => ({ orders, totals: { count: 2, total: 7280, paid: 3390, balance: 3890 } })],
  [/\/projects\/([^/?]+)$/, (m) => detail(m[1])],
  [/\/projects$/, (_m, q) => ({ projects: projects.filter((p) => (!q.get("status") || q.get("status") === p.status) && (!q.get("brand") || q.get("brand") === p.brand)) })],
  [/\/staff$/, () => ({ staff: [{ user_id: "u1", name: "Shasha" }, { user_id: "u2", name: "Adrian" }] })],
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
  if (!url.pathname.includes("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (init?.method && init.method !== "GET") return json({ message: "Local preview does not save records." }, 405);
  for (const [re, answer] of ROUTES) {
    const m = url.pathname.match(re);
    if (m) return json(answer(m, url.searchParams));
  }
  return json({});
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><BrowserRouter>
  <PreviewFrame label="Projects (invented projects, nothing saves)"><ProjectsPage /></PreviewFrame>
</BrowserRouter></QueryClientProvider>);
