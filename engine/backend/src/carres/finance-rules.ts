// Carres only: Chew's Finance rules that change Houzs behaviour are switched on by the Worker variable
// CARRES_FINANCE_RULES = "on" (wrangler.toml [vars]). Unset, the engine behaves exactly as Houzs's code, so
// Houzs's own tests and a resync stay unchanged. docs/finance/MASTER.md §0.0.
//   - the person who prepared a payment voucher may not check it (carres/pv-preparer.ts);
//   - a sold line's cost is the cost on the PO bought for it (carres/po-line-cost.ts).
import type { Env } from "../types";

export function carresFinanceRules(env: Env | undefined): boolean {
  return String((env as { CARRES_FINANCE_RULES?: string } | undefined)?.CARRES_FINANCE_RULES ?? "").toLowerCase() === "on";
}
