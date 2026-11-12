import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} } }));
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  cachedEngineSession,
  dropEngineSession,
  getEngineSession,
  installEngineSessionPrefetch,
  isEngineRowTarget,
  refreshEngineSession,
  resetEngineSessionForTests,
} from "./engine-session";

const site = "https://scm.test";
const signedIn = (id: string, role: string | null = "operation") =>
  useAuth.setState({ user: { id } as never, session: { access_token: "jwt" } as never, role: role as never });

let n = 0;
beforeEach(() => {
  n = 0;
  sessionStorage.clear();
  resetEngineSessionForTests();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(async () => ({ site, token: `tok${++n}`, sessionPass: null }));
  signedIn("u1");
});
afterEach(() => { resetEngineSessionForTests(); useAuth.setState({ user: null, session: null, role: null }); });

describe("the engine session cache", () => {
  it("asks once and reuses the session, from memory and from this tab's storage", async () => {
    expect((await getEngineSession()).token).toBe("tok1");
    expect((await getEngineSession()).token).toBe("tok1");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/operation/scm-engine/session", { method: "POST" });

    // A reload of the portal: memory is gone, the tab's storage still has it.
    resetEngineSessionForTests();
    expect(cachedEngineSession()?.token).toBe("tok1");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("asks for a new one when the engine refuses it, and keeps a newer one already in hand", async () => {
    await getEngineSession();
    expect((await refreshEngineSession("tok1")).token).toBe("tok2");
    expect(cachedEngineSession()?.token).toBe("tok2");
    // A late refusal of the old token does not throw away the new session.
    expect((await refreshEngineSession("tok1")).token).toBe("tok2");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("never hands one person's session to another", async () => {
    await getEngineSession();
    signedIn("u2");
    expect(cachedEngineSession()).toBeNull();
    expect((await getEngineSession()).token).toBe("tok2");
  });

  it("keeps a failed request out of the cache", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("down"));
    await expect(getEngineSession()).rejects.toThrow("down");
    expect(cachedEngineSession()).toBeNull();
    expect((await getEngineSession()).token).toBe("tok1");
  });
});

describe("asking early", () => {
  it("shares one request between the early ask and the frame", async () => {
    let release!: () => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((r) => { release = () => r({ site, token: "early", sessionPass: null }); }));
    const a = getEngineSession();
    const b = getEngineSession();
    release();
    expect((await a).token).toBe("early");
    expect((await b).token).toBe("early");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("asks at boot for the roles that open the engine, and not for others", async () => {
    installEngineSessionPrefetch();
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    resetEngineSessionForTests();
    sessionStorage.clear();
    vi.mocked(apiFetch).mockClear();
    signedIn("u3", "dealer");
    installEngineSessionPrefetch();
    await Promise.resolve();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("asks when the pointer or focus reaches an engine menu row, once", async () => {
    installEngineSessionPrefetch();
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1)); // the boot ask
    await getEngineSession(); // ...answered
    dropEngineSession();
    vi.mocked(apiFetch).mockClear();

    const row = document.createElement("a");
    row.href = "/operation/sc/orders";
    const other = document.createElement("a");
    other.href = "/operation/settings";
    document.body.append(row, other);
    other.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(isEngineRowTarget(other)).toBe(false);
    expect(isEngineRowTarget(row)).toBe(true);
    row.dispatchEvent(new Event("pointerover", { bubbles: true }));
    row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    row.remove(); other.remove();
  });
});
