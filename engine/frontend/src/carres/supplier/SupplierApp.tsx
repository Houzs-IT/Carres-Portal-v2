// Carres only (not part of Houzs's code): the Supplier Platform, the pages a supplier signs in to (/supplier/*).
//
// A public surface of its own (routing/appSurface.ts), OUTSIDE the staff sign-in: none of the staff app, its
// providers or its client is loaded here. A supplier person sees the pages their access opens, in two departments:
// Warehouse and Operation (Sales Orders, Forecast, Pickup Requests) and Finance (Collections, By Month). Carres gives
// a supplier its first people in Settings › Supplier Access; from then on the supplier's own admins add people and set
// what each may see and do (Settings › Users and access), and the server checks the same on every request.
import "./supplier.css";
import { lazy, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { LazySlot } from "../../components/LazySlot";
import { usePublicCompany } from "../publicBranding";
import { onMustChangePassword, onSignedOut, supplierApi, supplierToken, SupplierApiError, type Department, type Me } from "./api";
import { forgetAll } from "./data";
import { homeFor, LOGO, makeCan, SessionProvider, Shell, type Session } from "./Shell";
import { LoadError, Loading, ToastProvider, useRise } from "./ui";

const OrdersPage = lazy(() => import("./OrdersPage").then((m) => ({ default: m.OrdersPage })));
const OrderPage = lazy(() => import("./OrdersPage").then((m) => ({ default: m.OrderPage })));
const ForecastPage = lazy(() => import("./ForecastPage").then((m) => ({ default: m.ForecastPage })));
const PickupsPage = lazy(() => import("./PickupsPage").then((m) => ({ default: m.PickupsPage })));
const DeliveriesPage = lazy(() => import("./DeliveriesPage").then((m) => ({ default: m.DeliveriesPage })));
const CollectionsPage = lazy(() => import("./FinancePage").then((m) => ({ default: m.CollectionsPage })));
const SubscriptionPage = lazy(() => import("./FinancePage").then((m) => ({ default: m.SubscriptionPage })));
const MonthsPage = lazy(() => import("./FinancePage").then((m) => ({ default: m.MonthsPage })));
const MonthPage = lazy(() => import("./FinancePage").then((m) => ({ default: m.MonthPage })));
const SettingsPage = lazy(() => import("./SettingsPage").then((m) => ({ default: m.SettingsPage })));

// ── Sign in, and choosing a password ────────────────────────────────────────────────────────────────────────────

function AuthFrame({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  const company = usePublicCompany();
  const card = useRef<HTMLDivElement | null>(null);
  useRise(card, title);
  return (
    <div className="sp-root flex min-h-[100dvh] flex-col bg-bg font-body text-ink antialiased">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div ref={card} className="w-full max-w-[400px]">
          <div className="mb-6 flex flex-col items-center gap-3">
            <img src={LOGO} alt={company.companyName} className="h-9 w-auto object-contain" draggable={false} />
            <div className="text-[10px] font-semibold uppercase tracking-brand text-ink-muted">Supplier sign in</div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-6 shadow-stone">
            <h1 className="m-0 text-[18px] font-bold text-ink">{title}</h1>
            {intro && <p className="m-0 mt-1.5 text-[12.5px] leading-[1.6] text-ink-secondary">{intro}</p>}
            <div className="mt-5">{children}</div>
          </div>
          <p className="mt-4 text-center text-[11.5px] text-ink-muted">Cannot sign in? Ask your {company.companyName} contact for a new link.</p>
        </div>
      </div>
    </div>
  );
}

const INPUT = "h-10 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-[160ms] placeholder:text-ink-muted focus:border-primary focus:shadow-[0_0_0_3px_rgba(27,27,57,0.12)]";
const TEXT_LINK = "rounded text-[12px] font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const PRIMARY = "inline-flex h-10 w-full items-center justify-center rounded-md border border-primary bg-primary text-[13px] font-semibold tracking-[0.025em] text-white transition-[background-color,border-color] duration-[160ms] hover:border-primary-ink hover:bg-primary-ink disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-primary disabled:hover:bg-primary";

function TextField({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-ink">{label}</span>
      <input {...rest} className={INPUT} />
    </label>
  );
}

const Alert = ({ children }: { children: ReactNode }) => (
  <div role="alert" className="rounded-md border border-err/30 bg-err/5 px-3 py-2 text-[12.5px] text-err">{children}</div>
);
const Notice = ({ children }: { children: ReactNode }) => (
  <div role="status" className="rounded-md border border-synced/30 bg-synced/10 px-3 py-2 text-[12.5px] leading-relaxed text-synced">{children}</div>
);

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
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    setError(null);
    try {
      const out = await supplierApi.signIn(email, password);
      supplierToken.set(out.token);
      onSignedIn(out.me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign in" intro="Your account opens the pages your company's role allows: Warehouse and Operation, or Finance.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {notice && <Notice>{notice}</Notice>}
        <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <div>
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {/* The email already typed goes along, so it is not typed twice. It travels in the page's own state, never
              in the address. */}
          <div className="mt-1.5 text-right">
            <Link to="/supplier/forgot" state={{ email }} className={TEXT_LINK}>Forgot password?</Link>
          </div>
        </div>
        {error && <Alert>{error}</Alert>}
        <button type="submit" className={PRIMARY} disabled={busy}>{busy ? "Signing in" : "Sign in"}</button>
      </form>
    </AuthFrame>
  );
}

/** Forgot password: the person types their email and is sent a one-time link. What the page says afterwards is the
 *  same for every email, as the server's answer is: it never tells a stranger which emails sign in here. */
function ForgotPage() {
  const location = useLocation();
  const company = usePublicCompany();
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await supplierApi.forgot(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The link could not be asked for. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const back = <Link to="/supplier/login" state={{ email: email.trim() }} className={TEXT_LINK}>Back to sign in</Link>;

  if (sent) {
    return (
      <AuthFrame title="Check your email">
        <Notice>If that email signs in here, a link is on its way. It works once, for 1 hour. Look in your spam folder too.</Notice>
        <div className="mt-4 text-center">{back}</div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Forgot password" intro={<>Enter the email you sign in with. {company.companyName} emails you a link to choose a new password.</>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        {error && <Alert>{error}</Alert>}
        <button type="submit" className={PRIMARY} disabled={busy || !email.trim()}>{busy ? "Sending" : "Send link"}</button>
      </form>
      <div className="mt-4 text-center">{back}</div>
    </AuthFrame>
  );
}

/** The link Carres (or a supplier's admin) sends carries its secret after the `#`, which a browser never sends to a
 *  server. It is read once and taken out of the address bar at once, so it is not left in the history. */
function readLinkToken(): string {
  const m = /[#&]t=([^&]+)/.exec(window.location.hash);
  const token = m ? decodeURIComponent(m[1]!) : "";
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

function SetPasswordPage({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
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
    if (!token) { setInvalid("This link is not complete. Open the link you were sent again, or ask for a new one."); return; }
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
      // Choosing the password signs the person in: they are not asked to type it again on the sign-in page.
      if (out.token && out.me) {
        supplierToken.set(out.token);
        onSignedIn(out.me);
        return;
      }
      // The supplier's access is off: the password is saved, and signing in waits for Carres to turn it on.
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
        <p className="m-0 text-[12.5px] leading-relaxed text-ink-secondary">{invalid}</p>
        {/* A link that ran out is the common case for one sent by email: the person asks for the next one here. */}
        <div className="mt-4"><Link to="/supplier/forgot" className={TEXT_LINK}>Ask for a new link</Link></div>
      </AuthFrame>
    );
  }
  if (!who) return <AuthFrame title="Checking your link"><p className="m-0 text-[12.5px] text-ink-muted">One moment.</p></AuthFrame>;
  return (
    <AuthFrame
      title={who.purpose === "reset" ? "Choose a new password" : "Choose your password"}
      intro={<>For <span className="font-semibold text-ink">{who.name}</span> ({who.email}). This link works once.</>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <TextField label="Password again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        <p className="m-0 text-[11.5px] text-ink-muted">Use at least 10 characters. A few words together are strong and easy to remember.</p>
        {error && <Alert>{error}</Alert>}
        <button type="submit" className={PRIMARY} disabled={busy || !password || !again}>{busy ? "Saving" : "Save password"}</button>
      </form>
    </AuthFrame>
  );
}

// ── The signed-in pages ─────────────────────────────────────────────────────────────────────────────────────────

/** A page the person's access does not open sends them home. */
function Only({ dept, perm, me, children }: { dept: Department; perm: string | string[]; me: Me; children: ReactNode }) {
  const can = makeCan(me);
  const ok = !me.user.mustChangePassword && (Array.isArray(perm) ? perm.some((p) => can(dept, p)) : can(dept, perm));
  return ok ? <>{children}</> : <Navigate to={homeFor(me)} replace />;
}

function OldPickupLink() {
  const { id = "" } = useParams();
  return <Navigate to={`/supplier/pickups?open=${encodeURIComponent(id)}`} replace />;
}
function OldFinanceLink() {
  const { id = "" } = useParams();
  return <Navigate to={`/supplier/collections/${encodeURIComponent(id)}`} replace />;
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

  useEffect(() => onSignedOut(() => { forgetAll(); setMe(null); setState("out"); }), []);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  // The server refused a page until the person chooses a new password: read who they are again, which sends them to
  // Settings.
  useEffect(() => onMustChangePassword(refresh), [refresh]);

  const signOut = useCallback(() => {
    void supplierApi.signOut().catch(() => undefined).finally(() => {
      supplierToken.clear();
      forgetAll();
      setMe(null);
      setState("out");
      navigate("/supplier/login", { replace: true });
    });
  }, [navigate]);
  const session = useMemo<Session | null>(() => (me ? { me, refresh, signOut, can: makeCan(me) } : null), [me, refresh, signOut]);

  const enter = (m: Me) => { forgetAll(); setMe(m); setState("in"); navigate(homeFor(m), { replace: true }); };

  const path = location.pathname.replace(/\/+$/, "");
  if (path === "/supplier/setup") return <SetPasswordPage onSignedIn={enter} />;

  if (state === "checking") return <div className="flex min-h-[100dvh] items-center justify-center bg-bg text-[12.5px] text-ink-muted">Loading</div>;
  if (state === "error") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md"><LoadError message="The server could not be reached. Check your connection." onRetry={refresh} /></div>
      </div>
    );
  }
  if (state === "out" || !session) {
    if (path === "/supplier/forgot") return <ForgotPage />;
    if (path !== "/supplier/login") return <Navigate to="/supplier/login" replace state={location.state} />;
    return <LoginPage onSignedIn={enter} />;
  }

  const m = session.me;
  // Until a person who was given a password chooses their own, Settings is the only page.
  if (m.user.mustChangePassword && path !== "/supplier/settings") return <Navigate to="/supplier/settings" replace />;
  return (
    <SessionProvider value={session}>
      <ToastProvider>
        <Shell me={m} onSignOut={signOut}>
          <Routes>
            <Route path="/supplier/orders" element={<Only me={m} dept="operation" perm="v_orders"><Lazy><OrdersPage /></Lazy></Only>} />
            <Route path="/supplier/orders/:docNo" element={<Only me={m} dept="operation" perm="v_orders"><Lazy><OrderPage /></Lazy></Only>} />
            <Route path="/supplier/forecast" element={<Only me={m} dept="operation" perm="v_forecast"><Lazy><ForecastPage /></Lazy></Only>} />
            <Route path="/supplier/pickups" element={<Only me={m} dept="operation" perm="v_pickups"><Lazy><PickupsPage /></Lazy></Only>} />
            <Route path="/supplier/deliveries" element={<Only me={m} dept="operation" perm="v_deliveries"><Lazy><DeliveriesPage /></Lazy></Only>} />
            <Route path="/supplier/pickups/:id" element={<OldPickupLink />} />
            <Route path="/supplier/collections" element={<Only me={m} dept="finance" perm="v_coll"><Lazy><CollectionsPage /></Lazy></Only>} />
            <Route path="/supplier/collections/:id" element={<Only me={m} dept="finance" perm={["v_coll", "v_month"]}><Lazy><SubscriptionPage /></Lazy></Only>} />
            <Route path="/supplier/months" element={<Only me={m} dept="finance" perm="v_month"><Lazy><MonthsPage /></Lazy></Only>} />
            <Route path="/supplier/months/:month" element={<Only me={m} dept="finance" perm="v_month"><Lazy><MonthPage /></Lazy></Only>} />
            <Route path="/supplier/settings" element={<Lazy><SettingsPage /></Lazy>} />
            {/* Addresses the pages had before 17 Nov 2026, kept so a saved link still lands. */}
            <Route path="/supplier/finance" element={<Navigate to="/supplier/collections" replace />} />
            <Route path="/supplier/finance/:id" element={<OldFinanceLink />} />
            <Route path="/supplier/account" element={<Navigate to="/supplier/settings" replace />} />
            <Route path="*" element={<Navigate to={homeFor(m)} replace />} />
          </Routes>
        </Shell>
      </ToastProvider>
    </SessionProvider>
  );
}

/** Each page is its own chunk: a person who only reads Finance never downloads the order pages. A chunk that cannot
 *  load after a deploy fails inside its own slot (components/LazySlot.tsx): the header stays, and moving to another
 *  page clears it. */
function Lazy({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <LazySlot resetKey={`supplier:${pathname}`} fallback={<div className="w-full px-6 py-4"><Loading /></div>}>
      {children}
    </LazySlot>
  );
}
