import { describe, expect, it } from "vitest";
import { sendSignInToPortal } from "./portalLogin";

describe("signed-out visits go to the portal sign-in (owner 14 Nov 2026)", () => {
  it("sends a direct visit to the portal", () => {
    expect(sendSignInToPortal(false, "", "carres-scm.pages.dev")).toBe(true);
  });
  it("leaves the frame, the PIN screen, invites, forgot password and local development alone", () => {
    expect(sendSignInToPortal(true, "", "carres-scm.pages.dev")).toBe(false);
    expect(sendSignInToPortal(false, "#engine-login", "carres-scm.pages.dev")).toBe(false);
    expect(sendSignInToPortal(false, "#forgot", "carres-scm.pages.dev")).toBe(false);
    expect(sendSignInToPortal(false, "#invite=abc", "carres-scm.pages.dev")).toBe(false);
    expect(sendSignInToPortal(false, "", "localhost")).toBe(false);
  });
});
