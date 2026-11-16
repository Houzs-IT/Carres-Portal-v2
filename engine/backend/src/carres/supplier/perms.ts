// Carres only (not part of Houzs's code): what each supplier person may see and press.
//
// A supplier person belongs to one department or both: Warehouse and Operation, and Finance. Within a department,
// the supplier's own admin turns on, person by person, the pages they see and the buttons they may use (owner,
// 16 Nov 2026). The keys below are the whole list; carres_supplier_users.perms keeps, per department, the keys a
// person holds (migration 2017). Every supplier route checks its key HERE, on the server: a page or a button that
// is hidden on the screen is also refused by the API.
export type Department = "operation" | "finance";
export const DEPARTMENTS: readonly Department[] = ["operation", "finance"];

/** Every key, in the order the screens list them. */
export const PERM_KEYS: Readonly<Record<Department, readonly string[]>> = {
  operation: ["v_orders", "v_forecast", "v_pickups", "a_accept", "a_collect", "a_date", "a_cancel", "a_export", "a_users"],
  finance: ["v_coll", "v_month", "d_names", "d_share", "d_bad", "a_export", "a_stmt", "a_users"],
};

/** A button that works on a page needs that page: with the page off, the button is off too. */
const NEEDS: Readonly<Record<string, string>> = {
  a_accept: "v_pickups",
  a_collect: "v_pickups",
  a_date: "v_pickups",
  a_cancel: "v_pickups",
};

export interface Perms { operation: string[]; finance: string[] }

export const isDepartment = (v: unknown): v is Department => v === "operation" || v === "finance";

/** A list of keys made safe to keep: only this department's keys, each once, in the screens' order, and no button
 *  whose page is off. Anything else in the list is dropped, never stored. */
export function cleanPerms(department: Department, keys: unknown): string[] {
  const asked = new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : []);
  return PERM_KEYS[department].filter((k) => asked.has(k) && (!NEEDS[k] || asked.has(NEEDS[k]!)));
}

/** Every key of a department: what a person Carres adds holds. */
export const allPerms = (department: Department): string[] => [...PERM_KEYS[department]];

/** The stored permissions as text (the column read as ::text), kept only for the departments the person belongs to.
 *  Anything that is not the expected shape reads as no permission at all. */
export function readPerms(text: unknown, held: { canOperation: boolean; canFinance: boolean }): Perms {
  let parsed: unknown = null;
  if (typeof text === "string" && text) {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  } else if (text && typeof text === "object") {
    parsed = text;
  }
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return {
    operation: held.canOperation ? cleanPerms("operation", obj.operation) : [],
    finance: held.canFinance ? cleanPerms("finance", obj.finance) : [],
  };
}

/** Whether a person holds a key in a department. */
export const holds = (who: { perms: Perms }, department: Department, key: string): boolean => who.perms[department].includes(key);

/** A person's permissions as one stored value. */
export const permsJson = (p: Perms): string => JSON.stringify({ operation: p.operation, finance: p.finance });
