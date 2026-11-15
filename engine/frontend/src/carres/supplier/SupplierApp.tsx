// Carres only (not part of Houzs's code): the Supplier Platform, the pages a supplier signs in to (/supplier/*).
//
// A public surface of its own (routing/appSurface.ts), OUTSIDE the staff sign-in: none of the staff app, its
// providers or its client is loaded here. A supplier person sees two areas, by the roles Carres gave them in
// Settings › Supplier Access: Warehouse and Operation (Sales Orders, Forecast, Pickup requests) and Finance.
import { createContext, lazy, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { KeyRound, LogOut } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/Button";
import { LazySlot } from "../../components/LazySlot";
import { usePublicCompany } from "../publicBranding";
import { onSignedOut, supplierApi, supplierToken, SupplierApiError, type Me } from "./api";
import { Card, LoadError, Loading, PageTitle } from "./ui";

const OrdersPage = lazy(() => import("./OrdersPage").then((m) => ({ default: m.OrdersPage })));
const OrderDetailPage = lazy(() => import("./OrdersPage").then((m) => ({ default: m.OrderDetailPage })));
const ForecastPage = lazy(() => import("./ForecastPage").then((m) => ({ default: m.ForecastPage })));
const PickupsPage = lazy(() => import("./PickupsPage").then((m) => ({ default: m.PickupsPage })));
const FinancePage = lazy(() => import("./FinancePage").then((m) => ({ default: m.FinancePage })));
const FinanceOrderPage = lazy(() => import("./FinancePage").then((m) => ({ default: m.FinanceOrderPage })));

const LOGO = "/logo-wordmark.png";

interface Session { me: Me; refresh: () => void; signOut: () => void }
const SessionContext = createContext<Session | null>(null);
export function useSupplierSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSupplierSession outside the supplier app");
  return s;
}

/** Where a person lands: the first area their roles open. */
const homeFor = (me: Me): string => (me.user.canOperation ? "/supplier/orders" : "/supplier/finance");

// ── Sign in, and choosing a password ────────────────────────────────────────────────────────────────────────────

