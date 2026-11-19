// Carres only (not part of Houzs's code): a 3PL company's login, on the 3PL company's own form (owner, 19 Nov 2026:
// "after I create the 3PL, fill in his email and open his account here").
//
// One step for staff: name + email → the 3PL's supplier is switched on, the person is added, and the set-password link
// (three days) is emailed to them. They then sign in at the supplier address and see only their own Deliveries.
// Shown only to staff who manage Settings (the server refuses the rest), so it stays out of everyone else's way.
import { useState } from "react";
import { Mail, Plus } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { useToast } from "../../hooks/useToast";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { fmtStamp } from "../supplier/ui";
import { LinkNotice } from "./SupplierAccessTab";
import { accessApi, type LinkMail, type SetupLink } from "./staffApi";

const INPUT = "h-9 w-full rounded-md border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20";

const problem = (e: unknown): string => (e instanceof Error && e.message ? e.message : "That did not work. Try again.");

export function ThreeplLoginPanel({ threeplId, defaultName = "", defaultEmail = "" }: {
  threeplId: string;
  /** The company's contact person and email, offered first so they are not typed twice. */
  defaultName?: string;
  defaultEmail?: string;
}) {
  const toast = useToast();
  const login = useQuery(`carres-threepl-login:${threeplId}`, () => accessApi.threepl(threeplId));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ name: string; link: SetupLink; mail: LinkMail } | null>(null);

  // A person without Settings access gets a refusal: the panel then simply is not there.
  if (login.error || !login.data) return null;
  const d = login.data;

  const invite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await accessApi.inviteThreepl(threeplId, { name, email });
      setLink({ name: out.person.name, link: out.link, mail: out });
      if (out.mailed) toast.success(`Invite emailed to ${out.person.email}`);
      setAdding(false); setName(""); setEmail("");
      login.reload();
    } catch (e) { toast.error(problem(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Login for this 3PL</div>
          <div className="text-[11.5px] text-ink-secondary">They sign in at 3pl.carresofficial.com and see only the deliveries on their own lorries.</div>
        </div>
        {d.supplier && !adding && <Button variant="secondary" className="h-8 px-3" icon={<Plus size={13} />} onClick={() => {
          const fresh = !d.people.some((p) => p.email.toLowerCase() === defaultEmail.trim().toLowerCase());
          setName(fresh ? defaultName : ""); setEmail(fresh ? defaultEmail : ""); setAdding(true);
        }}>Invite person</Button>}
      </div>

      {!d.supplier ? (
        <div className="px-4 py-3 text-[12.5px] text-ink-secondary">Choose this company's Supplier above and save, then you can invite its people.</div>
      ) : (
        <div className="space-y-3 px-4 py-3">
          {link && <LinkNotice name={link.name} link={link.link} mail={link.mail} onDone={() => setLink(null)} />}
          {adding && (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block"><span className="mb-1 block text-[12px] font-semibold text-ink">Name</span><input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
              <label className="block"><span className="mb-1 block text-[12px] font-semibold text-ink">Email</span><input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></label>
              <div className="flex gap-2">
                <Button icon={<Mail size={13} />} onClick={() => void invite()} disabled={busy || !name.trim() || !email.trim()}>{busy ? "Sending" : "Send invite"}</Button>
                <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          )}
          {d.people.length === 0 ? (
            !adding && <div className="text-[12.5px] text-ink-muted">Nobody from {d.threepl.name} can sign in yet.</div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {d.people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]">
                  <span className="font-semibold text-ink">{p.name}</span>
                  <span className="text-ink-secondary">{p.email}</span>
                  {p.status === "disabled"
                    ? <Badge tone="neutral" size="sm" caseless>Disabled</Badge>
                    : p.hasPassword
                      ? <Badge tone="success" size="sm" caseless>{p.lastLoginAt ? `Signed in ${fmtStamp(p.lastLoginAt)}` : "Password set"}</Badge>
                      : <Badge tone="warning" size="sm" caseless>Waiting for them to choose a password</Badge>}
                </li>
              ))}
            </ul>
          )}
          <div className="text-[11.5px] text-ink-muted">To disable someone or send a new link: Settings › Supplier Access › {d.supplier.name}.</div>
        </div>
      )}
    </div>
  );
}
