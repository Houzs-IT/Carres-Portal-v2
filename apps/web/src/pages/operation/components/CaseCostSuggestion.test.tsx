import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CaseCostSuggestion from "./CaseCostSuggestion";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});
import { apiFetch } from "@/lib/api";

describe("CaseCostSuggestion", () => {
  it("saves only the side staff pick", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      customerAmount: 1000,
      supplierCost: 601,
      sources: { so: { docNo: "SO-1234", qty: 2, unitPrice: 500 }, po: { docNo: "PO-2054", qty: 2, unitPrice: 300.5 } },
    });
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<CaseCostSuggestion caseId="c1" onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-fill" }));
    await screen.findByText("Suggested Customer");
    fireEvent.click(screen.getByRole("button", { name: "Customer only" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ customerAmount: 1000 }));
  });
});