function AuthFrame({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  const company = usePublicCompany();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src={LOGO} alt={company.companyName} className="h-10 w-auto max-w-[180px] object-contain" draggable={false} />
          <div className="font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">Supplier sign in</div>
        </div>
        <div className="rounded-xl border border-border bg-surface px-6 py-6 shadow-stone">
          <h1 className="text-[18px] font-bold text-ink">{title}</h1>
          {intro && <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">{intro}</p>}
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-4 text-center text-[11.5px] text-ink-muted">
          Cannot sign in? Ask your {company.companyName} contact for a new link.
        </p>
      </div>
    </div>
  );
}

const INPUT = "h-10 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20";

function TextField({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-ink">{label}</span>
      <input {...rest} className={INPUT} />
    </label>
  );
}

function LoginPage({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const location = useLocation();
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await supplierApi.signIn(email, password);
      supplierToken.set(out.token);
      onSignedIn({ user: out.user, supplier: out.supplier, badges: out.badges });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign in">
      {notice && <div className="mb-4 rounded-md border border-synced/30 bg-synced/10 px-3 py-2 text-[12.5px] text-synced">{notice}</div>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div role="alert" className="rounded-md border border-err/30 bg-err/5 px-3 py-2 text-[12.5px] text-err">{error}</div>}
        <Button type="submit" className="h-10 w-full" disabled={busy || !email || !password}>{busy ? "Signing in" : "Sign in"}</Button>
      </form>
    </AuthFrame>
  );
}

/** The link Carres sends carries its secret after the `#`, which a browser never sends to a server. It is read once
 *  and taken out of the address bar at once, so it is not left in the history or copied by accident. */
function readLinkToken(): string {
  const m = /[#&]t=([^&]+)/.exec(window.location.hash);
  const token = m ? decodeURIComponent(m[1]!) : "";
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

function SetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(readLinkToken);
  const [who, setWho] = useState<{ name: string; email: string; purpose: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!token) { setInvalid("This link is not complete. Open the link Carres sent you again, or ask for a new one."); return; }
    supplierApi.readLink(token).then(
      (w) => { if (alive) setWho(w); },
      (e: unknown) => { if (alive) setInvalid(e instanceof Error ? e.message : "This link is no longer valid."); },
    );
    return () => { alive = false; };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !who) return;
    if (password !== again) { setError("The two passwords are not the same."); return; }
    setBusy(true);
    setError(null);
    try {
      const out = await supplierApi.useLink(token, password);
      supplierToken.clear();
      navigate("/supplier/login", { replace: true, state: { email: out.email, notice: "Your password is set. Sign in with it." } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <AuthFrame title="This link cannot be used">
        <p className="text-[12.5px] leading-relaxed text-ink-secondary">{invalid}</p>
      </AuthFrame>
    );
  }
  if (!who) return <AuthFrame title="Checking your link"><p className="text-[12.5px] text-ink-muted">One moment.</p></AuthFrame>;
  return (
    <AuthFrame
      title={who.purpose === "reset" ? "Choose a new password" : "Choose your password"}
      intro={<>For <span className="font-semibold text-ink">{who.name}</span> ({who.email}). This link works once.</>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <TextField label="Password again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        <p className="text-[11.5px] text-ink-muted">Use at least 10 characters. A few words together are strong and easy to remember.</p>
        {error && <div role="alert" className="rounded-md border border-err/30 bg-err/5 px-3 py-2 text-[12.5px] text-err">{error}</div>}
        <Button type="submit" className="h-10 w-full" disabled={busy || !password || !again}>{busy ? "Saving" : "Save password"}</Button>
      </form>
    </AuthFrame>
  );
}

function AccountPage() {
  const { me } = useSupplierSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (next !== again) { setError("The two new passwords are not the same."); return; }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const out = await supplierApi.changePassword(current, next);
      // Every other session ended; this browser carries on with its new one.
      supplierToken.set(out.token);
      setCurrent(""); setNext(""); setAgain("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title="Your account" description="Your sign-in details. Carres adds and removes people for your company." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="You">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 text-[13px]">
            <div><dt className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Name</dt><dd className="mt-1 text-ink">{me.user.name}</dd></div>
            <div><dt className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Email</dt><dd className="mt-1 break-words text-ink">{me.user.email}</dd></div>
            <div><dt className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Company</dt><dd className="mt-1 text-ink">{me.supplier.name}</dd></div>
            <div>
              <dt className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Roles</dt>
              <dd className="mt-1 text-ink">{[me.user.canOperation && "Warehouse and Operation", me.user.canFinance && "Finance"].filter(Boolean).join(" · ")}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Change password">
          <form onSubmit={submit} className="space-y-4 px-4 py-4" noValidate>
            <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <TextField label="New password again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            {error && <div role="alert" className="rounded-md border border-err/30 bg-err/5 px-3 py-2 text-[12.5px] text-err">{error}</div>}
            {done && <div className="rounded-md border border-synced/30 bg-synced/10 px-3 py-2 text-[12.5px] text-synced">Password changed. Other devices were signed out.</div>}
            <Button type="submit" disabled={busy || !current || !next || !again}>{busy ? "Saving" : "Change password"}</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

// ── The signed-in shell ─────────────────────────────────────────────────────────────────────────────────────────

function Shell({ children }: { children: ReactNode }) {
  const { me, signOut } = useSupplierSession();
  const company = usePublicCompany();
  const tabs = [
    ...(me.user.canOperation ? [
      { to: "/supplier/orders", label: "Sales Orders", badge: 0 },
      { to: "/supplier/forecast", label: "Forecast", badge: 0 },
      { to: "/supplier/pickups", label: "Pickup Requests", badge: me.badges.pickupsToAccept },
    ] : []),
    ...(me.user.canFinance ? [{ to: "/supplier/finance", label: "Finance", badge: 0 }] : []),
  ];
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6">
          <img src={LOGO} alt={company.companyName} className="h-8 w-auto max-w-[140px] object-contain" draggable={false} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-ink">{me.supplier.name}</div>
            <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Supplier</div>
          </div>
          <NavLink
            to="/supplier/account"
            className={({ isActive }) => cn("hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold sm:inline-flex", isActive ? "bg-primary-soft text-primary" : "text-ink-secondary hover:bg-surface-2 hover:text-ink")}
          >
            <KeyRound size={14} /> {me.user.name}
          </NavLink>
          <Button variant="secondary" className="h-8 px-3" icon={<LogOut size={13} />} onClick={signOut}>Sign out</Button>
        </div>
        <nav aria-label="Supplier pages" className="mx-auto max-w-[1400px] px-4 sm:px-6">
          <div className="no-scrollbar -mb-px flex items-center gap-1 overflow-x-auto [&>*]:shrink-0">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) => cn(
                  "flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-[12.5px] font-semibold transition-colors",
                  isActive ? "border-primary text-primary" : "border-transparent text-ink-secondary hover:text-ink",
                )}
              >
                {t.label}
                {t.badge > 0 && (
                  <span className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[9px] font-bold text-white" aria-label={`${t.badge} waiting`}>{t.badge}</span>
                )}
              </NavLink>
            ))}
            <NavLink
              to="/supplier/account"
              className={({ isActive }) => cn("border-b-2 px-4 py-2.5 text-[12.5px] font-semibold sm:hidden", isActive ? "border-primary text-primary" : "border-transparent text-ink-secondary")}
            >
              Account
            </NavLink>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function Only({ when, children }: { when: boolean; children: ReactNode }) {
  const { me } = useSupplierSession();
  return when ? <>{children}</> : <Navigate to={homeFor(me)} replace />;
}

export function SupplierApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"checking" | "out" | "in" | "error">(() => (supplierToken.get() ? "checking" : "out"));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!supplierToken.get()) { setState("out"); setMe(null); return; }
    let alive = true;
    supplierApi.me().then(
      (m) => { if (alive) { setMe(m); setState("in"); } },
      (e: unknown) => {
        if (!alive) return;
        // A refused session was already cleared by the client; anything else (no network) keeps the session to retry.
        setState(e instanceof SupplierApiError && e.status === 401 ? "out" : "error");
      },
    );
    return () => { alive = false; };
  }, [nonce]);

  useEffect(() => onSignedOut(() => { setMe(null); setState("out"); }), []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const signOut = useCallback(() => {
    void supplierApi.signOut().catch(() => undefined).finally(() => {
      supplierToken.clear();
      setMe(null);
      setState("out");
      navigate("/supplier/login", { replace: true });
    });
  }, [navigate]);
  const session = useMemo(() => (me ? { me, refresh, signOut } : null), [me, refresh, signOut]);

  const path = location.pathname.replace(/\/+$/, "");
  if (path === "/supplier/setup") return <SetPasswordPage />;

  if (state === "checking") return <div className="flex min-h-screen items-center justify-center bg-bg text-[12.5px] text-ink-muted">Loading</div>;
  if (state === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md"><LoadError message="The server could not be reached. Check your connection." onRetry={refresh} /></div>
      </div>
    );
  }
  if (state === "out" || !session) {
    if (path !== "/supplier/login") return <Navigate to="/supplier/login" replace state={location.state} />;
    return <LoginPage onSignedIn={(m) => { setMe(m); setState("in"); navigate(homeFor(m), { replace: true }); }} />;
  }

  const m = session.me;
  return (
    <SessionContext.Provider value={session}>
      <Shell>
        <Routes>
          <Route path="/supplier/orders" element={<Only when={m.user.canOperation}><Lazy><OrdersPage /></Lazy></Only>} />
          <Route path="/supplier/orders/:docNo" element={<Only when={m.user.canOperation}><Lazy><OrderDetailPage /></Lazy></Only>} />
          <Route path="/supplier/forecast" element={<Only when={m.user.canOperation}><Lazy><ForecastPage /></Lazy></Only>} />
          <Route path="/supplier/pickups" element={<Only when={m.user.canOperation}><Lazy><PickupsPage /></Lazy></Only>} />
          <Route path="/supplier/pickups/:id" element={<Only when={m.user.canOperation}><Lazy><PickupsPage /></Lazy></Only>} />
          <Route path="/supplier/finance" element={<Only when={m.user.canFinance}><Lazy><FinancePage /></Lazy></Only>} />
          <Route path="/supplier/finance/:id" element={<Only when={m.user.canFinance}><Lazy><FinanceOrderPage /></Lazy></Only>} />
          <Route path="/supplier/account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to={homeFor(m)} replace />} />
        </Routes>
      </Shell>
    </SessionContext.Provider>
  );
}

/** Each page is its own chunk: a person who only reads Finance never downloads the order pages. A chunk that cannot
 *  load after a deploy fails inside its own slot (components/LazySlot.tsx): the header and the menu stay, and
 *  moving to another page clears it. */
function Lazy({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <LazySlot resetKey={`supplier:${pathname}`} fallback={<Loading />}>{children}</LazySlot>;
}
