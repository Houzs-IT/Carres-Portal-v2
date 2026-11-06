import { describe, expect, it } from "vitest";
import { engineFrameSrc } from "./SupplyChainEngine";

describe("engineFrameSrc", () => {
  it("puts the session in the fragment, never the query", () => {
    const src = engineFrameSrc({ site: "https://scm.test", token: "tok", sessionPass: null }, "/scm");
    expect(src.startsWith("https://scm.test/#carres=")).toBe(true);
    const json = atob(src.split("#carres=")[1].replace(/-/g, "+").replace(/_/g, "/"));
    expect(JSON.parse(json)).toEqual({ t: "tok", p: "/scm" });
  });
});
