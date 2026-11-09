import { describe, expect, it } from "vitest";
import { engineFrameSrc, enginePath } from "./SupplyChainEngine";

describe("engineFrameSrc", () => {
  it("puts the session in the fragment, never the query", () => {
    const src = engineFrameSrc({ site: "https://scm.test", token: "tok", sessionPass: null }, "/scm");
    expect(src.startsWith("https://scm.test/#carres=")).toBe(true);
    const json = atob(src.split("#carres=")[1].replace(/-/g, "+").replace(/_/g, "/"));
    expect(JSON.parse(json)).toEqual({ t: "tok", p: "/scm" });
  });
});

describe("enginePath", () => {
  it("takes an engine address and refuses anything that could leave the engine", () => {
    expect(enginePath("/scm/purchase-orders")).toBe("/scm/purchase-orders");
    expect(enginePath("//evil.example")).toBe("/scm/sales-orders");
    expect(enginePath("https://evil.example")).toBe("/scm/sales-orders");
    expect(enginePath(null)).toBe("/scm/sales-orders");
  });
});
