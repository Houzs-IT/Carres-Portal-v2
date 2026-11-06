import { describe, expect, it } from "vitest";
import { verifyAssertion } from "./sso";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SECRET = "x".repeat(32);
async function sign(payload: object, secret = SECRET) {
  const enc = new TextEncoder();
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64url(await crypto.subtle.sign("HMAC", key, enc.encode(body)))}`;
}

describe("verifyAssertion", () => {
  const now = 1_000_000;
  it("accepts a fresh assertion signed with the shared secret", async () => {
    const a = await verifyAssertion(SECRET, await sign({ email: "a@b.c", role: "operation", exp: now + 30_000 }), now);
    expect(a?.email).toBe("a@b.c");
  });
  it("refuses another secret, an expired one and one that lives too long", async () => {
    expect(await verifyAssertion(SECRET, await sign({ email: "a@b.c", role: "operation", exp: now + 30_000 }, "y".repeat(32)), now)).toBeNull();
    expect(await verifyAssertion(SECRET, await sign({ email: "a@b.c", role: "operation", exp: now - 1 }), now)).toBeNull();
    expect(await verifyAssertion(SECRET, await sign({ email: "a@b.c", role: "operation", exp: now + 120_000 }), now)).toBeNull();
  });
});
