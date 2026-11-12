/* Carres: the public pages show the company from Settings > Branding, never Houzs's details. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const get = vi.fn();
vi.mock("../portal/portalApi", () => ({ portalApi: { get: (...a: unknown[]) => get(...a) } }));

import { normalizePublicCompany, publicAddressLines, resetPublicCompanyCache } from "./publicBranding";
import { PortalFrame } from "../portal/components/PortalFrame";

beforeEach(() => {
  resetPublicCompanyCache();
  get.mockReset();
});
afterEach(cleanup);

describe("public company contact", () => {
  it("defaults to the blank Carres identity", () => {
    expect(normalizePublicCompany(null)).toEqual({
      companyName: "Carres", registrationNo: "", address: "", postcode: "", phone: "", email: "",
    });
  });

  it("prints address lines and adds the postcode once", () => {
    expect(publicAddressLines({ address: "1 Jalan A\nKlang", postcode: "41000" })).toEqual(["1 Jalan A", "Klang", "41000"]);
    expect(publicAddressLines({ address: "1 Jalan A, 41000 Klang", postcode: "41000" })).toEqual(["1 Jalan A, 41000 Klang"]);
    expect(publicAddressLines({ address: "", postcode: "" })).toEqual([]);
  });

  it("the customer portal footer shows the Branding company and hides blank lines", async () => {
    get.mockResolvedValue({ companyName: "Carres Sdn Bhd", registrationNo: "", address: "1 Jalan A", postcode: "", phone: "", email: "cs@carresofficial.com" });
    const { container } = render(<MemoryRouter><PortalFrame><p>x</p></PortalFrame></MemoryRouter>);
    await waitFor(() => expect(container.textContent).toContain("cs@carresofficial.com"));
    expect(get).toHaveBeenCalledWith("/api/track/company", "");
    expect(container.textContent).toContain("Carres Sdn Bhd");
    expect(container.textContent).toContain("1 Jalan A");
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/houzs/i);
  });

  it("an unreachable server leaves the Carres default, never another company", async () => {
    get.mockRejectedValue(new Error("offline"));
    const { container } = render(<MemoryRouter><PortalFrame><p>x</p></PortalFrame></MemoryRouter>);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toContain("Carres");
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/houzs/i);
  });
});
