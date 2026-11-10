import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/** Shown when a new order is refused because the old supply chain is turned off. */
export const OLD_ORDERS_OFF = "New orders are turned off here for now. Orders are made in Supply Chain.";

/**
 * The old Carres supply chain is turned off in production (owner, 10 Nov 2026; wrangler.toml
 * OLD_ORDER_FLOWS = "off"). Its order book is no longer worked from the menu, so the routes that would start a
 * new order there (sales portal and POS, imports, rental agreements) refuse instead of leaving an order nobody
 * sees. Everything else, reading and finishing existing records included, is unchanged; unset turns them back on.
 */
const refuseWhenOff = (error: string, message: string): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (c.env.OLD_ORDER_FLOWS === "off") return c.json({ error, message }, 409);
  await next();
};
export const refuseWhenOldOrdersOff = refuseWhenOff("old_orders_off", OLD_ORDERS_OFF);

/** Shown when a new case is refused: the old Service Cases are turned off with the rest (owner, 10 Nov 2026). */
export const OLD_CASES_OFF = "New service cases are turned off here for now. Cases are made in Service Cases.";
/** New cases, service notes and guarantee claims into the old Service Cases; existing ones are unchanged. */
export const refuseWhenOldCasesOff = refuseWhenOff("old_cases_off", OLD_CASES_OFF);
