// Carres only (not part of Houzs's code): the supplier person's Settings (the gear in the header).
//
// My account: who they are, and changing their password. Users and access (only for a person who may manage users):
// the people of their own department, added by invite email or with a password set now, and what each may see and do.
// The server checks every permission again on every request (engine/backend/src/carres/supplier/); turning a
// switch off here hides a page or a button, and the server refuses the same act.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { PERMS, supplierApi, supplierToken, type Department, type Person } from "./api";
import { forgetAll } from "./data";
import { PageBar, PageBody, ROLE_LABEL, homeFor, useSupplierSession } from "./Shell";
import { Badge, LoadError, Loading, fmtStamp, play, useToast } from "./ui";

// ── What each permission is called ──────────────────────────────────────────────────────────────────────────────

interface PermItem { k: string; label: string; desc: string; need?: string }
const GROUPS: Record<Department, Array<{ title: string; items: PermItem[] }>> = {
  operation: [
    { title: "Pages they can see", items: [
      { k: "v_orders", label: "Sales Orders", desc: "Orders that carry your items, and the full order page" },
      { k: "v_forecast", label: "Forecast", desc: "Units to prepare by month" },
      { k: "v_pickups", label: "Pickup Requests", desc: "Requests from Carres and their goods" },
      { k: "v_deliveries", label: "Deliveries", desc: "A 3PL's own delivery jobs and their Last Mile" },
    ] },
    { title: "Buttons they can use", items: [
      { k: "a_accept", label: "Accept pickups", desc: "Tell Carres the goods will be ready", need: "v_pickups" },
      { k: "a_collect", label: "Mark collected and upload DO", desc: "Close a pickup with its Delivery Order", need: "v_pickups" },
      { k: "a_date", label: "Change pickup date", desc: "Ask Carres to move an accepted pickup", need: "v_pickups" },
      { k: "a_cancel", label: "Request cancel", desc: "Ask Carres to cancel an accepted pickup", need: "v_pickups" },
      { k: "a_deldate", label: "Set delivery date", desc: "Plan the day of a delivery on your lorries", need: "v_deliveries" },
      { k: "a_export", label: "Export", desc: "Download lists as a file" },
    ] },
    { title: "Admin", items: [{ k: "a_users", label: "Manage users", desc: "Add people and change their access" }] },
  ],
  finance: [
    { title: "Pages they can see", items: [
      { k: "v_coll", label: "Collections", desc: "Every subscription order and its term" },
      { k: "v_month", label: "By Month", desc: "Instalments due and collected per month" },
    ] },
    { title: "What they can see", items: [
      { k: "d_names", label: "Customer names", desc: "Otherwise shown as the order number only" },
      { k: "d_share", label: "Your share amounts", desc: "Share earned, to come and at risk" },
      { k: "d_bad", label: "Overdue and bad debt", desc: "Orders behind on payment or in default" },
    ] },
    { title: "Buttons they can use", items: [
      { k: "a_export", label: "Export", desc: "Download lists as a file" },
      { k: "a_stmt", label: "Statement PDF", desc: "Download an order statement" },
    ] },
    { title: "Admin", items: [{ k: "a_users", label: "Manage users", desc: "Add people and change their access" }] },
  ],
};

const PRESETS: Record<Department, Array<{ id: string; label: string; sub: string; keys: readonly string[] }>> = {
  operation: [
    { id: "full", label: "Full access", sub: "Everything, including users", keys: PERMS.operation },
    { id: "warehouse", label: "Warehouse", sub: "See pages and handle pickups", keys: ["v_orders", "v_forecast", "v_pickups", "a_accept", "a_collect", "a_date", "a_export"] },
    { id: "view", label: "View only", sub: "See pages, no buttons", keys: ["v_orders", "v_forecast", "v_pickups"] },
  ],
  finance: [
    { id: "full", label: "Full access", sub: "Everything, including users", keys: PERMS.finance },
    { id: "analyst", label: "Finance staff", sub: "See all money, export", keys: ["v_coll", "v_month", "d_names", "d_share", "d_bad", "a_export", "a_stmt"] },
    { id: "view", label: "View only", sub: "Pages only, no amounts at risk", keys: ["v_coll", "v_month", "d_names"] },
  ],
};

