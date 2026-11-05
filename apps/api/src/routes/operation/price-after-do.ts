import { Hono } from "hono";
import { z } from "zod";
import { fail, parseJsonBody } from "../../lib/route-helpers";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * Price after DO (Houzs port, Houzs-ERP backend/src/scm/routes/mfg-sales-orders.ts:6798).
 * POST /operation/order-lines/:id/price-after-do  { unitPrice, reason }
 * The line's unit price changes after its Delivery Order; the DO reads the
 * line, and the order's invoices move with it. Who may and every refusal live
 * in order_line_price_after_do (0772).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const priceAfterDoInput = z
  .object({
    unitPrice: z.number().finite().min(0, "Unit price must be zero or more."),
    reason: z.string().max(500).optional(),
  })
  .strict();

const priceAfterDoRouter = new Hono<AppEnv>();

priceAfterDoRouter.post("/:id/price-after-do", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: "invalid_id", code: "invalid_param", message: "line id must be a uuid" }, 422);
  }
  const body = await parseJsonBody(c, priceAfterDoInput);
  if (!body.ok) return c.json(body.body, body.status);
  const sb = userClient(c.env, c.var.auth.jwt);
  const { data, error } = await sb.rpc("order_line_price_after_do", {
    p_line_id: id,
    p_unit_price: body.data.unitPrice,
    p_reason: body.data.reason ?? null,
  });
  if (error) return fail(c, error);
  return c.json(data);
});

export default priceAfterDoRouter;
