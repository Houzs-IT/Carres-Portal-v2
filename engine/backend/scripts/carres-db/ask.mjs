// Terminal questions shared by the carres-db scripts (apply.mjs, seed-from-houzs.mjs).
// askHidden reads one line without echoing it: a connection string typed or pasted here is never logged or written.
// Piped (non-TTY) input is read once and handed out line by line, so a script can be fed from stdin.

let piped = null;
async function pipedLine() {
  if (!piped) { let t = ""; for await (const c of process.stdin) t += c; piped = t.split(/\r?\n/); }
  return piped.shift() ?? "";
}

/** Reads one line without echoing it. Never logged, never written anywhere. */
export function askHidden(question) {
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
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled. Nothing was changed.")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export async function askLine(question) {
  if (!process.stdin.isTTY) { process.stdout.write(question + "\n"); return (await pipedLine()).trim(); }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}