const setOf = (keys: readonly string[]) => new Set(keys);
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));
const presetOf = (dept: Department, perms: Set<string>) => PRESETS[dept].find((p) => sameSet(setOf(p.keys), perms))?.label ?? "Custom";
/** The keys that are really on: a button whose page is off is off. */
function effective(dept: Department, perms: Set<string>): string[] {
  const out: string[] = [];
  for (const g of GROUPS[dept]) for (const it of g.items) if (perms.has(it.k) && !(it.need && !perms.has(it.need))) out.push(it.k);
  return out;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 2).join("") || "?";
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const INPUT = "h-[38px] w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-primary focus:shadow-[0_0_0_3px_rgba(27,27,57,0.12)]";
const CARD = "rounded-lg border border-border bg-surface shadow-stone";

// ── The page ────────────────────────────────────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { me, can } = useSupplierSession();
  const backTo = (location.state as { back?: string } | null)?.back ?? null;
  const adminOf: Department[] = (["operation", "finance"] as const).filter((d) => can(d, "a_users"));
  const [tab, setTab] = useState<"account" | "users">("account");
  const [dept, setDept] = useState<Department>(adminOf[0] ?? "operation");
  const [count, setCount] = useState<number | null>(null);

  const people = tab === "users";
  return (
    <>
      <PageBar
        eyebrow="Account"
        title="Settings"
        back={me.user.mustChangePassword ? undefined : () => navigate(backTo && !backTo.startsWith("/supplier/settings") ? backTo : homeFor(me))}
        backTip="Back"
      />
      <PageBody scroll riseKey="settings">
        <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="flex flex-col gap-0.5">
            {[
              { k: "account" as const, label: "My account", sub: "Profile and password" },
              ...(adminOf.length && !me.user.mustChangePassword
                ? [{ k: "users" as const, label: "Users and access", sub: count === null ? `${ROLE_LABEL[dept]} users` : `${count} ${dept === "finance" ? "finance" : "operation"} users` }]
                : []),
            ].map((n) => (
              <button
                key={n.k}
                type="button"
                onClick={() => setTab(n.k)}
                className={cn("flex items-center gap-2.5 rounded-lg border-0 px-3 py-2.5 text-left text-[13px] font-semibold transition-colors duration-150", tab === n.k ? "bg-surface text-ink" : "bg-transparent text-ink-secondary hover:bg-white/60")}
              >
                <span className="min-w-0 flex-1">
                  {n.label}
                  <span className="mt-0.5 block text-[11.5px] font-medium text-ink-muted">{n.sub}</span>
                </span>
              </button>
            ))}
          </nav>
          {people ? (
            <div className="flex min-w-0 flex-col gap-3">
              {adminOf.length > 1 && (
                <div className="inline-flex w-fit gap-0.5 rounded-md border border-border bg-surface p-1 shadow-stone">
                  {adminOf.map((d) => (
                    <button key={d} type="button" onClick={() => { setDept(d); setCount(null); }}
                      className={cn("rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider", dept === d ? "bg-primary text-white" : "text-ink-secondary")}>
                      {ROLE_LABEL[d]}
                    </button>
                  ))}
                </div>
              )}
              <Users key={dept} dept={dept} onCount={setCount} />
            </div>
          ) : (
            <MyAccount />
          )}
        </div>
      </PageBody>
    </>
  );
}

// ── My account ──────────────────────────────────────────────────────────────────────────────────────────────────

