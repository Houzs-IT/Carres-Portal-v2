import { create } from "zustand";

/** Which menu pages this person may open, by their Houzs Team role (owner, 16 Nov 2026: permissions follow
 *  Houzs). The engine frame sends the addresses its own menu keeps ({ type: "carres:access", paths, all },
 *  engine/frontend/src/carres/AccessReporter.tsx). `null` until the first frame has said: the menu then shows
 *  what the portal role allows, as before. Kept for the tab so a reload does not flash every row. */
const STORE_KEY = "carres:engine-access";

export interface EngineAccess {
  paths: ReadonlySet<string>;
  all: ReadonlySet<string>;
}

interface EngineAccessState {
  access: EngineAccess | null;
  set: (raw: unknown) => void;
}

function read(): EngineAccess | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function parse(raw: unknown): EngineAccess | null {
  if (!raw || typeof raw !== "object") return null;
  const { paths, all } = raw as { paths?: unknown; all?: unknown };
  if (!Array.isArray(paths) || !Array.isArray(all)) return null;
  const strings = (a: unknown[]) => new Set(a.filter((x): x is string => typeof x === "string"));
  return { paths: strings(paths), all: strings(all) };
}

export const useEngineAccess = create<EngineAccessState>((setState) => ({
  access: read(),
  set: (raw) => {
    const access = parse(raw);
    if (!access) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ paths: [...access.paths], all: [...access.all] }));
    } catch {
      /* private mode: the menu still follows the live frame */
    }
    setState({ access });
  },
}));

/** May this person open the engine page at `enginePath`? `null` = the engine menu does not decide it. */
export function engineAllows(access: EngineAccess | null, enginePath: string | undefined): boolean | null {
  if (!access || !enginePath) return null;
  if (access.paths.has(enginePath)) return true;
  if (access.all.has(enginePath)) return false;
  /* The engine menu lists the page without this query, or with one: decide by the address alone. */
  const bare = enginePath.split("?")[0];
  const sameBare = (set: ReadonlySet<string>) => [...set].some((p) => p.split("?")[0] === bare);
  if (sameBare(access.paths)) return true;
  if (sameBare(access.all)) return false;
  return null;
}
