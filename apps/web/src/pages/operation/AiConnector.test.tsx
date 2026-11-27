/**
 * The AI Connector page and its "Allow?" screen (owner, 25 Nov 2026). The server decides who may do what
 * (apps/api routes/mcp-admin.ts); these tests prove the page shows each state truthfully and calls the right door.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { itSaysNoBannedWord } from "@/test/banned-words";
import AiConnector from "./AiConnector";
import AiConnect from "../AiConnect";

const net = vi.hoisted(() => ({ routes: {} as Record<string, unknown>, calls: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${path}`;
    net.calls.push(key);
    if (key in net.routes) return net.routes[key];
    throw new Error(`unmocked ${key}`);
  }),
}));

const URL_ = "https://api.carresofficial.com/api/mcp";
const ME_BASE = { allowed: false, eligible: true, isAdmin: false, pendingRequest: null, connectorUrl: URL_, apps: [] };

function renderWith(ui: React.ReactNode, path = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  net.routes = {};
  net.calls = [];
});

describe("AI Connector page", () => {
  it("staff without access see Request access, and pressing it calls the request door", async () => {
    net.routes["GET /api/mcp-admin/me"] = ME_BASE;
    net.routes["POST /api/mcp-admin/me/request"] = { ok: true };
    renderWith(<AiConnector />);
    fireEvent.click(await screen.findByRole("button", { name: "Request access" }));
    await waitFor(() => expect(net.calls).toContain("POST /api/mcp-admin/me/request"));
    expect(screen.queryByText(URL_)).toBeNull();
    expect(net.calls).not.toContain("GET /api/mcp-admin/admin/overview");
  });

  it("an allowed person sees the connector address and the steps, not the admin overview", async () => {
    net.routes["GET /api/mcp-admin/me"] = { ...ME_BASE, allowed: true };
    renderWith(<AiConnector />);
    expect(await screen.findAllByText(URL_)).toHaveLength(2);
    expect(screen.getByText("How to connect")).toBeTruthy();
    expect(screen.queryByText("Access requests")).toBeNull();
  });

  it("the principal sees requests, connections, the allowed list, the leak check and recent lookups", async () => {
    net.routes["GET /api/mcp-admin/me"] = { ...ME_BASE, allowed: true, isAdmin: true };
    const p = { name: "Aina", role: "operation", title: "" };
    net.routes["GET /api/mcp-admin/admin/overview"] = {
      connectorUrl: URL_,
      stats: { connectedPeople: 1, callsToday: 3, refusedToday: 1, waiting: 1 },
      requests: [{ id: "mcpr_1", userId: "u1", ...p, reason: "Connecting Claude", createdAt: "2026-11-25T02:00:00Z" }],
      connected: [{ tokenId: "mcpt_1", userId: "u2", name: "Ben", role: "finance", title: "", app: "Claude", connectedAt: null, lastUsedAt: null }],
      allowed: [{ userId: "u2", name: "Ben", role: "finance", title: "", approvedAt: null }],
      calls: [{ id: "mcpl_1", userId: "u2", name: "Ben", role: "finance", title: "", app: "Claude", tool: "erp_get", target: "/api/orders", status: 200, ok: true, note: "", ms: 12, at: null }],
      staff: [{ userId: "u3", name: "Chen", role: "bd", title: "" }],
    };
    net.routes["POST /api/mcp-admin/admin/requests/mcpr_1/approve"] = { ok: true };
    net.routes["POST /api/mcp-admin/admin/revoke"] = { ok: true };
    renderWith(<AiConnector />);
    expect(await screen.findByText("Access requests")).toBeTruthy();
    expect(screen.getByText("Leak check")).toBeTruthy();
    expect(screen.getByText("Recent lookups")).toBeTruthy();
    expect(screen.getByText(/erp_get \/api\/orders/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(net.calls).toContain("POST /api/mcp-admin/admin/requests/mcpr_1/approve"));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(net.calls).toContain("POST /api/mcp-admin/admin/revoke"));
  });

  it("a failed read says Could not be loaded with Try again, never an empty page", async () => {
    renderWith(<AiConnector />);
    expect(await screen.findByText("Could not be loaded")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("the Allow? screen", () => {
  it("shows the app, the person and the three promises, and Allow goes to the consent door", async () => {
    net.routes["GET /api/mcp-admin/consent/mcpa_1"] = { app: "Claude", clientName: "Claude", redirectHost: "claude.ai", user: { name: "Ben", email: "b@x.com" }, eligible: true, allowed: true };
    net.routes["POST /api/mcp-admin/consent/mcpa_1"] = { redirect: "https://claude.ai/api/mcp/auth_callback?code=x" };
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
    renderWith(<AiConnect />, "/ai-connect?request=mcpa_1");
    expect(await screen.findByText("Claude wants to read Carres ERP as you")).toBeTruthy();
    expect(screen.getByText("Read only.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=x"));
  });

  it("an account without access is offered Request access, not Allow", async () => {
    net.routes["GET /api/mcp-admin/consent/mcpa_2"] = { app: "ChatGPT", clientName: "ChatGPT", redirectHost: "chatgpt.com", user: { name: "Chen", email: "c@x.com" }, eligible: true, allowed: false };
    renderWith(<AiConnect />, "/ai-connect?request=mcpa_2");
    expect(await screen.findByRole("button", { name: "Request access" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });

  it("a link without a request says so", async () => {
    renderWith(<AiConnect />, "/ai-connect");
    expect(await screen.findByText(/This link is incomplete/)).toBeTruthy();
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
describe("no banned word reaches the screen", () => {
  itSaysNoBannedWord(join(HERE, "AiConnector.tsx"), { minStrings: 20, expectString: "Request access" });
  itSaysNoBannedWord(join(HERE, "..", "AiConnect.tsx"), { minStrings: 8, expectString: "Allow" });
});
