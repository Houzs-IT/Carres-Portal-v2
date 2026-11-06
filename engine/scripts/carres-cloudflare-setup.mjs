// One-time setup of the Carres supply chain engine on CARRES's Cloudflare account. Run from the repo root:
//
//   node engine/scripts/carres-cloudflare-setup.mjs
//
// Before it: `npx wrangler login` as the Carres Cloudflare account, and the engine database built with
// engine/backend/scripts/carres-db/apply.mjs. It refuses any account but Carres's.
//
// What it does, each step safe to repeat:
//   1. the file bucket `carres-scm` and the session store, ids written into engine/backend/wrangler.toml;
//   2. the database link (Hyperdrive, caching off) from the scm_engine connection string you paste;
//   3. puts the engine server online (carres-scm-engine) and gives it its secrets;
//   4. builds and puts the engine screens online (Pages project carres-scm);
//   5. tells the portal's API (carres-portal-v2-api) where the engine is, with the shared sign-in secret.
// Secrets are generated here or pasted with nothing shown, passed to wrangler on its input, and never printed
// or written to a file.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CARRES_ACCOUNT = "e2494242a0fd563cacee5a301cf95dd3";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BACKEND = ROOT + "engine/backend";
const FRONTEND = ROOT + "engine/frontend";
const API = ROOT + "apps/api";
const TOML = BACKEND + "/wrangler.toml";
const ENGINE_API = "https://carres-scm-engine.wwch.workers.dev";
const ENGINE_SITE = "https://carres-scm.pages.dev";
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: CARRES_ACCOUNT };

/** Runs a command and returns its output. `input` goes to its stdin, never to the screen. No shell, so a
 *  connection string's & or % reaches wrangler as typed. */
function run(cmd, args, cwd, { input, allowFail = false, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: "utf8", shell: false });
  // Never show a connection string's user and password, in the command or in wrangler's own output.
  const mask = (t) => t.replace(/(postgres(?:ql)?:\/\/)[^@\s]*@/g, "$1***@");
  const out = mask(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (r.status !== 0 && !allowFail) {
    const shown = args.filter((x) => !x.endsWith(".js")).map((x) => (x.includes("://") ? x.replace(/=.*/, "=***") : x)).join(" ");
    console.error(`\nStopped: wrangler ${shown} failed.\n${out.slice(-1500)}`);
    process.exit(1);
  }
  if (!quiet && r.status === 0) console.log(`  ok: ${args.filter((a) => !a.endsWith(".js")).slice(0, 3).join(" ")}`);
  return { ok: r.status === 0, out };
}
// The engine's own wrangler, run by node directly (an npx/.cmd shim would need a shell on Windows).
const WRANGLER = BACKEND + "/node_modules/wrangler/bin/wrangler.js";
const wrangler = (args, cwd, opts) => run(process.execPath, [WRANGLER, ...args], cwd, opts);

function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding("utf8");
    let value = "";
    const done = (fn) => { stdin.setRawMode?.(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); fn(); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value.trim()));
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled.")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
const secret = () => randomBytes(32).toString("base64url");
const setToml = (placeholder, id) => {
  const s = readFileSync(TOML, "utf8");
  if (s.includes(placeholder)) writeFileSync(TOML, s.replace(placeholder, id));
};

// 0. The right account, or nothing.
const who = wrangler(["whoami"], BACKEND, { quiet: true });
if (!who.out.includes(CARRES_ACCOUNT)) {
  console.error("Wrangler is not signed in to the Carres Cloudflare account. Run `npx wrangler login` with the Carres login, then run this again. Nothing was changed.");
  process.exit(1);
}
console.log("Carres Cloudflare account found.");

