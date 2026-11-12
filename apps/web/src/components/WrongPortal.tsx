import type { ReactNode } from "react";
import type { Role } from "@carres/shared/domain";
import { PORTAL_URLS, portalForRole } from "@/lib/portal";
import { useAuth } from "@/lib/auth";

/** The one signpost card: a short eyebrow, a title, one sentence, an optional door and `Sign out`. */
function Signpost({ testId, eyebrow, title, body, door }: {
  testId: string; eyebrow: string; title: string; body: string; door?: ReactNode;
}) {
  const signOut = useAuth((s) => s.signOut);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm" data-testid={testId}>
        <p className="text-label uppercase tracking-[0.06em] text-muted-foreground">{eyebrow}</p>
        <h1 className="text-strong mt-2 text-foreground">{title}</h1>
        <p className="text-body mt-2 text-muted-foreground">{body}</p>
        {door}
        <button
          type="button"
          className={`btn-ghost w-full ${door ? "mt-2" : "mt-6"}`}
          onClick={() => void signOut()}
          data-testid={`${testId}-signout`}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

/**
 * Shown when a signed-in role lands on the WRONG portal domain (POS role on
 * erp.carresofficial.com or vice versa). We never silently redirect — the
 * Supabase session lives per-origin, so the user must sign in again on the
 * right domain; this card tells them where to go.
 */
export default function WrongPortal({ role }: { role: Role }) {
  const home = portalForRole(role);
  const url = PORTAL_URLS[home];
  const label = home === "pos" ? "Carres POS" : "Carres ERP";

  return (
    <Signpost
      testId="wrong-portal"
      eyebrow="WRONG DOOR"
      title={`This account belongs to ${label}`}
      body={`Please sign in on ${label} instead.`}
      door={
        <a
          href={url}
          className="btn-primary mt-6 inline-flex w-full items-center justify-center"
          data-testid="wrong-portal-go"
        >
          Go to {url.replace("https://", "")}
        </a>
      }
    />
  );
}

/**
 * The supplier, warehouse and delivery partner portals were removed on 12 Nov 2026 (owner): Houzs's engine
 * has its own pages for outside parties. Those roles sign in and see this card instead of an app.
 */
export function PortalMoved() {
  return (
    <Signpost
      testId="portal-moved"
      eyebrow="PORTAL MOVED"
      title="This portal moved"
      body="Carres no longer runs this portal here. Your Carres contact will send you the new link."
    />
  );
}
