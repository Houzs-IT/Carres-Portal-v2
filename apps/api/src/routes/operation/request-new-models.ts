import { Hono } from "hono";
import { z } from "zod";
import { fail, parseJsonBody } from "../../lib/route-helpers";
import { userClient } from "../../lib/supabase";
import type { AppEnv } from "../../types";

/**
 * A purchase request's new models (Houzs port, Houzs-ERP
 * backend/src/scm/routes/product-requests.ts:711,761; 0774).
 *   GET  /operation/purchasing/new-models?request=<id>   the request's asked models
 *   POST /operation/purchasing/new-models                 { requestId, modelName, spec?, qty }
 *   POST /operation/purchasing/new-models/:id/built       { sku }  the model's SKU, once built
 * Who may and every refusal live in the 0774 functions.
 */
const uuid = z.string().uuid();

export const askNewModelInput = z
  .object({
    requestId: uuid,
    modelName: z.string().trim().min(1).max(160),
    spec: z.string().max(500).optional(),
    qty: z.number().int().min(1),
  })
  .strict();

export const modelBuiltInput = z.object({ sku: z.string().trim().min(1).max(80) }).strict();

const requestNewModelsRouter = new Hono<AppEnv>();

requestNewModelsRouter.get("/", async (c) => {
  const requestId = c.req.query("request") ?? "";
  if (!uuid.safeParse(requestId).success) {
    return c.json({ error: "invalid_id", code: "invalid_param", message: "request must be a uuid" }, 422);
  }
  const { data, error } = await userClient(c.env, c.var.auth.jwt)
    .from("purchase_request_new_models")
    .select("id, model_name, spec, qty, asked_at, sku, built_at")
    .eq("request_id", requestId)
    .order("asked_at");
  if (error) return fail(c, error);
  return c.json({ models: data ?? [] });
});

requestNewModelsRouter.post("/", async (c) => {
  const body = await parseJsonBody(c, askNewModelInput);
  if (!body.ok) return c.json(body.body, body.status);
  const { data, error } = await userClient(c.env, c.var.auth.jwt).rpc("purchasing_request_ask_new_model", {
    p_request_id: body.data.requestId,
    p_model_name: body.data.modelName,
    p_spec: body.data.spec ?? null,
    p_qty: body.data.qty,
  });
  if (error) return fail(c, error);
  return c.json({ id: data }, 201);
});

requestNewModelsRouter.post("/:id/built", async (c) => {
  const id = c.req.param("id");
  if (!uuid.safeParse(id).success) {
    return c.json({ error: "invalid_id", code: "invalid_param", message: "id must be a uuid" }, 422);
  }
  const body = await parseJsonBody(c, modelBuiltInput);
  if (!body.ok) return c.json(body.body, body.status);
  const { data, error } = await userClient(c.env, c.var.auth.jwt).rpc("purchasing_request_model_built", {
    p_new_model_id: id,
    p_sku: body.data.sku,
  });
  if (error) return fail(c, error);
  return c.json({ demandId: data });
});

export default requestNewModelsRouter;