// 1. File bucket and session store.
const bucket = wrangler(["r2", "bucket", "create", "carres-scm"], BACKEND, { allowFail: true, quiet: true });
console.log(bucket.ok || /already exists|already own/i.test(bucket.out) ? "  ok: file bucket carres-scm" : `Stopped: bucket.\n${bucket.out}`);
if (!bucket.ok && !/already exists|already own/i.test(bucket.out)) process.exit(1);
if (readFileSync(TOML, "utf8").includes("REPLACE_ME_CARRES_SCM_SESSION_KV")) {
  const kv = wrangler(["kv", "namespace", "create", "carres-scm-sessions"], BACKEND, { quiet: true });
  const id = kv.out.match(/id\s*=\s*"([0-9a-f]{32})"|"id":\s*"([0-9a-f]{32})"/);
  if (!id) { console.error(`Stopped: could not read the session store id.\n${kv.out}`); process.exit(1); }
  setToml("REPLACE_ME_CARRES_SCM_SESSION_KV", id[1] ?? id[2]);
  console.log("  ok: session store");
}

// 2. Database link.
if (readFileSync(TOML, "utf8").includes("REPLACE_ME_CARRES_SCM_HYPERDRIVE")) {
  const conn = await askHidden("Paste the engine database connection string for the scm_engine role (nothing will show): ");
  if (!/^postgres(ql)?:\/\//.test(conn)) { console.error("That is not a postgres connection string. Nothing more was changed."); process.exit(1); }
  if (conn.includes("kfprgpjpaffedghytstl")) { console.error("That is the Carres portal's own database. Use the engine's project."); process.exit(1); }
  const hd = wrangler(["hyperdrive", "create", "carres-scm-db", `--connection-string=${conn}`, "--caching-disabled"], BACKEND, { quiet: true });
  const id = hd.out.match(/id\s*=\s*"([0-9a-f]{32})"|"id":\s*"([0-9a-f]{32})"/);
  if (!id) { console.error("Stopped: could not read the database link id (output withheld: it may show the connection string)."); process.exit(1); }
  setToml("REPLACE_ME_CARRES_SCM_HYPERDRIVE", id[1] ?? id[2]);
  console.log("  ok: database link");
}

// 3. Engine server online, then its secrets.
const supabaseUrl = await askHidden("Engine Supabase project URL (https://<ref>.supabase.co): ");
const anonKey = await askHidden("Engine Supabase anon key (nothing will show): ");
const serviceKey = await askHidden("Engine Supabase service_role key (nothing will show): ");
if (supabaseUrl.includes("kfprgpjpaffedghytstl")) { console.error("That is the Carres portal's own project. Use the engine's."); process.exit(1); }
wrangler(["deploy"], BACKEND);
const sso = secret();
wrangler(["secret", "bulk"], BACKEND, {
  input: JSON.stringify({
    SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    CARRES_SSO_SECRET: sso, SESSION_SIGNING_KEY: secret(),
    // Required by the engine's types, unused here (no dashboard feed, no chat, no AutoCount): random values.
    DASHBOARD_API_KEY: secret(), CONNECT_SERVICE_TOKEN: secret(), AUTOCOUNT_API_KEY: secret(),
  }),
});

// 4. Engine screens online.
wrangler(["pages", "project", "create", "carres-scm", "--production-branch=main"], FRONTEND, { allowFail: true });
run(process.execPath, [FRONTEND + "/node_modules/typescript/bin/tsc", "-b"], FRONTEND);
run(process.execPath, [FRONTEND + "/node_modules/vite/bin/vite.js", "build"], FRONTEND);
wrangler(["pages", "deploy", "dist", "--project-name=carres-scm", "--branch=main", "--commit-dirty=true"], FRONTEND);

// 5. The portal's API learns where the engine is, with the same sign-in secret.
wrangler(["secret", "bulk", "--env=production"], API, { input: JSON.stringify({ SCM_ENGINE_API: ENGINE_API, SCM_ENGINE_SITE: ENGINE_SITE, SCM_ENGINE_SSO_SECRET: sso }) });

console.log(`\nDone. Engine server ${ENGINE_API}, screens ${ENGINE_SITE}.`);
console.log("engine/backend/wrangler.toml now holds the session store and database link ids: commit that file.");
