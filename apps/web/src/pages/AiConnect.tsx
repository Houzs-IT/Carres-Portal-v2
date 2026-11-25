/**
 * /ai-connect?request=… — the "Allow?" screen an AI app (Claude, ChatGPT) sends a person to when they add the
 * Carres ERP connector (apps/api/src/routes/mcp.ts GET /oauth/authorize). Behind RequireAuth: a person who is not
 * signed in signs in first and comes back here (lib/return-to.ts). The server decides everything
 * (routes/mcp-admin.ts consent); this only shows it and sends the click. Standalone, centred, phone-first.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import Button from "@/components/kit/Button";
import Icon from "@/components/kit/Icon";
import Loading from "@/components/kit/Loading";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queries";

type Consent = { app: string; clientName: string; redirectHost: string; user: { name: string; email: string }; eligible: boolean; allowed: boolean };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function AiConnect() {
  const [params] = useSearchParams();
  const id = params.get("request") ?? "";
  const [requested, setRequested] = useState(false);

  const consent = useQuery({
    queryKey: qk.aiConnectConsent(id),
    queryFn: () => apiFetch<Consent>(`/api/mcp-admin/consent/${encodeURIComponent(id)}`),
    enabled: id !== "",
    retry: false,
  });
  const decide = useMutation({
    mutationFn: (decision: "allow" | "deny") =>
      apiFetch<{ redirect: string }>(`/api/mcp-admin/consent/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ decision }) }),
    onSuccess: (r) => window.location.assign(r.redirect),
  });
  const request = useMutation({
    mutationFn: () => apiFetch("/api/mcp-admin/me/request", { method: "POST", body: JSON.stringify({ reason: `Connecting ${consent.data?.app ?? "an AI app"}` }) }),
    onSuccess: () => setRequested(true),
  });

  const error = !id ? "This link is incomplete. Start again from the AI app." : consent.isError ? errText(consent.error) : decide.isError ? errText(decide.error) : request.isError ? errText(request.error) : null;
  const data = consent.data;

  return (
    <main className="flex min-h-screen items-start justify-center bg-c-ground px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-c-card-border bg-c-card p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-c-main text-white" aria-hidden="true">
            <Icon name="lock" size={18} />
          </span>
          <div className="text-strong text-c-ink">Carres ERP · AI Connector</div>
        </div>

        {error ? (
          <p role="alert" className="mb-4 rounded-md bg-c-err-bg px-3 py-2 text-body text-c-err-fg">
            {error}
          </p>
        ) : null}

        {id && consent.isLoading ? <Loading variant="skeleton" lines={3} label="Loading" /> : null}

        {data && !data.allowed ? (
          <div className="flex flex-col gap-4">
            <h1 className="text-title text-c-ink">The AI Connector is not turned on for your account</h1>
            <p className="text-body text-c-secondary">
              Signed in as <span className="font-medium text-c-ink">{data.user.name}</span>.{" "}
              {data.eligible ? "Ask for access; you can connect once the principal approves it." : "The AI Connector is for Carres staff accounts."}
            </p>
            {data.eligible ? (
              requested ? (
                <p className="rounded-md bg-c-ok-bg px-3 py-2 text-body text-c-ok-fg">Request made. Connect again from the AI app after it is approved.</p>
              ) : (
                <Button variant="primary" size="touch" loading={request.isPending} onClick={() => request.mutate()}>
                  Request access
                </Button>
              )
            ) : null}
          </div>
        ) : null}

        {data?.allowed ? (
          <div className="flex flex-col gap-4">
            <h1 className="text-title text-c-ink">{data.app} wants to read Carres ERP as you</h1>
            <p className="text-body text-c-secondary">
              Signed in as <span className="font-medium text-c-ink">{data.user.name}</span>
            </p>
            <ul className="flex flex-col gap-3 text-body text-c-body">
              <li className="flex gap-2">
                <span className="text-c-ok-fg"><Icon name="ready" size={16} /></span>
                <span><span className="font-medium text-c-ink">Read only.</span> It can look things up; it cannot create, change or delete anything.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-c-ok-fg"><Icon name="ready" size={16} /></span>
                <span><span className="font-medium text-c-ink">Only what you can see.</span> The same records and figures your own login shows you, nothing more.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-c-ok-fg"><Icon name="ready" size={16} /></span>
                <span><span className="font-medium text-c-ink">Recorded.</span> The principal can see what was looked up and when.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-c-secondary"><Icon name="help" size={16} /></span>
                <span>What it reads is passed to {data.app} to answer you. Stop it any time on System › AI Connector.</span>
              </li>
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" size="touch" loading={decide.isPending && decide.variables === "allow"} disabled={decide.isPending} onClick={() => decide.mutate("allow")}>
                Allow
              </Button>
              <Button size="touch" disabled={decide.isPending} onClick={() => decide.mutate("deny")}>
                Cancel
              </Button>
            </div>
            {data.redirectHost ? <p className="text-meta text-c-muted">You will return to {data.redirectHost}.</p> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
