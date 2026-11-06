import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import Button from "@/components/kit/Button";
import EmptyState from "@/components/kit/EmptyState";
import Loading from "@/components/kit/Loading";

/**
 * Supply Chain: the supply chain and service case screens run as their own site (engine/), shown here in a
 * frame with the person already signed in. The portal's API asks the engine for a session on their behalf
 * (routes/operation/scm-engine.ts); the session goes over in the address fragment, which is never sent to a
 * server and which the engine removes as soon as it has read it (engine/frontend/src/carres/embed.ts).
 * Words are in COPY-STANDARD "Supply Chain words".
 */
export const SC = {
  title: "New Supply Chain",
  opening: "Opening New Supply Chain",
  failed: "New Supply Chain could not be opened. Try again.",
  retry: "Try again",
};

type EngineSession = { site: string; token: string; sessionPass: string | null };

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The frame address: the engine site with the hand-over in the fragment. */
export function engineFrameSrc(r: EngineSession, path = "/"): string {
  return `${r.site}/#carres=${b64url(JSON.stringify({ t: r.token, sp: r.sessionPass ?? undefined, p: path }))}`;
}

export default function SupplyChainEngine() {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    setSrc(null);
    apiFetch<EngineSession>("/api/operation/scm-engine/session", { method: "POST" })
      .then((r) => { if (live) setSrc(engineFrameSrc(r)); })
      .catch((e: unknown) => { if (live) setError((e as { message?: string })?.message || SC.failed); });
    return () => { live = false; };
  }, [attempt]);

  if (error) {
    return <EmptyState title={SC.failed} detail={error === SC.failed ? undefined : error} action={<Button onClick={() => setAttempt((n) => n + 1)}>{SC.retry}</Button>} />;
  }
  if (!src) return <Loading variant="skeleton" lines={6} label={SC.opening} />;
  return <iframe src={src} title={SC.title} className="block h-[calc(100dvh-7rem)] min-h-[560px] w-full border-0" />;
}
