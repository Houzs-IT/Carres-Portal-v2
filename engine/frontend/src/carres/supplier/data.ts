// Carres only (not part of Houzs's code): the supplier pages' shared reads.
//
// A list, its full pages and the lists beside it read the same answers (the Sales Order page steps through the list;
// the Forecast opens the orders behind an item). Each answer is read once and kept for the signed-in tab, shown at
// once when a page comes back, and read again behind it. Signing out forgets everything.
import { useCallback, useEffect, useRef, useState } from "react";
import { supplierApi, type FinanceSummary, type Order, type Pickup } from "./api";

type Entry = { data: unknown; at: number };
const kept = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

/** Forget every answer (signing out, or another person signing in on this tab). */
export function forgetAll(): void {
  kept.clear();
  for (const set of listeners.values()) for (const fn of set) fn();
}

/** Read `key` again everywhere it is shown (after an act changed it). */
export function refreshShared(key: string): void {
  kept.delete(key);
  for (const fn of listeners.get(key) ?? []) fn();
}

export interface Shared<T> { data: T | null; error: string | null; loading: boolean; reload: () => void; put: (next: T) => void }

export function useShared<T>(key: string, load: () => Promise<T>, enabled = true): Shared<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; loading: boolean }>(() => ({
    key, data: (kept.get(key)?.data as T | undefined) ?? null, error: null, loading: enabled,
  }));
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    const set = listeners.get(key) ?? new Set();
    const fn = () => setNonce((n) => n + 1);
    set.add(fn);
    listeners.set(key, set);
    return () => { set.delete(fn); };
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const have = kept.get(key)?.data as T | undefined;
    setState((s) => ({ key, data: have ?? (s.key === key ? s.data : null), error: null, loading: true }));
    loader.current().then(
      (data) => {
        kept.set(key, { data, at: Date.now() });
        if (alive) setState({ key, data, error: null, loading: false });
      },
      (e: unknown) => {
        if (alive) setState((s) => ({ key, data: s.key === key ? s.data : null, error: e instanceof Error ? e.message : "Could not load.", loading: false }));
      },
    );
    return () => { alive = false; };
  }, [key, nonce, enabled]);

  const reload = useCallback(() => refreshShared(key), [key]);
  const put = useCallback((next: T) => {
    kept.set(key, { data: next, at: Date.now() });
    setState({ key, data: next, error: null, loading: false });
  }, [key]);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : null, loading: state.loading, reload, put };
}

// ── The answers the pages share ─────────────────────────────────────────────────────────────────────────────────

export const ORDERS_KEY = "orders";
export const PICKUPS_KEY = "pickups";
export const FINANCE_KEY = "finance";

/** Every Sales Order shared with the supplier, read a page at a time (the server answers at most 200 a page). */
async function allOrders(): Promise<Order[]> {
  const out: Order[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const got = await supplierApi.orders({ page, pageSize: 200, sort: "date", dir: "desc" });
    out.push(...got.rows);
    if (out.length >= got.total || got.rows.length === 0) break;
  }
  return out;
}

export const useOrders = (enabled = true) => useShared<Order[]>(ORDERS_KEY, allOrders, enabled);
export const usePickups = (enabled = true) => useShared<Pickup[]>(PICKUPS_KEY, async () => (await supplierApi.pickups()).rows, enabled);
export const useFinance = (enabled = true) => useShared<FinanceSummary>(FINANCE_KEY, () => supplierApi.finance(), enabled);
