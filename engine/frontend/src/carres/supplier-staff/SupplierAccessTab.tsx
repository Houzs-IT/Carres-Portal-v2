// Carres only (not part of Houzs's code): Settings › Supplier Access.
//
// Carres decides here, per supplier: whether it may sign in to its own pages (/supplier), which Sales Orders it is
// shared (by product category, by product, or its own bound items), whether it is the supplier paid a share of
// subscription collections, and which of its people hold which role (Warehouse and Operation, Finance).
//
// A supplier person is NOT a Team member: they never get a staff login, and nothing here gives them one. Their
// password is theirs alone: Carres sends a one-time link and the person chooses it.
import { useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Plus, Search, X as XIcon } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { useToast } from "../../hooks/useToast";
import { useDialog } from "../../hooks/useDialog";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ListSkeleton } from "../../components/Skeleton";
import { cn } from "../../lib/utils";
import { fmtStamp, plural } from "../supplier/ui";
import {
  accessApi, type AccessDetail, type AccessInput, type AccessOptions, type ActivityRow, type Preview, type SetupLink,
  type SupplierPerson, type LinkMail,
} from "./staffApi";

/** A moment in the engine's one date format ("2026/11/20 10:30", Kuala Lumpur time); "" when there is none. */
const stamp = (iso: string | null): string => fmtStamp(iso);
const problem = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const titleCase = (s: string): string => s.toLowerCase().replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

const EVENT_WORDS: Record<string, string> = {
  signin: "Signed in",
  signin_failed: "Sign-in failed",
  password_set: "Chose a password",
  password_changed: "Changed password",
  link_issued: "Set-password link made",
  // Forgot password, on the supplier's sign-in page: the person asked, and the link was or was not emailed.
  reset_requested: "Asked for a password link",
  reset_mailed: "Password link emailed",
  reset_not_mailed: "Password link not emailed",
  person_added: "Person added",
  person_changed: "Person changed",
  access_saved: "Access saved",
  pickup_requested: "Pickup requested",
  pickup_accepted: "Pickup accepted",
  pickup_collected: "Pickup collected",
  pickup_cancelled: "Pickup cancelled",
  // The supplier's asks on an accepted pickup, and Carres's answers (Supplier Pickups).
  pickup_date_asked: "Asked to move a pickup",
  pickup_cancel_asked: "Asked to cancel a pickup",
  pickup_ask_withdrawn: "Took back an ask",
  pickup_ask_approved: "Ask approved",
  pickup_ask_declined: "Ask declined",
};

const SECTION = "rounded-lg border border-border bg-surface";
const SECTION_HEAD = "border-b border-border-subtle px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted";
const INPUT = "h-9 w-full rounded-md border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20";

