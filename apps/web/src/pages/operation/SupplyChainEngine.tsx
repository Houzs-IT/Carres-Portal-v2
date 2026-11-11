import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { engineAddressFor, engineFor } from "@/pages/portal/portal-nav";
import { useEngineBadges } from "@/pages/portal/engine-badges";
import {
  cachedEngineSession,
  dropEngineSession,
  getEngineSession,
  installEngineSessionPrefetch,
  refreshEngineSession,
  type EngineSession,
} from "@/lib/engine-session";
import Button from "@/components/kit/Button";
import EmptyState from "@/components/kit/EmptyState";
import Loading from "@/components/kit/Loading";

/**
 * The supply chain and service case screens run as their own site (engine/), shown here in a frame with the
 * person already signed in. The portal's API asks the engine for a session on their behalf
 * (routes/operation/scm-engine.ts); the session goes over in the address fragment, which is never sent to a
 * server and which the engine removes at once (engine/frontend/src/carres/embed.ts). The engine draws no menu
 * of its own: the sidebar row's address names the engine page (portal-nav ENGINE_PAGES) and the frame is
 * told to go there. Words are in COPY-STANDARD "Supply Chain frame words".
 *
 * Loading shows ONE state: the portal skeleton stays over the frame (loading underneath, invisible) until the
 * engine says its first page is drawn ({ type: "carres:ready" }, engine carres/ready.ts), or FRAME_READY_TIMEOUT_MS
 * passes, whichever is first. The session comes from lib/engine-session.ts, which keeps it for the tab and asks
 * for it early; when the engine refuses it ({ type: "carres:signed-out" }) one new session is asked for.
 */
export const SC = {
  title: "Supply Chain",
  opening: "Opening Supply Chain",
  failed: "Supply Chain could not be opened. Try again.",
  retry: "Try again",
};

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The frame address: the engine site with the hand-over in the fragment. */
export function engineFrameSrc(r: EngineSession, path = "/"): string {
  return `${r.site}/#carres=${b64url(JSON.stringify({ t: r.token, sp: r.sessionPass ?? undefined, p: path }))}`;
}

/** The frame is shown at the latest this long after it starts loading, even without carres:ready. */
export const FRAME_READY_TIMEOUT_MS = 15_000;

/** Boot: the session is asked for at sign-in for the engine roles and on hover of an engine menu row. */
installEngineSessionPrefetch();

/** The engine page to show; only an engine address, never another site. */
export function enginePath(p: string | null): string {
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/scm/sales-orders";
}

export default function SupplyChainEngine({ path: wantedPath }: { path: string }) {
  const path = enginePath(wantedPath);
  // The page the frame is on: it opens on the row clicked, and later clicks move it there.
  const shown = useRef(path);
  const wanted = useRef(path);
  wanted.current = path;
  // A session already in hand opens the frame on the first render, with no request first.
  const [session, setSession] = useState<{ site: string; token: string; src: string } | null>(() => {
    const cached = cachedEngineSession();
    return cached ? { site: cached.site, token: cached.token, src: engineFrameSrc(cached, path) } : null;
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  // One new session per refusal: a second refusal right after it is shown as the failure.
  const refreshed = useRef(false);
  const navigate = useNavigate();

  const open = (r: EngineSession) => {
    shown.current = wanted.current;
    setReady(false);
    setSession({ site: r.site, token: r.token, src: engineFrameSrc(r, shown.current) });
  };

  useEffect(() => {
    if (attempt === 0 && session) return; // opened from the session in hand
    let live = true;
    setError(null);
    setSession(null);
    refreshed.current = false;
    getEngineSession()
      .then((r) => { if (live) open(r); })
      .catch((e: unknown) => { if (live) setError((e as { message?: string })?.message || SC.failed); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per attempt; the first uses the session in hand
  }, [attempt]);

  // The frame is shown when the engine has drawn its first page, or after the timeout.
  useEffect(() => {
    if (!session || ready) return;
    const t = setTimeout(() => setReady(true), FRAME_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [session, ready]);

  // The frame tells where it moved (engine carres/embed.ts reportCarresLocation): the address follows, so the
  // menu lights that page's row and a refresh reopens the same page, unless the address already shows that page. The frame is not sent back there.
  useEffect(() => {
    if (!session) return;
    let live = true;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; path?: unknown; counts?: unknown } | null;
      if (e.origin !== session.site) return;
      if (d?.type === "carres:ready") { refreshed.current = false; setReady(true); return; }
      // The engine refused the session (expired or signed out): one new session, then the failure.
      if (d?.type === "carres:signed-out") {
        if (refreshed.current) { dropEngineSession(session.token); setError(SC.failed); return; }
        refreshed.current = true;
        refreshEngineSession(session.token)
          .then((r) => { if (live) open(r); })
          .catch((err: unknown) => { if (live) setError((err as { message?: string })?.message || SC.failed); });
        return;
      }
      // Houzs's menu counts for the portal's menu (engine carres/BadgeReporter.tsx).
      if (d?.type === "carres:badges") { useEngineBadges.getState().set(d.counts); return; }
      if (d?.type !== "carres:location") return;
      if (typeof d.path !== "string" || !d.path.startsWith("/") || d.path.startsWith("//")) return;
      shown.current = d.path;
      // Already the page this address shows: keep the address. Two rows can open one engine page (Product
      // Request under Supply Chain and under Consignment); the row the person clicked stays lit.
      if (engineFor(window.location.pathname, window.location.search) === d.path) return;
      const address = engineAddressFor(d.path);
      if (address && address !== window.location.pathname + window.location.search) navigate(address, { replace: true });
    };
    window.addEventListener("message", onMessage);
    return () => { live = false; window.removeEventListener("message", onMessage); };
  }, [session, navigate]);

  useEffect(() => {
    if (!session || path === shown.current) return;
    shown.current = path;
    frame.current?.contentWindow?.postMessage({ type: "carres:navigate", path }, session.site);
  }, [path, session]);

  if (error) {
    return <EmptyState title={SC.failed} detail={error === SC.failed ? undefined : error} action={<Button onClick={() => setAttempt((n) => n + 1)}>{SC.retry}</Button>} />;
  }
  const skeleton = <Loading variant="skeleton" lines={6} label={SC.opening} />;
  if (!session) return skeleton;
  // Until it is ready the frame loads underneath, see-through (opacity, not visibility or display: a hidden
  // cross-origin frame may be throttled and never finish drawing), and the skeleton is the one thing on screen.
  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <iframe
        key={session.src}
        ref={frame}
        src={session.src}
        title={SC.title}
        aria-hidden={ready ? undefined : true}
        tabIndex={ready ? undefined : -1}
        className={`block min-h-0 w-full flex-1 border-0 ${ready ? "" : "pointer-events-none opacity-0"}`}
      />
      {!ready && <div className="absolute inset-0">{skeleton}</div>}
    </div>
  );
}
