import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { engineAddressFor, engineFor } from "@/pages/portal/portal-nav";
import { useEngineBadges } from "@/pages/portal/engine-badges";
import { apiFetch } from "@/lib/api";
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
 */
export const SC = {
  title: "Supply Chain",
  opening: "Opening Supply Chain",
  failed: "Supply Chain could not be opened. Try again.",
  retry: "Try again",
};

type EngineSession = { site: string; token: string; sessionPass: string | null };

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The frame address: the engine site with the hand-over in the fragment. */
export function engineFrameSrc(r: EngineSession, path = "/"): string {
  return `${r.site}/#carres=${b64url(JSON.stringify({ t: r.token, sp: r.sessionPass ?? undefined, p: path }))}`;
}

/** The engine page to show; only an engine address, never another site. */
export function enginePath(p: string | null): string {
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/scm/sales-orders";
}

export default function SupplyChainEngine({ path: wantedPath }: { path: string }) {
  const path = enginePath(wantedPath);
  const [session, setSession] = useState<{ site: string; src: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  // The page the frame is on: it opens on the row clicked, and later clicks move it there.
  const shown = useRef(path);
  const wanted = useRef(path);
  wanted.current = path;
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    setError(null);
    setSession(null);
    apiFetch<EngineSession>("/api/operation/scm-engine/session", { method: "POST" })
      .then((r) => {
        if (!live) return;
        shown.current = wanted.current;
        setSession({ site: r.site, src: engineFrameSrc(r, shown.current) });
      })
      .catch((e: unknown) => { if (live) setError((e as { message?: string })?.message || SC.failed); });
    return () => { live = false; };
  }, [attempt]);

  // The frame tells where it moved (engine carres/embed.ts reportCarresLocation): the address follows, so the
  // menu lights that page's row and a refresh reopens the same page, unless the address already shows that page. The frame is not sent back there.
  useEffect(() => {
    if (!session) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; path?: unknown; counts?: unknown } | null;
      if (e.origin !== session.site) return;
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
    return () => window.removeEventListener("message", onMessage);
  }, [session, navigate]);

  useEffect(() => {
    if (!session || path === shown.current) return;
    shown.current = path;
    frame.current?.contentWindow?.postMessage({ type: "carres:navigate", path }, session.site);
  }, [path, session]);

  if (error) {
    return <EmptyState title={SC.failed} detail={error === SC.failed ? undefined : error} action={<Button onClick={() => setAttempt((n) => n + 1)}>{SC.retry}</Button>} />;
  }
  if (!session) return <Loading variant="skeleton" lines={6} label={SC.opening} />;
  return <iframe ref={frame} src={session.src} title={SC.title} className="block h-[calc(100dvh-7rem)] min-h-[560px] w-full border-0" />;
}