function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5", disabled && "cursor-not-allowed opacity-60")}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-secondary">{hint}</span>}
      </span>
    </label>
  );
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** The one-time link, shown once. Carres sends it to the person; only they open it. */
export function LinkNotice({ name, link, mail, onDone }: { name: string; link: SetupLink; mail?: LinkMail; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="rounded-lg border border-primary/30 bg-primary-soft/40 px-4 py-3">
      <div className="text-[13px] font-semibold text-ink">Link for {name}</div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">
        {mail?.mailed
          ? <>Emailed to them. It lets them choose their own password and works once, until {stamp(link.expiresAt)}. You can also WhatsApp this link; it is shown only now.</>
          : <>{mail?.mailNote ? `Not emailed: ${mail.mailNote} ` : ""}WhatsApp or email it to them: it lets them choose their own password. It works once, until {stamp(link.expiresAt)}, and is shown only now: copy it before closing.</>}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className={cn(INPUT, "font-mono text-[11.5px]")} aria-label="Set-password link" />
        <Button variant="secondary" icon={<Copy size={13} />} onClick={async () => (await copyText(link.url)) ? toast.success("Link copied") : toast.error("Could not copy. Select the link and copy it.")}>Copy</Button>
        <Button variant="ghost" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function People({ supplierId, people, onChanged }: { supplierId: string; people: SupplierPerson[]; onChanged: () => void }) {
  const toast = useToast();
  const dialog = useDialog();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [operation, setOperation] = useState(true);
  const [finance, setFinance] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; link: SetupLink; mail?: LinkMail } | null>(null);

  const add = async () => {
    if (busy) return;
    setBusy("add");
    try {
      const out = await accessApi.addPerson(supplierId, { name, email, canOperation: operation, canFinance: finance });
      setLink({ name: out.person.name, link: out.link, mail: out });
      setAdding(false); setName(""); setEmail(""); setOperation(true); setFinance(false);
      onChanged();
    } catch (e) { toast.error(problem(e)); } finally { setBusy(null); }
  };

  const patch = async (p: SupplierPerson, body: Parameters<typeof accessApi.updatePerson>[1], done: string) => {
    if (busy) return;
    setBusy(`p${p.id}`);
    try { await accessApi.updatePerson(p.id, body); toast.success(done); onChanged(); }
    catch (e) { toast.error(problem(e)); } finally { setBusy(null); }
  };

  const newLink = async (p: SupplierPerson) => {
    if (busy) return;
    if (p.hasPassword && !(await dialog.confirm({
      title: `New password link for ${p.name}?`,
      message: "Their current password keeps working until they use the link. Using it signs them out everywhere.",
      confirmLabel: "Make link",
    }))) return;
    setBusy(`p${p.id}`);
    try { const out = await accessApi.newLink(p.id); setLink({ name: p.name, link: out.link, mail: out }); onChanged(); }
    catch (e) { toast.error(problem(e)); } finally { setBusy(null); }
  };

  const toggle = async (p: SupplierPerson) => {
    if (p.status === "active") {
      if (!(await dialog.confirm({ title: `Disable ${p.name}?`, message: "They are signed out at once and cannot sign in until enabled again.", confirmLabel: "Disable", danger: true }))) return;
      await patch(p, { status: "disabled" }, `${p.name} is disabled`);
    } else {
      await patch(p, { status: "active" }, `${p.name} is enabled`);
    }
  };

  return (
    <section className={SECTION}>
      <div className={cn(SECTION_HEAD, "flex items-center justify-between")}>
        <span>People</span>
        {!adding && <Button variant="secondary" className="h-7 px-2.5 text-[11.5px]" icon={<Plus size={12} />} onClick={() => setAdding(true)}>Add person</Button>}
      </div>
      {link && <div className="border-b border-border-subtle p-4"><LinkNotice name={link.name} link={link.link} mail={link.mail} onDone={() => setLink(null)} /></div>}
      {adding && (
        <div className="space-y-3 border-b border-border-subtle p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-[12px] font-semibold text-ink">Name</span><input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
            <label className="block"><span className="mb-1 block text-[12px] font-semibold text-ink">Email</span><input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@supplier.com" /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Check checked={operation} onChange={setOperation} label="Warehouse and Operation" hint="Sales Orders, Forecast and Pickup Requests." />
            <Check checked={finance} onChange={setFinance} label="Finance" hint="Subscription collections and the supplier's share." />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={add} disabled={busy === "add" || !name.trim() || !email.trim() || (!operation && !finance)}>{busy === "add" ? "Adding" : "Add and make link"}</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {people.length === 0 && !adding ? (
        <div className="px-4 py-6 text-[12.5px] text-ink-muted">Nobody from this supplier can sign in yet. Add a person to give them a link.</div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {people.map((p) => (
            <li key={p.id} className={cn("flex flex-wrap items-start justify-between gap-3 px-4 py-3", p.status === "disabled" && "opacity-60")}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink">{p.name}</span>
                  {p.status === "disabled" && <Badge tone="neutral" size="sm" caseless>Disabled</Badge>}
                  {!p.hasPassword && p.status === "active" && <Badge tone="warning" size="sm" caseless>{p.linkExpiresAt ? "Waiting for them to choose a password" : "No password, link expired"}</Badge>}
                </div>
                <div className="mt-0.5 break-words text-[11.5px] text-ink-secondary">{p.email}</div>
                <div className="mt-0.5 text-[11px] text-ink-muted">{p.lastLoginAt ? `Last signed in ${stamp(p.lastLoginAt)}` : "Never signed in"}</div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
                  <label className="flex items-center gap-1.5 text-[12px] text-ink">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={p.canOperation} disabled={!!busy || p.status === "disabled" || (p.canOperation && !p.canFinance)}
                      onChange={(e) => patch(p, { canOperation: e.target.checked }, "Roles saved")} /> Warehouse and Operation
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] text-ink">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={p.canFinance} disabled={!!busy || p.status === "disabled" || (p.canFinance && !p.canOperation)}
                      onChange={(e) => patch(p, { canFinance: e.target.checked }, "Roles saved")} /> Finance
                  </label>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p.status === "active" && <Button variant="secondary" className="h-8 px-3" icon={<KeyRound size={13} />} disabled={!!busy} onClick={() => newLink(p)}>{p.hasPassword ? "New password link" : "New link"}</Button>}
                <Button variant={p.status === "active" ? "danger" : "secondary"} className="h-8 px-3" disabled={!!busy} onClick={() => toggle(p)}>{p.status === "active" ? "Disable" : "Enable"}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Picker<T extends { name: string; category: string }>({
  label, placeholder, all, chosen, idOf, codeOf, onAdd, onRemove,
}: {
  label: string;
  placeholder: string;
  all: T[];
  chosen: T[];
  idOf: (x: T) => string;
  codeOf: (x: T) => string;
  onAdd: (x: T) => void;
  onRemove: (x: T) => void;
}) {
  const [q, setQ] = useState("");
  const chosenIds = useMemo(() => new Set(chosen.map(idOf)), [chosen, idOf]);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return all.filter((x) => !chosenIds.has(idOf(x)) && (`${codeOf(x)} ${x.name}`).toLowerCase().includes(needle)).slice(0, 8);
  }, [q, all, chosenIds, idOf, codeOf]);
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-ink">{label}</div>
      {chosen.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chosen.map((x) => (
            <span key={idOf(x)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 py-1 pl-2 pr-1 text-[11.5px] text-ink">
              <span className="font-mono text-ink-muted">{codeOf(x)}</span> {x.name}
              <button type="button" onClick={() => onRemove(x)} className="rounded p-0.5 text-ink-muted hover:bg-err/10 hover:text-err" aria-label={`Remove ${x.name}`}><XIcon size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative max-w-md">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input className={cn(INPUT, "pl-8")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={label} />
        {matches.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-slab">
            {matches.map((x) => (
              <li key={idOf(x)}>
                <button type="button" onClick={() => { onAdd(x); setQ(""); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12.5px] hover:bg-surface-2">
                  <span className="min-w-0 truncate"><span className="font-mono text-ink-muted">{codeOf(x)}</span> {x.name}</span>
                  <span className="shrink-0 text-[10.5px] text-ink-muted">{titleCase(x.category)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Editor({ supplierId, options, onSaved }: { supplierId: string; options: AccessOptions; onSaved: () => void }) {
  const toast = useToast();
  const detail = useQuery(`carres-supplier-access:${supplierId}`, () => accessApi.get(supplierId));
  const share = useQuery("carres-supplier-access:subscription-share", () => accessApi.subscriptionShare());
  const [draft, setDraft] = useState<AccessDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const saved = detail.data?.access ?? null;

  useEffect(() => { if (saved) setDraft(saved); }, [saved]);

  const input = useMemo<AccessInput | null>(() => (draft ? {
    enabled: draft.enabled, ownItems: draft.ownItems, subscriptionShare: draft.subscriptionShare,
    categories: draft.categories, modelIds: draft.models.map((m) => m.id), skuCodes: draft.skus.map((s) => s.code),
  } : null), [draft]);
  const scopeKey = input ? JSON.stringify([input.ownItems, input.categories, input.modelIds, input.skuCodes]) : "";
  const nothingShared = !!input && !input.ownItems && !input.categories.length && !input.modelIds.length && !input.skuCodes.length;
  /** A 3PL's billing supplier sees its own Deliveries, so it signs in with no Sales Orders shared (owner, 19 Nov 2026). */
  const logistics = !!saved?.logistics;

  // What the supplier would see with the scope on screen, counted by the server a moment after the last change.
  useEffect(() => {
    if (!input || nothingShared) { setPreview(null); return; }
    let alive = true;
    const t = window.setTimeout(() => {
      accessApi.preview(supplierId, input).then((r) => { if (alive) setPreview(r.preview); }, () => { if (alive) setPreview(null); });
    }, 400);
    return () => { alive = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeKey is the scope; the switches beside it do not change the count
  }, [supplierId, scopeKey]);

  if (detail.error) return <div className="rounded-lg border border-err/30 bg-err/5 px-4 py-3 text-[12.5px] text-err">{detail.error}</div>;
  if (!draft || !saved || !input) return <ListSkeleton rows={4} />;

  const dirty = JSON.stringify(input) !== JSON.stringify({
    enabled: saved.enabled, ownItems: saved.ownItems, subscriptionShare: saved.subscriptionShare,
    categories: saved.categories, modelIds: saved.models.map((m) => m.id), skuCodes: saved.skus.map((s) => s.code),
  });
  const set = (patch: Partial<AccessDetail>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await accessApi.save(supplierId, input);
      toast.success(input.enabled ? `${draft.name} can sign in and sees what is ticked` : `${draft.name}'s access is off`);
      detail.reload();
      onSaved();
    } catch (e) { toast.error(problem(e)); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <section className={SECTION}>
        <div className={SECTION_HEAD}>Access</div>
        <div className="p-4">
          <Check
            checked={draft.enabled}
            onChange={(v) => set({ enabled: v })}
            label={`${draft.name} may sign in`}
            hint="Off: nobody from this supplier can sign in, and anyone signed in is out at once. Their people and settings are kept."
          />
        </div>
      </section>

      <section className={SECTION}>
        <div className={SECTION_HEAD}>Sales Orders this supplier sees</div>
        <div className="space-y-5 p-4">
          <p className="text-[12px] leading-relaxed text-ink-secondary">
            A Sales Order is shared when it has at least one line that matches below. The supplier sees only its matching lines of that order, with the
            customer's name and delivery address and the dates. It never sees a price, a payment, a phone number or another supplier's lines. Drafts are never shared.
          </p>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-ink">Product categories</div>
            <div className="flex flex-wrap gap-1.5">
              {options.categories.map((c) => {
                const on = draft.categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ categories: on ? draft.categories.filter((x) => x !== c) : [...draft.categories, c] })}
                    className={cn("rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors", on ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink-secondary hover:border-border-strong hover:text-ink")}
                  >
                    {titleCase(c)}
                  </button>
                );
              })}
            </div>
          </div>
          <Picker
            label="Products"
            placeholder="Search a product model to add"
            all={options.models}
            chosen={draft.models}
            idOf={(m) => m.id}
            codeOf={(m) => m.code}
            onAdd={(m) => set({ models: [...draft.models, m] })}
            onRemove={(m) => set({ models: draft.models.filter((x) => x.id !== m.id) })}
          />
          <Picker
            label="Single items"
            placeholder="Search an item code or name to add"
            all={options.skus}
            chosen={draft.skus}
            idOf={(s) => s.code}
            codeOf={(s) => s.code}
            onAdd={(s) => set({ skus: [...draft.skus, s] })}
            onRemove={(s) => set({ skus: draft.skus.filter((x) => x.code !== s.code) })}
          />
          <Check
            checked={draft.ownItems}
            onChange={(v) => set({ ownItems: v })}
            label="Its own items"
            hint={`Orders with the items bound to this supplier under Suppliers › Items (${draft.boundItemCount} now). The narrowest choice: it follows the bindings as they change.`}
          />
          <div className={cn("rounded-md border px-3 py-2.5 text-[12.5px]", nothingShared ? "border-border bg-surface-2 text-ink-muted" : "border-primary/30 bg-primary-soft/40 text-ink")}>
            {nothingShared && logistics ? "A 3PL company bills Carres through this supplier: its people see their Deliveries, and no Sales Orders."
              : nothingShared ? "Nothing is ticked: this supplier would see no Sales Orders."
              : preview ? <>With this, the supplier sees <span className="font-bold">{preview.orders.toLocaleString()}</span> {plural(preview.orders, "Sales Order")} today ({preview.incomingOrders.toLocaleString()} incoming), <span className="font-bold">{preview.units.toLocaleString()}</span> {plural(preview.units, "unit")} on {preview.lines.toLocaleString()} {plural(preview.lines, "line")}.</>
                : "Counting what the supplier would see"}
          </div>
        </div>
      </section>

      <section className={SECTION}>
        <div className={SECTION_HEAD}>Finance</div>
        <div className="space-y-3 p-4">
          <Check
            checked={draft.subscriptionShare}
            onChange={(v) => set({ subscriptionShare: v })}
            label="This supplier is paid a share of subscription collections"
            hint="Its Finance people see every subscription order: its value, each month collected, what is still to come, and who is behind. One supplier holds this at a time."
          />
          <p className="pl-[26px] text-[11.5px] leading-relaxed text-ink-muted">
            {share.data?.available && share.data.rates?.length
              ? `The share is set on each subscription plan, not here. In use on ${share.data.orders ?? 0} orders now: ${share.data.rates.map((r) => `${r}%`).join(", ")} of each month collected.`
              : "The share is set on each subscription plan, not here, and is kept on the agreement when the customer signs."}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving || !dirty || (draft.enabled && nothingShared && !logistics)}>{saving ? "Saving" : "Save"}</Button>
        {dirty && <Button variant="ghost" onClick={() => setDraft(saved)}>Discard changes</Button>}
        {draft.enabled && nothingShared && !logistics && <span className="text-[12px] text-err">Tick what this supplier sees before turning access on.</span>}
        {!dirty && saved.saved && <span className="text-[12px] text-ink-muted">Saved</span>}
      </div>

      <People supplierId={supplierId} people={saved.users} onChanged={() => { detail.reload(); onSaved(); }} />

      <Activity rows={detail.data?.activity ?? []} />
    </div>
  );
}

function Activity({ rows }: { rows: ActivityRow[] }) {
  return (
    <section className={SECTION}>
      <div className={SECTION_HEAD}>Latest activity</div>
      {rows.length === 0 ? <div className="px-4 py-6 text-[12.5px] text-ink-muted">Nothing yet.</div> : (
        <ul className="divide-y divide-border-subtle">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-[12.5px]">
              <span className={cn("text-ink", (r.kind === "signin_failed" || r.kind === "reset_not_mailed") && "text-err")}>
                {EVENT_WORDS[r.kind] ?? r.kind}
                {r.subject ? <span className="text-ink-secondary"> · {r.subject}</span> : null}
                {r.who ? <span className="text-ink-muted"> · {r.who}</span> : null}
                {/* Why the link was not emailed, so Carres can make one by hand (New password link). */}
                {r.note ? <span className="text-ink-secondary"> · {r.note}</span> : null}
              </span>
              {/* The address is there only when the server could tell this caller from another (backend callerAddress). */}
              <span className="text-[11.5px] text-ink-muted">{stamp(r.at)}{r.ip ? ` · ${r.ip}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SupplierAccessTab() {
  const toast = useToast();
  const list = useQuery("carres-supplier-access:list", () => accessApi.list());
  const options = useQuery("carres-supplier-access:options", () => accessApi.options());
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState("");

  const rows = list.data?.suppliers ?? [];
  const known = useMemo(() => new Set(rows.map((r) => r.supplierId)), [rows]);
  const addable = useMemo(() => (options.data?.suppliers ?? []).filter((s) => !known.has(s.id)), [options.data, known]);
  const selectedName = rows.find((r) => r.supplierId === selected)?.name ?? options.data?.suppliers.find((s) => s.id === selected)?.name ?? "";

  if (list.error) return <div className="rounded-lg border border-err/30 bg-err/5 px-4 py-3 text-[12.5px] text-err">{list.error}</div>;
  if (!list.data || !options.data) return <ListSkeleton rows={4} />;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
        <div className="text-[12.5px] leading-relaxed text-ink-secondary">
          Suppliers sign in at their own address, not the staff portal. They are not Team members and get no staff access.
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input readOnly value={list.data.signInUrl} onFocus={(e) => e.currentTarget.select()} className={cn(INPUT, "max-w-md font-mono text-[11.5px]")} aria-label="Supplier sign-in address" />
          <Button variant="secondary" icon={<Copy size={13} />} onClick={async () => (await copyText(list.data!.signInUrl)) ? toast.success("Address copied") : toast.error("Could not copy. Select the address and copy it.")}>Copy</Button>
        </div>
      </div>

      <section className={SECTION}>
        <div className={SECTION_HEAD}>Suppliers</div>
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-[12.5px] text-ink-muted">No supplier has access yet. Choose one below to set it up.</div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {rows.map((r) => (
              <li key={r.supplierId}>
                <button
                  type="button"
                  onClick={() => setSelected(selected === r.supplierId ? null : r.supplierId)}
                  aria-expanded={selected === r.supplierId}
                  className={cn("flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2", selected === r.supplierId && "bg-primary-soft/40")}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink">{r.name}</span>
                      <span className="font-mono text-[11px] text-ink-muted">{r.code}</span>
                      <Badge tone={r.enabled ? "success" : "neutral"} size="sm" caseless>{r.enabled ? "Access on" : "Access off"}</Badge>
                      {r.subscriptionShare && <Badge tone="accent" size="sm" caseless>Subscription share</Badge>}
                      {r.logistics && <Badge tone="neutral" size="sm" caseless>3PL</Badge>}
                    </span>
                    <span className="mt-1 block text-[11.5px] text-ink-secondary">
                      {[
                        r.categories.length ? r.categories.map(titleCase).join(", ") : null,
                        r.modelCount ? `${r.modelCount} product${r.modelCount === 1 ? "" : "s"}` : null,
                        r.skuCount ? `${r.skuCount} item${r.skuCount === 1 ? "" : "s"}` : null,
                        r.ownItems ? "its own items" : null,
                      ].filter(Boolean).join(" · ") || "Nothing shared"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11.5px] text-ink-muted">
                    <span className="block">{r.userCount} {r.userCount === 1 ? "person" : "people"}</span>
                    <span className="block">{r.lastSignInAt ? `Last sign-in ${stamp(r.lastSignInAt)}` : "No sign-in yet"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3">
          <select className={cn(INPUT, "max-w-sm")} value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Supplier to set up">
            <option value="">Choose a supplier to set up</option>
            {addable.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
          </select>
          <Button variant="secondary" icon={<Plus size={13} />} disabled={!adding} onClick={() => { setSelected(adding); setAdding(""); }}>Set up</Button>
        </div>
      </section>

      {selected && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[16px] font-bold text-ink">{selectedName}</h2>
            <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </div>
          <Editor key={selected} supplierId={selected} options={options.data} onSaved={() => list.reload()} />
        </div>
      )}
    </div>
  );
}
