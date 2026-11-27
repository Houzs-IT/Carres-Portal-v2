/**
 * /operation/ai-connector — System › AI Connector (owner, 25 Nov 2026; the same connector as Hookka and Houzs).
 *
 * Everyone with a Carres staff account: connect their own Claude or ChatGPT (read only, their own permissions),
 * ask for access, see and stop their own connections. The principal: approve people, turn it on for someone, see
 * who is connected and every lookup, disconnect anyone, and run the leak check. Every rule is the server's
 * (apps/api/src/routes/mcp-admin.ts); this page lays it out. Kit: Panel, Button, Select, Tabs, EmptyState, Loading,
 * Toast. Rows are plain lists (no table), so the page works at phone width without sideways scroll.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/components/kit/Button";
import EmptyState from "@/components/kit/EmptyState";
import Loading from "@/components/kit/Loading";
import Panel from "@/components/kit/Panel";
import Select from "@/components/kit/Select";
import Tabs from "@/components/kit/Tabs";
import { notify } from "@/components/kit/Toast";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queries";

type MyApp = { tokenId: string; app: string; connectedAt: string | null; lastUsedAt: string | null };
type Me = { allowed: boolean; eligible: boolean; isAdmin: boolean; pendingRequest: { id: string; createdAt: string | null } | null; connectorUrl: string; apps: MyApp[] };
type Person = { userId: string; name: string; role: string; title: string };
type Overview = {
  connectorUrl: string;
  stats: { connectedPeople: number; callsToday: number; refusedToday: number; waiting: number };
  requests: (Person & { id: string; reason: string; createdAt: string | null })[];
  connected: (Person & { tokenId: string; app: string; connectedAt: string | null; lastUsedAt: string | null })[];
  allowed: (Person & { approvedAt: string | null })[];
  calls: (Person & { id: string; app: string; tool: string; target: string; status: number; ok: boolean; note: string; ms: number; at: string | null })[];
  staff: Person[];
};
type LeakRow = { path: string; outcome: "opened" | "refused" | "error"; status: number; hidden: string[]; sensitive: string[] };

const BASE = "/api/mcp-admin";
const post = <T,>(path: string, body: unknown = {}) => apiFetch<T>(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body) });

const ROLE_WORD: Record<string, string> = { principal: "Principal", operation: "Operation", finance: "Finance", bd: "Business development", hr: "HR" };
const who = (p: Person) => [ROLE_WORD[p.role] ?? p.role, p.title].filter(Boolean).join(" · ");

function when(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One line of a list: the facts on the left, one or two actions on the right; wraps on a phone. */
function Row({ title, detail, actions }: { title: ReactNode; detail?: ReactNode; actions?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium text-c-ink break-words">{title}</div>
        {detail ? <div className="text-meta text-c-secondary break-words">{detail}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </li>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-c-row-line">{children}</ul>;
}

function ConnectorAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md border border-c-input-border bg-c-search-bg px-3 py-2 text-body text-c-ink">{url}</code>
      <Button
        icon="copy"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => notify("danger", "Could not copy. Select the address and copy it by hand."),
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function HowToConnect({ url }: { url: string }) {
  const [tab, setTab] = useState("claude");
  const steps =
    tab === "claude"
      ? [
          "Open Claude: Settings › Connectors › Add custom connector.",
          "Name: Carres ERP. URL: the connector address below.",
          "Press Connect, sign in to the ERP if asked, then press Allow.",
          "Ask a question in a new chat, for example: How many sales orders did we get this week?",
        ]
      : [
          "Open ChatGPT: Settings › Apps & Connectors › Advanced, and turn on Developer mode.",
          "Create a connector: name Carres ERP, URL the connector address below, authentication OAuth.",
          "Sign in to the ERP when asked, then press Allow.",
          "In a new chat, choose the Carres ERP connector and ask your question.",
        ];
  return (
    <Panel title="How to connect">
      <div className="flex flex-col gap-3">
        <p className="text-body text-c-secondary">Works with Claude and ChatGPT, and any app that supports remote MCP connectors.</p>
        <Tabs
          variant="segmented"
          label="AI app"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "claude", label: "Claude" },
            { value: "chatgpt", label: "ChatGPT" },
          ]}
        />
        <ol className="list-decimal space-y-1.5 pl-5 text-body text-c-body">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <ConnectorAddress url={url} />
      </div>
    </Panel>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-c-card-border bg-c-card [padding:var(--card-pad)]">
      <div className="text-meta text-c-secondary">{label}</div>
      <div className={`text-title tabular-nums ${alert ? "text-c-err-fg" : "text-c-ink"}`}>{value}</div>
    </div>
  );
}

