/* Carres: the engine serves no /api/sync/*, so Settings has no Sync tab and never asks for that status. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const queried: string[] = [];
vi.mock("../hooks/useQuery", () => ({
  useQuery: (key: unknown, _f: unknown, _d: unknown, opts?: { enabled?: boolean }) => {
    if (opts?.enabled !== false) queried.push(String(Array.isArray(key) ? key[0] : key));
    return { data: null, loading: false, error: null, reload: vi.fn() };
  },
}));
vi.mock("../hooks/useStickyFilters", () => ({
  useStickyFilters: () => [new URLSearchParams("tab=sync"), vi.fn()],
}));
vi.mock("../hooks/useToast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { Settings } from "./Settings";

afterEach(cleanup);

describe("Carres Settings", () => {
  it("hides the Sync tab, falls back from ?tab=sync, and never fetches /api/sync/status", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.queryByRole("tab", { name: "Sync" })).toBeNull();
    expect(screen.queryByText("Sync", { selector: "button" })).toBeNull();
    expect(screen.getAllByText("Connection").length).toBeGreaterThan(0);
    expect(queried).not.toContain("/api/sync/status");
  });
});
