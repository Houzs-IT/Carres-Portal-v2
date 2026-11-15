import { createMiddleware } from "hono/factory";
import { seesCost } from "@carres/shared";
import { carresApiSecret, opensApiDoor } from "../lib/api-door";
import type { AppEnv } from "../types";

/* Opens the API door (lib/api-door.ts) for ONE request: a caller that does not see cost, on a route where the
 * door is open. Runs after authMiddleware.
 *
 * The value rides on this request's own copy of `env`, which every route already hands to `userClient`, so no
 * route changes and no other request sees it.
 *
 * If the database has not handed the value over, the request is refused rather than run without it: an order
 * priced against product tables that answer "nothing" would be priced wrong, and a refusal is retried. */
export const apiDoorMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (seesCost(c.var.auth.role) || !opensApiDoor(c.req.method, c.req.path)) {
    await next();
    return;
  }
  const secret = await carresApiSecret(c.env);
  if (!secret) {
    // Words a store may be shown: plain, and nothing about how the system is built.
    return c.json({ error: "server_not_ready", message: "Not ready yet. Try again." }, 503);
  }
  c.env = { ...c.env, CARRES_API_SECRET: secret };
  await next();
});