function LeakCheck({ people }: { people: Person[] }) {
  const [person, setPerson] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<LeakRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!person) return;
    setRunning(true);
    setError(null);
    setRows([]);
    setProgress(null);
    try {
      let offset = 0;
      const all: LeakRow[] = [];
      for (let guard = 0; guard < 300; guard++) {
        // eslint-disable-next-line no-await-in-loop -- one server page at a time, so progress shows and the Worker never runs the whole sweep at once
        const d = await post<{ total: number; next: number; done: boolean; rows: LeakRow[] }>("/admin/leak-check", { userId: person, offset });
        all.push(...d.rows);
        setRows([...all]);
        setProgress({ done: d.next, total: d.total });
        if (d.done) break;
        offset = d.next;
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setRunning(false);
    }
  };

  const opened = rows.filter((r) => r.outcome === "opened");
  const refused = rows.filter((r) => r.outcome === "refused").length;
  const errors = rows.filter((r) => r.outcome === "error").length;
  const withSensitive = opened.filter((r) => r.sensitive.length > 0);

  return (
    <Panel title="Leak check">
      <div className="flex flex-col gap-3">
        <p className="text-body text-c-secondary">
          Reads every list in the ERP as one approved staff account, exactly as their AI would. It shows field names only, never values, and signs that session out at the end.
        </p>
        {people.length === 0 ? (
          <p className="text-body text-c-secondary">Turn the AI Connector on for a staff account first; the check runs as that account.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <Select
                id="leak-person"
                label="Account"
                placeholder="Choose an approved staff account"
                value={person}
                onValueChange={setPerson}
                options={people.map((p) => ({ value: p.userId, label: `${p.name} · ${ROLE_WORD[p.role] ?? p.role}` }))}
              />
            </div>
            <Button variant="primary" disabled={!person} loading={running} onClick={() => void run()}>
              Run check
            </Button>
          </div>
        )}
        {error ? <p role="alert" className="text-body text-c-err-fg">{error}</p> : null}
        {progress ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`Checked of ${progress.total}`} value={progress.done} />
            <Stat label="This account can open" value={opened.length} />
            <Stat label="Refused (no permission)" value={refused} />
            <Stat label="Showing money or people fields" value={withSensitive.length} alert={withSensitive.length > 0} />
          </div>
        ) : null}
        {errors > 0 ? <p className="text-meta text-c-secondary">{errors} list(s) answered with an error, usually because they need a filter. That is not a leak.</p> : null}
        {opened.length > 0 ? (
          <List>
            {opened.map((r) => (
              <Row
                key={r.path}
                title={<span className="font-mono text-meta">{r.path}</span>}
                detail={
                  r.sensitive.length ? (
                    <span className="text-c-err-fg">Money or people fields: {r.sensitive.join(", ")}</span>
                  ) : (
                    "No money or people fields"
                  )
                }
              />
            ))}
          </List>
        ) : null}
      </div>
    </Panel>
  );
}

