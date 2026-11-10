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
export const refuseWhenOldOrdersOff: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.OLD_ORDER_FLOWS === "off") return c.json({ error: "old_orders_off", message: OLD_ORDERS_OFF }, 409);
  await next();
};
