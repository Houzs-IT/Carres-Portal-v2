import { STAFF_SESSION_REQUIRED, STAFF_TOKEN_HEADER } from "@carres/shared";
import { useAuth } from "./auth";
import { useStaffSession } from "./staff";
import { resolveApiBase } from "./api-base";

const baseUrl = resolveApiBase(import.meta.env);

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

/** Attach the store JWT + (when a staff session exists) the staff token.
 *  Dormant stores never mint a staff token, so this is a no-op there. */
function applyAuthHeaders(headers: Headers) {
  const session = useAuth.getState().session;
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  const staffToken = useStaffSession.getState().token;
  if (staffToken) {
    headers.set(STAFF_TOKEN_HEADER, staffToken);
  }
}

/** An activated store that calls without a valid staff token gets a 403
 *  {error:'staff_session_required'} — drop the token so the gate re-PINs. */
function handleStaffSessionExpiry(status: number, body: unknown) {
  if (
    status === 403 &&
    body !== null &&
    typeof body === "object" &&
    (body as { error?: unknown }).error === STAFF_SESSION_REQUIRED
  ) {
    useStaffSession.getState().clearToken();
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  applyAuthHeaders(headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!res.ok) {
    handleStaffSessionExpiry(res.status, body);
    const msg =
      typeof body === "string"
        ? body
        : (body as { message?: string } | null)?.message ?? res.statusText;
    throw new ApiError(res.status, msg, body);
  }

  return body as T;
}

