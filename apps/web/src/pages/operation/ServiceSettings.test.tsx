/**
 * Settings → Service (0711). YH (chat, 2026-10-26): Close Case needs a stage
 * that closes the case, so "In use" is locked on the last one still in use.
 * Renaming it stays allowed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/settings-queries", () => ({ useCanEditSettings: vi.fn(() => true) }));
import { apiFetch } from "@/lib/api";
import ServiceSettings from "./ServiceSettings";

const stage = (id: string, label: string, active: boolean, isClosed: boolean) => ({ id, label, active, isClosed });
function answer(statuses: ReturnType<typeof stage>[]) {
  vi.mocked(apiFetch).mockImplementation(async (path: string) =>
    path === "/api/ops/service-cases/settings"
      ? { defaultOwnerUserId: null, types: [], statuses }
      : { staff: [] },
  );
}
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ServiceSettings />
    </QueryClientProvider>,
  );
}
const inUse = (id: string) => document.getElementById(`service-statuses-${id}-active`) as HTMLButtonElement;

beforeEach(() => vi.mocked(apiFetch).mockReset());
afterEach(cleanup);

describe("Service Settings: the last stage that closes the case", () => {
  it("locks In use on the only closing stage in use and says why; renaming stays open", async () => {
    answer([stage("s1", "Pending", true, false), stage("s4", "Resolved", true, true)]);
    mount();
    const stages = await screen.findByTestId("service-pick-statuses");
    await within(stages).findByDisplayValue("Resolved");
    expect(inUse("s4")).toBeDisabled();
    expect(inUse("s1")).not.toBeDisabled();
    expect(within(stages).getByText("Close Case needs this stage.")).toBeInTheDocument();
    expect(within(stages).getByDisplayValue("Resolved")).not.toBeDisabled();
  });

  it("leaves both switchable when two closing stages are in use", async () => {
    answer([stage("s4", "Resolved", true, true), stage("s5", "Closed", true, true)]);
    mount();
    const stages = await screen.findByTestId("service-pick-statuses");
    await within(stages).findByDisplayValue("Closed");
    expect(inUse("s4")).not.toBeDisabled();
    expect(inUse("s5")).not.toBeDisabled();
    expect(within(stages).queryByText("Close Case needs this stage.")).not.toBeInTheDocument();
  });

  it("does not lock a closing stage that is already off", async () => {
    answer([stage("s4", "Resolved", true, true), stage("s5", "Closed", false, true)]);
    mount();
    const stages = await screen.findByTestId("service-pick-statuses");
    await within(stages).findByDisplayValue("Closed");
    expect(inUse("s4")).toBeDisabled();
    expect(inUse("s5")).not.toBeDisabled();
  });
});

// 0766 — Houzs ServiceLeadTimePortal.tsx: a target change carries a reason.
describe("Service Settings: Lead Time", () => {
  it("asks for a reason before a target change saves", async () => {
    const lead = { profiles: [{ id: "p1", name: "Normal", description: null, isActive: true, targets: { s1: 2 } }], amendments: [] };
    vi.mocked(apiFetch).mockImplementation(async (path: string) =>
      path === "/api/ops/service-cases/settings"
        ? { defaultOwnerUserId: null, types: [], statuses: [stage("s1", "Pending", true, false), stage("s4", "Resolved", true, true)] }
        : path === "/api/ops/service-cases/settings/lead-time" ? lead : { staff: [] },
    );
    mount();
    const section = await screen.findByTestId("service-lead-time");
    const days = await within(section).findByLabelText("Target days for Pending");
    fireEvent.change(days, { target: { value: "3" } });
    const save = within(section).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(within(section).getByLabelText("Reason for Pending"), { target: { value: "Peak season backlog" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/ops/service-cases/settings/lead-time/targets", {
        method: "PATCH",
        body: JSON.stringify({ profileId: "p1", statusId: "s1", targetDays: 3, reason: "Peak season backlog" }),
      }),
    );
  });
});
