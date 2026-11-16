// Carres only (not part of Houzs's code): the Supplier Platform's passwords, tokens and their limits.
//
// A supplier's token is a random 32-byte secret that only their browser holds. The database keeps its SHA-256, so
// a copy of the database (or a log line) signs nobody in. Passwords reuse the engine's own PBKDF2 helpers.
import { generateToken, hashPassword, verifyPassword } from "../../services/auth";

export { hashPassword, verifyPassword };

/** A session lasts this long, whatever the person does: a supplier signs in again each working day. */
export const SESSION_HOURS = 12;
/** A set-password link works once, within this many hours. */
export const LINK_HOURS = 72;
/** A link the person asked for themselves (Forgot password) works once, within this many hours. It travels by
 *  email, which other people and machines may read on the way, so it is given far less time than a link Carres
 *  hands over. */
export const RESET_LINK_HOURS = 1;
/** Forgot password: the links one email may be sent inside the window. It stops a stranger who knows the email from
 *  filling that person's inbox. Counted per email, never per address (see callerAddress below). */
export const MAX_RESET_MAILS_PER_EMAIL = 3;
export const RESET_WINDOW_MINUTES = 60;

/** Wrong passwords for one email inside the window before that email is refused (whether or not it exists).
 *  Nothing is counted per address: see callerAddress below. */
export const MAX_FAILS_PER_EMAIL = 5;
export const FAIL_WINDOW_MINUTES = 15;

export const MIN_PASSWORD = 10;
/** Longer than any real password; stops a huge body being fed to the key derivation. */
export const MAX_PASSWORD = 200;
export const MAX_EMAIL = 254;

export const newToken = (): string => generateToken(32);

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The address Cloudflare gives a Worker that calls another zone ("CF-Connecting-IP in Worker subrequests",
 *  developers.cloudflare.com/fundamentals/reference/http-headers). The engine site's own /api proxy is such a call
 *  (frontend/functions/api/[[path]].ts: carres-scm.pages.dev to the Worker), so EVERY supplier's browser arrives
 *  here under this one address. */
export const WORKER_SUBREQUEST_ADDRESS = "2a06:98c0:3600::103";

/**
 * The caller's own address, or null when the request does not tell one caller from another. It is WRITTEN DOWN
 * beside a sign-in or a wrong try, as a record. It is never counted and never decides anything.
 *
 * WHY NOTHING IS COUNTED PER ADDRESS. Anyone may send their tries through the engine site's proxy, or through a
 * Worker of their own, and arrive under the shared address: a limit per address would stop only a caller who chose
 * to be stopped. And a count kept on an address every caller shares is a switch: thirty wrong tries by one outsider
 * would refuse every supplier's sign-in, and it would become that switch by itself the day Cloudflare changes the
 * address below. The limit that holds is the one per email (./session.ts takeTry). A limit per caller needs the
 * site's proxy to hand over the browser's address under a secret the Worker checks (docs/carry-forwards.md).
 */
export function callerAddress(connectingIp: string | null | undefined): string | null {
  const ip = (connectingIp ?? "").trim().toLowerCase();
  if (!ip || ip === "unknown" || ip === WORKER_SUBREQUEST_ADDRESS) return null;
  return ip.slice(0, 64);
}

export const normEmail = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
export const isEmail = (v: string): boolean => v.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Why a password is refused, or null when it may be used. */
export function passwordProblem(password: unknown, email: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  if (email && password.trim().toLowerCase() === email) return "The password cannot be your email address.";
  if (/^(.)\1+$/.test(password)) return "Use more than one character.";
  return null;
}

/** A stored hash of a password nobody has: checking against it costs the same as a real check, so the time a
 *  refusal takes does not tell an outsider whether the email exists. Made once per isolate. */
let decoy: Promise<string> | null = null;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(`decoy:${newToken()}`);
  return decoy;
}