function MyAccount() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me, can, refresh } = useSupplierSession();
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forced = me.user.mustChangePassword;

  const strength = Math.min(4, (nw.length >= 10 ? 1 : 0) + (/[A-Z]/.test(nw) ? 1 : 0) + (/[0-9]/.test(nw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(nw) || nw.length >= 16 ? 1 : 0));
  const ok = !!cur && nw.length >= 10 && nw === again && !busy;
  const hint = nw ? (nw.length < 10 ? `${10 - nw.length} more characters needed` : ["Weak", "Fair", "Good", "Strong"][Math.max(0, strength - 1)]) : "Use at least 10 characters. A few words together are strong and easy to remember.";
  const depts: Department[] = [...(me.user.canOperation ? (["operation"] as const) : []), ...(me.user.canFinance ? (["finance"] as const) : [])];
  const role = depts.map((d) => ROLE_LABEL[d]).join(" and ");
  const admin = depts.some((d) => can(d, "a_users"));

  const save = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const out = await supplierApi.changePassword(cur, nw);
      // Every other session ended; this browser carries on with its new one.
      supplierToken.set(out.token);
      setCur(""); setNw(""); setAgain("");
      setDone(true);
      toast("Password changed");
      if (forced) { forgetAll(); refresh(); navigate(homeFor({ ...me, user: { ...me.user, mustChangePassword: false } }), { replace: true }); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The password could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <label>
      <span className="mb-1.5 block text-[12px] font-semibold text-ink">{label}</span>
      <input type="password" autoComplete={auto} value={value} onChange={(e) => { set(e.target.value); setDone(false); setError(null); }} className={INPUT} />
    </label>
  );

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      {forced && (
        <div role="status" className="rounded-lg border border-warning-text/20 bg-warning-bg px-4 py-3 text-[12.5px] leading-[1.5] text-warning-text">
          Choose your own password before you go on. Your admin set the one you signed in with.
        </div>
      )}
      <section className={CARD}>
        <header className="border-b border-border px-[18px] py-[14px]"><h2 className="m-0 text-[14px] font-bold text-ink">Your profile</h2></header>
        <dl className="m-0 grid gap-y-2.5 px-[18px] py-4 text-[13px]" style={{ gridTemplateColumns: "140px minmax(0,1fr)" }}>
          <dt className="text-ink-muted">Name</dt><dd className="m-0 text-ink">{me.user.name}</dd>
          <dt className="text-ink-muted">Email</dt><dd className="m-0 break-words text-ink">{me.user.email}</dd>
          <dt className="text-ink-muted">Company</dt><dd className="m-0 text-ink">{me.supplier.name}</dd>
          <dt className="text-ink-muted">Role</dt><dd className="m-0 text-ink">{role}{admin ? " · Admin" : ""}</dd>
        </dl>
      </section>
      <section className={CARD}>
        <header className="border-b border-border px-[18px] py-[14px]"><h2 className="m-0 text-[14px] font-bold text-ink">Change password</h2></header>
        <div className="flex flex-col gap-[14px] px-[18px] py-4">
          {field("Current password", cur, setCur, "current-password")}
          {field("New password", nw, setNw, "new-password")}
          <div className="-mt-1.5">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-1 flex-1 rounded-full transition-colors duration-200"
                  style={{ background: i < strength ? ["#B23A3A", "#C98A1B", "#2F55E0", "#2F8A5B"][strength - 1] : "rgb(var(--hz-border))" }} />
              ))}
            </div>
            <div className="mt-1.5 text-[11.5px]" style={{ color: nw && nw.length < 10 ? "rgb(var(--hz-err))" : "rgb(var(--hz-ink-muted))" }}>{hint}</div>
          </div>
          {field("New password again", again, setAgain, "new-password")}
          {!!again && nw !== again && <div className="-mt-1.5 text-[12px] text-err">The two new passwords are not the same.</div>}
          {error && <div role="alert" className="rounded-lg bg-err/[0.07] px-3 py-2.5 text-[12.5px] text-err">{error}</div>}
          {done && <div className="rounded-lg bg-synced/10 px-3 py-2.5 text-[12.5px] text-synced">Password changed. Other devices were signed out.</div>}
          <div>
            <button type="button" onClick={save} disabled={!ok}
              className="inline-flex h-[38px] items-center rounded-lg border-0 px-[18px] text-[13px] font-semibold text-white transition-colors duration-[160ms]"
              style={{ background: ok ? "rgb(var(--hz-primary))" : "rgba(27,27,57,0.35)", cursor: ok ? "pointer" : "not-allowed" }}>
              {busy ? "Saving" : "Change password"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Users and access ────────────────────────────────────────────────────────────────────────────────────────────

interface Draft {
  id: number | null;
  self: boolean;
  name: string;
  email: string;
  perms: Set<string>;
  how: "invite" | "password";
  password: string;
  mustChange: boolean;
}

function Users({ dept, onCount }: { dept: Department; onCount: (n: number) => void }) {
  const toast = useToast();
  const [list, setList] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    supplierApi.people(dept).then(
      (out) => { if (alive) { setList(out.users); onCount(out.users.length); } },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "The people could not be loaded."); },
    );
    return () => { alive = false; };
  }, [dept, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !list) return <LoadError message={error} onRetry={() => setNonce((n) => n + 1)} />;
  if (!list) return <Loading />;

  const total = GROUPS[dept].reduce((a, g) => a + g.items.length, 0);
  const invited = list.filter((u) => u.status === "invited").length;

  const save = async (d: Draft) => {
    setBusy(true);
    try {
      const perms = effective(dept, d.perms);
      if (d.id) {
        await supplierApi.changePerson(d.id, dept, { ...(d.self ? {} : { name: d.name.trim() }), perms });
        toast("Changes saved");
      } else {
        const out = await supplierApi.addPerson({
          department: dept, name: d.name.trim(), email: d.email.trim(), how: d.how, perms,
          ...(d.how === "password" ? { password: d.password, mustChange: d.mustChange } : {}),
        });
        // A colleague from the other department: no password was set and no email left, so say so.
        if (out.hadAccount) toast(`${out.user.name} already has an account. ${ROLE_LABEL[dept]} is added to it, and they sign in as before.`);
        else if (d.how === "password") toast(`${d.name.trim()} can sign in now`);
        else if (out.mailed === false) toast(`${d.name.trim()} is added. The invite email was not sent${out.mailNote ? `: ${out.mailNote}` : "."}`, "red");
        else toast(`Invite sent to ${d.email.trim()}`);
      }
      setDraft(null);
      setNote(null);
      setNonce((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : "The change could not be saved.", "red");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Draft) => {
    if (!d.id) return;
    setBusy(true);
    try {
      await supplierApi.removePerson(d.id, dept);
      setDraft(null);
      setNote(`${d.name} no longer has access.`);
      setNonce((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Access could not be removed.", "red");
    } finally {
      setBusy(false);
    }
  };

  if (draft) {
    return <UserForm dept={dept} draft={draft} setDraft={setDraft} list={list} busy={busy} onSave={save} onRemove={remove} onClose={() => setDraft(null)} />;
  }

  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="m-0 whitespace-nowrap text-[14px] font-bold text-ink">Users</h2>
          <div className="mt-0.5 text-[12px] text-ink-muted">{note ?? `${list.length} ${list.length === 1 ? "person" : "people"} · ${invited} invited`}</div>
        </div>
        <button
          type="button"
          onClick={() => { setNote(null); setDraft({ id: null, self: false, name: "", email: "", perms: setOf(PRESETS[dept].find((p) => p.id === "view")!.keys), how: "invite", password: "", mustChange: true }); }}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border-0 bg-primary px-[14px] text-[12.5px] font-semibold text-white transition-colors duration-[160ms] hover:bg-primary-ink"
        >
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />Add user
        </button>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              {["Name", "Access", "Status", "Last in"].map((h) => (
                <th key={h} className="sticky top-0 whitespace-nowrap border-b border-border bg-surface-2 px-[14px] py-2.5 text-left text-[11.5px] font-semibold text-ink-secondary">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const perms = setOf(u.perms);
              return (
                <tr key={u.id}
                  onClick={() => { setNote(null); setDraft({ id: u.id, self: u.self, name: u.name, email: u.email, perms, how: "invite", password: "", mustChange: true }); }}
                  className="cursor-pointer bg-surface hover:!bg-primary-soft/35">
                  <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-2.5 text-[13px]">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">{initials(u.name)}</span>
                      <div className="min-w-0">
                        <div className="font-semibold text-ink">{u.name}{u.self && <span className="ml-1.5 text-[11px] font-semibold text-ink-muted">You</span>}</div>
                        <div className="mt-px max-w-[220px] truncate text-[12px] text-ink-muted">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-2.5 text-[13px]">
                    <div className="font-semibold text-ink">{presetOf(dept, perms)}</div>
                    <div className="mt-px text-[12px] text-ink-muted">{effective(dept, perms).length} of {total} permissions</div>
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-2.5 text-[13px]">
                    <Badge b={u.status === "active" ? { label: "Active", tone: "success" } : { label: "Invited", tone: "warning" }} />
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-[14px] py-2.5 text-[13px] text-ink-secondary">{u.lastLoginAt ? fmtStamp(u.lastLoginAt).slice(5) : "Not yet"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UserForm({ dept, draft: d, setDraft, list, busy, onSave, onRemove, onClose }: {
  dept: Department;
  draft: Draft;
  setDraft: (d: Draft) => void;
  list: Person[];
  busy: boolean;
  onSave: (d: Draft) => void;
  onRemove: (d: Draft) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    play(ref.current, [{ opacity: 0, transform: "translateX(16px)" }, { opacity: 1, transform: "none" }], 280);
  }, []);
  const isNew = d.id === null;
  const dupe = isNew && list.some((u) => u.email.toLowerCase() === d.email.trim().toLowerCase());
  const canSave = !!d.name.trim() && isEmail(d.email.trim()) && !dupe && (!isNew || d.how !== "password" || d.password.length >= 10) && !busy;
  const on = effective(dept, d.perms).length;
  const note = dupe ? "This email already has an account."
    : isNew ? (d.how === "password" ? (d.password.length < 10 ? "Password needs at least 10 characters." : "They can sign in right away.") : "They get an email link to choose a password.")
      : `${on} permissions on`;
  const preset = presetOf(dept, d.perms);
  const flip = (k: string) => {
    const next = new Set(d.perms);
    if (next.has(k)) next.delete(k); else next.add(k);
    setDraft({ ...d, perms: next });
  };
  const radio = (which: "invite" | "password", title: string, sub: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5"
      style={{ borderColor: d.how === which ? "rgb(var(--hz-primary))" : "rgb(var(--hz-border))", background: d.how === which ? "rgba(220,230,253,0.35)" : "#fff" }}>
      <input type="radio" checked={d.how === which} onChange={() => setDraft({ ...d, how: which })} className="m-0 mt-0.5 accent-primary" />
      <span>
        <span className="block text-[12.5px] font-bold text-ink">{title}</span>
        <span className="mt-0.5 block text-[11.5px] text-ink-muted">{sub}</span>
      </span>
    </label>
  );

  return (
    <section ref={ref} className={cn(CARD, "flex flex-col overflow-hidden")}>
      <header className="flex items-center gap-2 border-b border-border py-3 pl-[18px] pr-3">
        <button type="button" onClick={onClose} title="Back to users" aria-label="Back to users" className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border bg-surface text-ink-secondary hover:border-primary">
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <h2 className="m-0 flex-1 text-[14px] font-bold text-ink">{isNew ? "Add user" : d.self ? "Your access" : `Edit ${d.name}`}</h2>
        <button type="button" onClick={onClose} title="Close" aria-label="Close" className="flex h-[30px] w-[30px] items-center justify-center rounded-md border-0 bg-transparent text-ink-muted hover:bg-border-subtle hover:text-ink">
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="grid items-start md:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-[14px] border-r border-border-subtle p-[18px]">
          <div className="grid gap-3">
            <label>
              <span className="mb-1.5 block text-[12px] font-semibold text-ink">Name</span>
              <input value={d.name} readOnly={d.self} onChange={(e) => setDraft({ ...d, name: e.target.value })} placeholder="Full name" className={INPUT} />
            </label>
            <label>
              <span className="mb-1.5 block text-[12px] font-semibold text-ink">Email</span>
              <input type="email" value={d.email} readOnly={!isNew} onChange={(e) => setDraft({ ...d, email: e.target.value })} placeholder="name@company.com" className={INPUT} style={{ background: isNew ? "#fff" : "rgb(var(--hz-surface-2))" }} />
            </label>
          </div>
          {isNew && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink">How they sign in</div>
              <div className="flex flex-col gap-1.5">
                {radio("invite", "Send invite email", "They choose their own password from the link")}
                {radio("password", "Set password now", "You give them the password yourself")}
              </div>
              {d.how === "password" && (
                <div className="mt-2.5 flex flex-col gap-2">
                  <input type="password" autoComplete="new-password" value={d.password} onChange={(e) => setDraft({ ...d, password: e.target.value })} placeholder="Password (at least 10 characters)" className={INPUT} />
                  <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-secondary">
                    <input type="checkbox" checked={d.mustChange} onChange={() => setDraft({ ...d, mustChange: !d.mustChange })} className="m-0 accent-primary" />
                    Ask them to change it at first sign in
                  </label>
                </div>
              )}
            </div>
          )}
          <div className="text-[12px] font-semibold text-ink">Access</div>
          <div className="-mt-2 grid gap-1.5">
            {PRESETS[dept].map((p) => {
              const active = preset === p.label;
              return (
                <button key={p.id} type="button" disabled={d.self} onClick={() => setDraft({ ...d, perms: setOf(p.keys) })}
                  className="rounded-lg border px-2.5 py-[9px] text-left transition-all duration-150 hover:border-primary disabled:cursor-not-allowed"
                  style={{ borderColor: active ? "rgb(var(--hz-primary))" : "rgb(var(--hz-border))", background: active ? "rgba(220,230,253,0.4)" : "#fff" }}>
                  <div className="text-[12.5px] font-bold text-ink">{p.label}</div>
                  <div className="mt-0.5 whitespace-normal text-[11px] text-ink-muted">{p.sub}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-[18px] lg:grid-cols-2">
          {GROUPS[dept].map((g) => (
            <div key={g.title}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{g.title}</div>
              {g.items.map((it, i) => {
                const pageOff = !!it.need && !d.perms.has(it.need);
                const blocked = pageOff || (d.self && it.k === "a_users");
                const onNow = d.perms.has(it.k) && !pageOff;
                return (
                  <Toggle key={it.k} label={it.label} desc={pageOff ? "Needs the page turned on first" : it.desc} on={onNow} blocked={blocked} first={i === 0} onFlip={() => { if (!blocked) flip(it.k); }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-[18px] py-3">
        {!isNew && !d.self && (
          <button type="button" disabled={busy} onClick={() => onRemove(d)} className="h-9 rounded-lg border border-err/35 bg-surface px-3 text-[12.5px] font-semibold text-err hover:bg-err/[0.06]">Remove access</button>
        )}
        <span className="flex-1 text-[11.5px] text-ink-muted">{note}</span>
        <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border bg-surface px-[14px] text-[12.5px] font-semibold text-ink-secondary">Cancel</button>
        <button type="button" disabled={!canSave} onClick={() => onSave(d)}
          className="h-9 rounded-lg border-0 px-4 text-[12.5px] font-semibold text-white"
          style={{ background: canSave ? "rgb(var(--hz-primary))" : "rgba(27,27,57,0.35)", cursor: canSave ? "pointer" : "not-allowed" }}>
          {busy ? "Saving" : !isNew ? "Save changes" : d.how === "password" ? "Create user" : "Send invite"}
        </button>
      </div>
    </section>
  );
}

function Toggle({ label, desc, on, blocked, first, onFlip }: { label: string; desc: ReactNode; on: boolean; blocked: boolean; first: boolean; onFlip: () => void }) {
  return (
    <div className="flex items-center gap-3 py-[9px]" style={{ borderTop: first ? "0" : "1px solid rgb(var(--hz-border-subtle))", opacity: blocked ? 0.5 : 1 }}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ink">{label}</div>
        <div className="mt-px text-[11.5px] text-ink-muted">{desc}</div>
      </div>
      <span
        role="switch"
        aria-checked={on}
        aria-disabled={blocked}
        aria-label={label}
        tabIndex={blocked ? -1 : 0}
        onClick={(e) => { e.preventDefault(); onFlip(); }}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onFlip(); } }}
        className="relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer rounded-full transition-colors duration-200"
        style={{ background: on ? "rgb(var(--hz-primary))" : "rgb(var(--hz-border-strong))", cursor: blocked ? "not-allowed" : "pointer" }}
      >
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)]"
          style={{ transform: on ? "translateX(14px)" : "none", transition: "transform 220ms cubic-bezier(0.16,1,0.3,1)" }} />
      </span>
    </div>
  );
}
