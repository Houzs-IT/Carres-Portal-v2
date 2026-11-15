/**
 * A POLICY MUST SAY WHO, NOT ONLY "SOMEBODY SIGNED IN".
 *
 * Measured 15 Nov 2026: twenty-eight read policies and three insert policies in
 * `public` asked one question, "is this account signed in?" — written as
 * `auth.uid() is not null`, as `true` for the `authenticated` role, or as
 * `auth.role() = 'authenticated'`. A signed-in account is not yet a Carres
 * account: the same answer went to a supplier's login, to a disabled login
 * until its token ran out, and to an account with no row in `app_users` at all.
 * The first was written in 0002; the other thirty were copied from it over six
 * months, because nothing failed. 0776 and 0777 replaced them. This module is
 * what stops the thirty-second.
 *
 * What a policy asks instead:
 *   (select public.is_carres_or_seller())   what Carres and the stores both use
 *   (select public.is_internal())           Carres's internal roles only
 *   a rule that names the row's owner       dealer_id = (select public.app_dealer_id())
 *
 * A pure module, so the shipped gate and its regression test read one
 * definition (scripts/check-migrations.mjs runs at import and cannot be called).
 */
import { stripComments } from "./migration-destructive.mjs";

/* The expression, once normalised, that admits every signed-in account. */
const ADMITS_ANY_SIGNED_IN = new Set([
  "true",
  "auth.uid()isnotnull",
  "(selectauth.uid())isnotnull",
  "auth.role()='authenticated'",
  "(selectauth.role())='authenticated'",
]);

/* A policy written for these roles only is not reachable by a person. */
const SERVER_ROLES = new Set(["service_role", "postgres", "supabase_admin", "supabase_auth_admin"]);

/** Lower case, no whitespace, no `::text`, and without parentheses that wrap the whole expression. */
export function normaliseExpression(expression) {
  let x = expression.toLowerCase().replace(/\s+/g, "").replace(/::text/g, "");
  for (;;) {
    if (!(x.startsWith("(") && x.endsWith(")"))) return x;
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === "(") depth++;
      else if (x[i] === ")") {
        depth--;
        if (depth === 0 && i < x.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (!wrapsAll) return x;
    x = x.slice(1, -1);
  }
}

/* The parenthesised expression that follows `keyword` in one statement. */
function clause(statement, keyword) {
  const m = keyword.exec(statement);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < statement.length && depth > 0; i++) {
    if (statement[i] === "(") depth++;
    else if (statement[i] === ")") depth--;
  }
  return statement.slice(start, i - 1);
}

/**
 * Every `create policy` / `alter policy` in the SQL whose USING or WITH CHECK
 * admits any signed-in account. A RESTRICTIVE policy only narrows, and a policy
 * for a server role is not reachable by a person; neither is reported.
 */
export function findOpenPolicies(sql) {
  const found = [];
  const scanned = stripComments(sql);
  const statement = /\b(?:create|alter)\s+policy\s+("[^"]+"|[\w$]+)\s+on\s+([\w."$]+)([\s\S]*?);/gi;
  for (let m = statement.exec(scanned); m; m = statement.exec(scanned)) {
    const rest = m[3];
    if (/\bas\s+restrictive\b/i.test(rest)) continue;
    const to = /\bto\s+([\w\s,"]+?)(?=\s+(?:using|with\s+check)\b|\s*$)/i.exec(rest)?.[1] ?? "public";
    const roles = to.split(",").map((role) => role.trim().replace(/"/g, "").toLowerCase());
    if (roles.every((role) => SERVER_ROLES.has(role))) continue;
    for (const [name, keyword] of [
      ["using", /\busing\s*\(/i],
      ["with check", /\bwith\s+check\s*\(/i],
    ]) {
      const expression = clause(rest, keyword);
      if (expression !== null && ADMITS_ANY_SIGNED_IN.has(normaliseExpression(expression))) {
        found.push({
          policy: m[1].replace(/"/g, ""),
          table: m[2].replace(/"/g, ""),
          clause: name,
          expression: expression.replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return found;
}

/**
 * Every `create policy` / `alter policy` statement in the SQL that writes `policy` on `table`, in order.
 * The schema and quotes are ignored, so `public.t` and `t` are one table. A policy written by a loop
 * (`execute format('create policy %I ...')`) has no statement of its own and is not seen.
 */
export function policyStatements(sql, policy, table) {
  const out = [];
  const scanned = stripComments(sql);
  const statement = /\b(?:create|alter)\s+policy\s+("[^"]+"|[\w$]+)\s+on\s+([\w."$]+)([\s\S]*?);/gi;
  const bare = (name) => name.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
  for (let m = statement.exec(scanned); m; m = statement.exec(scanned)) {
    if (bare(m[1]) === policy.toLowerCase() && bare(m[2]) === table.toLowerCase()) out.push(m[0]);
  }
  return out;
}

export function openPolicyMessage(file, found) {
  const lines = found.map((p) => `  ${p.policy} on ${p.table}: ${p.clause} (${p.expression})`);
  return (
    `${file} writes a policy that admits every signed-in account:\n${lines.join("\n")}\n` +
    `A signed-in account is not yet a Carres account (0776). Say who: ` +
    `(select public.is_carres_or_seller()), (select public.is_internal()), or a rule that names the row's owner.`
  );
}
