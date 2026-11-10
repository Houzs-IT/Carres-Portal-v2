// Builds the Carres engine database: applies scripts/carres-db/migrations/*.sql once each, in name order, and
// sets the password of the engine's own database role (scm_engine). Adapted from The Conts' scripts/migrate-pg.mjs.
//
//   node scripts/carres-db/apply.mjs --dry-run     ask for the connection string, show the target and what is pending
//   node scripts/carres-db/apply.mjs               ask for it, show the target, apply after the project ref is typed back
//
// Run from engine/backend. The connection string is the `postgres` admin one of the ENGINE's own Supabase project,
// never Carres-Portal-v2 (its tables share names with these) and never a Houzs one. It is typed or pasted on the
// terminal, nothing shows, and it is not written anywhere. Then it asks for a password to give scm_engine (the
// role the Worker connects as through Hyperdrive); leave it empty to keep the current one.
// RE-RUN: safe. Applied files are checksummed and skipped; a changed file stops the run. Each file is one
// transaction, so a failure leaves the database at the last file that worked.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const DIR = fileURLToPath(new URL("./migrations/", import.meta.url));
const DRY = process.argv.includes("--dry-run");
const REFUSED_REFS = ["kfprgpjpaffedghytstl"]; // Carres-Portal-v2, the portal's own database

let piped = null;
async function pipedLine() {
  if (!piped) { let t = ""; for await (const c of process.stdin) t += c; piped = t.split(/\r?\n/); }
  return piped.shift() ?? "";
}
/** Reads one line without echoing it. Never logged, never written anywhere. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) { stdout.write(question + "\n"); pipedLine().then(resolve, reject); return; }
    stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let value = "";
    const done = (fn) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); fn(); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled. Nothing was applied.")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
async function askLine(question) {
  if (!process.stdin.isTTY) { process.stdout.write(question + "\n"); return (await pipedLine()).trim(); }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

let url;
try { url = (await askHidden("Paste the engine database connection string (nothing will show), then press Enter: ")).trim(); }
catch (e) { console.error(e.message); process.exit(1); }
if (!url) { console.error("Nothing was entered. Nothing was applied."); process.exit(1); }
const ref = url.match(/postgres\.([a-z0-9]{20})\b/)?.[1] ?? url.match(/db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ?? null;
if (ref && REFUSED_REFS.includes(ref)) { console.error("That is the Carres portal's own database. Use the engine's project. Nothing was applied."); process.exit(1); }
const target = ref ?? url.replace(/\/\/[^@]*@/, "//***@");
console.log(`Target database: ${target}${DRY ? "  (dry run)" : ""}`);
if (!DRY) {
  const typed = await askLine(`Type the project ref (${ref ?? "the host name shown above"}) to apply to it, or anything else to stop: `);
  if (typed !== (ref ?? target)) { console.error("That does not match. Nothing was applied."); process.exit(1); }
}

let sql;
try {
  sql = postgres(url, { max: 1, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require", onnotice: (n) => console.log(`  note: ${n.message}`) });
} catch {
  // Never let a bad URL reach the default handler: its message carries the raw string, password included.
  console.error("That is not a valid connection string. Nothing was applied.");
  process.exit(1);
}
try {
  await sql`create table if not exists public.engine_migrations (filename text primary key, checksum text not null, applied_at timestamptz not null default now())`;
  await sql`alter table public.engine_migrations enable row level security`;
  const applied = new Map((await sql`select filename, checksum from public.engine_migrations`).map((r) => [r.filename, r.checksum]));
  let pending = 0;
  for (const filename of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const body = readFileSync(DIR + filename, "utf8");
    const checksum = createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
    const seen = applied.get(filename);
    if (seen && seen !== checksum) { console.error(`${filename} was edited after it ran. Add a new file instead.`); process.exitCode = 1; break; }
    if (seen) continue;
    pending++;
    if (DRY) { console.log(`pending: ${filename}`); continue; }
    console.log(`applying: ${filename}`);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public.engine_migrations (filename, checksum) values (${filename}, ${checksum})`;
      });
      // A plain SET search_path in a file outlives its transaction; never let it reach the next file (see 1001).
      await sql`reset search_path`;
    } catch (e) {
      console.error(`STOPPED at ${filename}: ${e.message}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!DRY && !process.exitCode && (await sql`select 1 from pg_roles where rolname = 'scm_engine'`).length) {
    // Tables a step created as the admin go to the engine role too, or the engine cannot read them.
    await sql.unsafe(readFileSync(new URL("./engine-owns-all.sql", import.meta.url), "utf8"));
    console.log("scm_engine owns every engine table; the data API serves scm.");
    const pw = (await askHidden("Password to give scm_engine (nothing will show; empty keeps the current one): ")).trim();
    if (pw) { await sql.unsafe(`alter role scm_engine password '${pw.replace(/'/g, "''")}'`); console.log("scm_engine password set."); }
  }
  if (!process.exitCode) console.log(pending === 0 ? "Nothing to apply; the database is up to date." : DRY ? `${pending} pending.` : `Applied ${pending}.`);
} finally {
  await sql.end();
}
