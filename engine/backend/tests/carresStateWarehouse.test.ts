// Carres delivers to the whole of Malaysia (Hub CARRES-0005), and a Sales Order cannot be created for a State with no
// warehouse (so-location-gate.ts). So every Malaysian State the address picker offers (scm.my_localities, seeded by
// step 2008) must get a state_warehouse_mappings row from the database build, spelled the same way.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/carres-db/migrations");
const sql = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(path.join(DIR, f), "utf8").replace(/--[^\n]*/g, ""))
  .join("\n");

const localityStates = new Set(
  [...sql.matchAll(/\{[^{}]*"state":"([^"]+)"[^{}]*\}/g)]
    .filter((m) => m[0].includes('"country":"Malaysia"') && m[0].includes('"postcode"'))
    .map((m) => m[1]),
);

const mappedStates = new Set([
  // step 2008: one insert per State
  ...[...sql.matchAll(/insert into scm\.state_warehouse_mappings[^;]*?select[^;]*?,\s*'([^']+)',\s*w\.id[^;]*KLG-WH01/gi)].map((m) => m[1]),
  // step 2023: a values list of States
  ...[...sql.matchAll(/insert into scm\.state_warehouse_mappings[^;]*?cross join \(values([^)]*(?:\)[^)]*)*?)\) as s\(state\)/gi)]
    .flatMap((m) => [...m[1].matchAll(/\('([^']+)'\)/g)].map((v) => v[1])),
]);

describe("Carres state -> warehouse", () => {
  it("the locality seed lists the Malaysian States", () => {
    expect(localityStates.has("Kedah")).toBe(true);
    expect(localityStates.size).toBe(16);
  });

  it("every Malaysian State the address picker offers ships from a warehouse", () => {
    expect([...localityStates].filter((s) => !mappedStates.has(s)).sort()).toEqual([]);
  });

  it("maps no State outside Malaysia", () => {
    expect([...mappedStates].filter((s) => !localityStates.has(s))).toEqual([]);
  });
});