function AdminView({ ov }: { ov: Overview }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState<string | undefined>(undefined);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.aiConnectorOverview() });
      void qc.invalidateQueries({ queryKey: qk.aiConnectorMe() });
    },
    onError: (e) => notify("danger", errText(e)),
  });
  const busy = act.isPending;
  const run = (fn: () => Promise<unknown>, done: string) => act.mutate(fn, { onSuccess: () => notify("success", done) });

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="To approve" value={ov.stats.waiting} alert={ov.stats.waiting > 0} />
        <Stat label="People connected" value={ov.stats.connectedPeople} />
        <Stat label="Lookups, last 24 hours" value={ov.stats.callsToday} />
        <Stat label="Refused, last 24 hours" value={ov.stats.refusedToday} />
      </div>

      <Panel title="Access requests">
        <div className="flex flex-col gap-3">
          {ov.requests.length === 0 ? (
            <p className="text-body text-c-secondary">Nobody has asked for access.</p>
          ) : (
            <List>
              {ov.requests.map((r) => (
                <Row
                  key={r.id}
                  title={r.name}
                  detail={`${who(r)} · asked ${when(r.createdAt)}${r.reason ? ` · ${r.reason}` : ""}`}
                  actions={
                    <>
                      <Button variant="primary" disabled={busy} onClick={() => run(() => post(`/admin/requests/${r.id}/approve`), `${r.name} can now connect`)}>
                        Approve
                      </Button>
                      <Button disabled={busy} onClick={() => run(() => post(`/admin/requests/${r.id}/reject`), `Request from ${r.name} rejected`)}>
                        Reject
                      </Button>
                    </>
                  }
                />
              ))}
            </List>
          )}
          <div className="flex flex-wrap items-end gap-2 border-t border-c-section-line pt-3">
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <Select
                id="ai-grant"
                label="Turn on for someone"
                placeholder={ov.staff.length ? "Choose a staff member" : "Everyone is already allowed"}
                disabled={ov.staff.length === 0}
                value={pick}
                onValueChange={setPick}
                options={ov.staff.map((p) => ({ value: p.userId, label: `${p.name} · ${ROLE_WORD[p.role] ?? p.role}` }))}
              />
            </div>
            <Button
              disabled={!pick || busy}
              onClick={() => {
                const p = ov.staff.find((s) => s.userId === pick);
                run(async () => {
                  await post("/admin/access", { userId: pick });
                  setPick(undefined);
                }, `${p?.name ?? "That person"} can now connect`);
              }}
            >
              Turn on
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Connected people">
        {ov.connected.length === 0 ? (
          <EmptyState title="No one is connected yet" detail="A connection appears here when someone presses Allow in their AI app." />
        ) : (
          <List>
            {ov.connected.map((r) => (
              <Row
                key={r.tokenId}
                title={`${r.name} · ${r.app}`}
                detail={`${who(r)} · connected ${when(r.connectedAt)} · last used ${when(r.lastUsedAt)}`}
                actions={
                  <Button disabled={busy} onClick={() => run(() => post("/admin/revoke", { tokenId: r.tokenId }), `${r.name}'s ${r.app} is disconnected`)}>
                    Disconnect
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </Panel>

      <Panel title="Allowed to connect">
        {ov.allowed.length === 0 ? (
          <p className="text-body text-c-secondary">Only you so far.</p>
        ) : (
          <List>
            {ov.allowed.map((p) => (
              <Row
                key={p.userId}
                title={p.name}
                detail={`${who(p)} · since ${when(p.approvedAt)}`}
                actions={
                  <Button
                    disabled={busy}
                    aria-label={`Remove ${p.name}`}
                    onClick={() => run(() => apiFetch(`${BASE}/admin/access/${p.userId}`, { method: "DELETE" }), `${p.name} can no longer connect`)}
                  >
                    Remove
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </Panel>

      <LeakCheck people={ov.allowed} />

      <Panel title="Recent lookups">
        {ov.calls.length === 0 ? (
          <EmptyState title="Nothing looked up yet" detail="The last 100 things an AI read appear here, newest first." />
        ) : (
          <List>
            {ov.calls.map((k) => (
              <Row
                key={k.id}
                title={
                  <span>
                    {k.name} · {k.app} · <span className="font-mono text-meta">{k.tool}{k.target ? ` ${k.target}` : ""}</span>
                  </span>
                }
                detail={
                  <span>
                    {when(k.at)} · <span className={k.ok ? "text-c-ok-fg" : "text-c-err-fg"}>{k.ok ? "Answered" : k.note || `Refused (${k.status})`}</span>
                  </span>
                }
              />
            ))}
          </List>
        )}
      </Panel>
    </>
  );
}

export default function AiConnector() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: qk.aiConnectorMe(), queryFn: () => apiFetch<Me>(`${BASE}/me`) });
  const overview = useQuery({
    queryKey: qk.aiConnectorOverview(),
    queryFn: () => apiFetch<Overview>(`${BASE}/admin/overview`),
    enabled: me.data?.isAdmin === true,
  });
  const request = useMutation({
    mutationFn: () => post("/me/request", {}),
    onSuccess: () => {
      notify("success", "Request made. The principal approves it on this page.");
      void qc.invalidateQueries({ queryKey: qk.aiConnectorMe() });
    },
    onError: (e) => notify("danger", errText(e)),
  });
  const revokeMine = useMutation({
    mutationFn: (tokenId: string) => post("/me/revoke", { tokenId }),
    onSuccess: () => {
      notify("success", "Disconnected");
      void qc.invalidateQueries({ queryKey: qk.aiConnectorMe() });
      void qc.invalidateQueries({ queryKey: qk.aiConnectorOverview() });
    },
    onError: (e) => notify("danger", errText(e)),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.aiConnectorMe() });
    void qc.invalidateQueries({ queryKey: qk.aiConnectorOverview() });
  };

  return (
    <div data-testid="ai-connector" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto max-[767px]:p-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-body text-c-secondary">
          Ask Claude or ChatGPT about the ERP. Read only, and only what your own login can see. Every lookup is recorded.
        </p>
        <Button icon="refresh" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {me.isLoading ? <Loading variant="skeleton" lines={4} label="Loading the AI Connector" /> : null}
      {me.isError ? (
        <Panel title="AI Connector">
          <EmptyState title="Could not be loaded" detail={errText(me.error)} action={<Button onClick={() => void me.refetch()}>Try again</Button>} />
        </Panel>
      ) : null}

      {me.data ? (
        <Panel title="Your connector address">
          {me.data.allowed ? (
            <div className="flex flex-col gap-2">
              <p className="text-body text-c-secondary">Paste it into your AI app (steps below).</p>
              <ConnectorAddress url={me.data.connectorUrl} />
            </div>
          ) : !me.data.eligible ? (
            <p className="text-body text-c-secondary">The AI Connector is for Carres staff accounts.</p>
          ) : me.data.pendingRequest ? (
            <p className="text-body text-c-secondary">You asked on {when(me.data.pendingRequest.createdAt)}. You can connect once the principal approves it.</p>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-body text-c-secondary">The AI Connector is not turned on for you yet.</p>
              <Button variant="primary" loading={request.isPending} onClick={() => request.mutate()}>
                Request access
              </Button>
            </div>
          )}
        </Panel>
      ) : null}

      {me.data?.isAdmin ? (
        overview.isError ? (
          <Panel title="Overview">
            <EmptyState title="Could not be loaded" detail={errText(overview.error)} action={<Button onClick={() => void overview.refetch()}>Try again</Button>} />
          </Panel>
        ) : overview.data ? (
          <AdminView ov={overview.data} />
        ) : (
          <Loading variant="skeleton" lines={6} label="Loading the overview" />
        )
      ) : null}

      {me.data && me.data.apps.length > 0 ? (
        <Panel title="My connected apps">
          <List>
            {me.data.apps.map((a) => (
              <Row
                key={a.tokenId}
                title={a.app}
                detail={`Connected ${when(a.connectedAt)} · last used ${when(a.lastUsedAt)}`}
                actions={
                  <Button disabled={revokeMine.isPending} onClick={() => revokeMine.mutate(a.tokenId)}>
                    Disconnect
                  </Button>
                }
              />
            ))}
          </List>
        </Panel>
      ) : null}

      {me.data?.allowed ? <HowToConnect url={me.data.connectorUrl} /> : null}
    </div>
  );
}
