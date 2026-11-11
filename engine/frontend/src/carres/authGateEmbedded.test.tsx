// Carres only (not part of Houzs's code): AuthGate's embedded-only branch.
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ state: { user: null as null | { id: number }, loading: true, hasUsers: true as boolean | null } }));
const signedOut = vi.hoisted(() => vi.fn());

vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth.state }));
vi.mock("./embed", () => ({ CARRES_EMBEDDED: true, carresPortalOrigin: () => "https://carres-portal.pages.dev" }));
vi.mock("./ready", () => ({ reportCarresSignedOut: signedOut }));
vi.mock("../mobile/useIsMobile", () => ({ useIsMobile: () => false }));

import { AuthGate } from "../auth/AuthGate";

describe("AuthGate inside the Carres portal", () => {
  beforeEach(() => { signedOut.mockReset(); });

  it("draws nothing while the session is checked: the portal's skeleton is the one loading state", () => {
    auth.state = { user: null, loading: true, hasUsers: true };
    const view = render(<AuthGate><p>app</p></AuthGate>);
    expect(view.container.innerHTML).toBe("");
    expect(signedOut).not.toHaveBeenCalled();
  });

  it("tells the portal when the handed-over session is refused", () => {
    auth.state = { user: null, loading: false, hasUsers: true };
    render(<AuthGate><p>app</p></AuthGate>);
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it("opens the app for a signed-in person and says nothing", () => {
    auth.state = { user: { id: 1 }, loading: false, hasUsers: true };
    const view = render(<AuthGate><p>app</p></AuthGate>);
    expect(view.getByText("app")).toBeTruthy();
    expect(signedOut).not.toHaveBeenCalled();
  });
});
