import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const signOut = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: (pick: (s: { signOut: () => void }) => unknown) => pick({ signOut }),
}));

import WrongPortal, { PortalMoved } from "./WrongPortal";

describe("sign-in signposts (COPY-STANDARD · Sign-in signposts)", () => {
  it("a supplier, warehouse or partner login sees `This portal moved` and can sign out (owner, 12 Nov 2026)", () => {
    render(<PortalMoved />);
    const card = screen.getByTestId("portal-moved");
    expect(card.textContent).toContain("PORTAL MOVED");
    expect(screen.getByRole("heading", { name: "This portal moved" })).toBeInTheDocument();
    expect(card.textContent).toContain("Carres no longer runs this portal here. Your Carres contact will send you the new link.");
    expect(card.querySelector("a")).toBeNull();
    fireEvent.click(screen.getByTestId("portal-moved-signout"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("the wrong-domain card keeps its door and its sign out", () => {
    render(<WrongPortal role="dealer" />);
    expect(screen.getByRole("heading", { name: "This account belongs to Carres POS" })).toBeInTheDocument();
    expect(screen.getByTestId("wrong-portal-go")).toHaveAttribute("href", "https://pos.carresofficial.com");
    expect(screen.getByTestId("wrong-portal-signout")).toBeInTheDocument();
  });
});
