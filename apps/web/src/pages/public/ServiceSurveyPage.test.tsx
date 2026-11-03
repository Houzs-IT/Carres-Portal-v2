import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ServiceSurveyPage from "./ServiceSurveyPage";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});
import { ApiError, apiFetch } from "@/lib/api";

const TOKEN = "A".repeat(43);
const renderAt = () =>
  render(
    <MemoryRouter initialEntries={[`/survey/${TOKEN}`]}>
      <Routes><Route path="/survey/:token" element={<ServiceSurveyPage />} /></Routes>
    </MemoryRouter>,
  );

describe("ServiceSurveyPage", () => {
  it("sends the picked rating and thanks the customer", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ alreadySubmitted: false, caseNo: "SC2611-01", customerName: "Ryan Chong", rating: null, notes: null })
      .mockResolvedValueOnce({ ok: true });
    renderAt();
    fireEvent.click(await screen.findByRole("radio", { name: "4 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
    await screen.findByText("Thank you. Your feedback has been received.");
    expect(vi.mocked(apiFetch).mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ rating: 4, notes: null }) });
  });

  it("says a dead link is gone", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError(404, "gone", null));
    renderAt();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This survey link has expired or does not exist."));
  });
});
