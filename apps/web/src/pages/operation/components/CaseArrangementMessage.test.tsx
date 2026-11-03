import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CaseArrangementMessage from "./CaseArrangementMessage";

describe("CaseArrangementMessage", () => {
  const c = { caseNo: "SC-0001", customerName: "Tan", customerPhone: "012-345 6789" };
  it("shows the message, Copy message and a wa.me link, never Send", () => {
    render(<CaseArrangementMessage c={c} leg="pickup" date="2026-11-05" />);
    expect(screen.getByText(/furniture pickup on/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open WhatsApp" }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/60123456789\?text=/);
    expect(screen.queryByText(/^Send$/)).toBeNull();
  });
  it("draws nothing without a date", () => {
    const { container } = render(<CaseArrangementMessage c={c} leg="delivery" date={null} />);
    expect(container.innerHTML).toBe("");
  });
});
