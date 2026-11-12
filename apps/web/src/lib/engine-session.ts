import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * The engine session (Supply Chain frame, pages/operation/SupplyChainEngine.tsx), asked for once and reused.
 *
 * Opening the frame used to wait for a fresh session from the portal API (which asks the engine's
 * /api/carres-sso) on EVERY visit, before the frame even started loading, and every visit left a new session
 * row behind. The engine session lives 7 days (engine services/auth.ts SESSION_TTL_SECONDS), so one per tab is
 * enough: it is kept in memory and in this tab's sessionStorage, scoped to the signed-in portal person, and
 * reused until the engine says it no longer works (the frame posts carres:signed-out) — then exactly one new
 * one is asked for (refreshEngineSession).
 *
 * It is also asked for EARLY: at portal boot for the roles that open the frame, and when the pointer or focus
 * reaches any menu row whose address starts with /operation/sc/. Both go through the same in-flight promise,
 * so a hover and the frame mounting a moment later make one request, not two.
 */
export type EngineSession = { site: string; token: string; sessionPass: string | null };

/** Carres roles that open the engine — in step with the portal API gate (routes/operation/scm-engine.ts, hr from
 *  PR #2268) and the engine (engine/backend/src/carres/sso.ts ENGINE_ROLES). */
const ENGINE_ROLES: ReadonlySet<string> = new Set(["operation", "principal", "hr"]);
const STORE_KEY = "carres-engine-session";
const SESSION_URL = "/api/operation/scm-engine/session";

type Stored = { uid: string | null; session: EngineSession };

let memory: Stored | null = null;
let inflight: { uid: string | null; promise: Promise<EngineSession> } | null = null;

const currentUid = (): string | null => useAuth.getState().user?.id ?? null;

function isSession(v: unknown): v is EngineSession {
  const s = v as EngineSession | null;
  return !!s && typeof s.site === "string" && typeof s.token === "string" && s.token.length > 0
    && (s.sessionPass === null || typeof s.sessionPass === "string");
}

function readStore(): Stored | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    return v && isSession(v.session) ? { uid: v.uid ?? null, session: v.session } : null;
  } catch { return null; }
}

function writeStore(v: Stored | null): void {
  try {
    if (v) sessionStorage.setItem(STORE_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(STORE_KEY);
  } catch { /* storage unavailable: memory still holds it */ }
}

/** The session already in hand for the signed-in person, or null. Never makes a request. */
export function cachedEngineSession(): EngineSession | null {
  const uid = currentUid();
  if (memory && memory.uid === uid) return memory.session;
  const stored = readStore();
  if (stored && stored.uid === uid) {
    memory = stored;
    return stored.session;
  }
  return null;
}

function fetchFresh(): Promise<EngineSession> {
  const uid = currentUid();
  if (inflight && inflight.uid === uid) return inflight.promise;
  const promise = apiFetch<EngineSession>(SESSION_URL, { method: "POST" })
    .then((r) => {
      const session: EngineSession = { site: r.site, token: r.token, sessionPass: r.sessionPass ?? null };
      // Only kept when it is still the same person who asked for it.
      if (currentUid() === uid) {
        memory = { uid, session };
        writeStore(memory);
      }
      return session;
    })
    .finally(() => { if (inflight?.promise === promise) inflight = null; });
  inflight = { uid, promise };
  return promise;
}

/** The engine session: the one in hand, or one request (shared by everyone asking at the same time). */
export function getEngineSession(): Promise<EngineSession> {
  const cached = cachedEngineSession();
  return cached ? Promise.resolve(cached) : fetchFresh();
}

/** Forget the session. With a token, only when it is still the one held (a newer one is kept). */
export function dropEngineSession(token?: string): void {
  if (token && memory && memory.session.token !== token) return;
  if (token) {
    const stored = readStore();
    if (stored && stored.session.token !== token) return;
  }
  memory = null;
  writeStore(null);
}

/** The engine refused `failedToken`: forget it and ask for a new one (once; callers decide how often). */
export function refreshEngineSession(failedToken: string): Promise<EngineSession> {
  dropEngineSession(failedToken);
  return getEngineSession();
}

/** Start asking now, if this person opens the engine at all. Never throws; the frame reports any failure. */
export function prefetchEngineSession(): void {
  const { role, session } = useAuth.getState();
  if (!session || !role || !ENGINE_ROLES.has(role)) return;
  getEngineSession().catch(() => { /* the frame asks again and shows the failure */ });
}

/** A menu row that opens an engine page: its address starts with /operation/sc/. */
export function isEngineRowTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target.closest("a[href]") : null;
  if (!el) return false;
  try {
    return new URL((el as HTMLAnchorElement).href, window.location.href).pathname.startsWith("/operation/sc/");
  } catch { return false; }
}

let installed: (() => void) | null = null;

/**
 * Boot wiring, installed once: ask at sign-in for the engine roles, forget the session when the person
 * changes or signs out, and ask on hover/focus of an engine menu row (one delegated listener on the
 * document, so the sidebar's own code is untouched).
 */
export function installEngineSessionPrefetch(): () => void {
  if (installed) return installed;
  let lastUid = currentUid();
  const unsubscribe = useAuth.subscribe((s) => {
    const uid = s.user?.id ?? null;
    if (uid !== lastUid) {
      lastUid = uid;
      memory = null;
      inflight = null;
      const stored = readStore();
      if (stored && stored.uid !== uid) writeStore(null);
    }
    prefetchEngineSession();
  });
  const onIntent = (e: Event) => { if (isEngineRowTarget(e.target)) prefetchEngineSession(); };
  document.addEventListener("pointerover", onIntent, { passive: true });
  document.addEventListener("focusin", onIntent);
  prefetchEngineSession();
  installed = () => {
    unsubscribe();
    document.removeEventListener("pointerover", onIntent);
    document.removeEventListener("focusin", onIntent);
    installed = null;
  };
  return installed;
}

/** Tests only: forget everything held in memory. */
export function resetEngineSessionForTests(): void {
  memory = null;
  inflight = null;
  if (installed) installed();
}
