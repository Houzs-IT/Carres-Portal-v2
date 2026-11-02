/** Seed racks and the floor plan (Houzs rack-labels.ts, warehouse-floorplan.ts), on Carres's rack + bin pair. */
export const MAX_SEED_BINS = 200;

/** Levels 1: one rack holding bins 1..N. More: racks L1..LN, each with bins 1..levels. */
export function seedBins(spec: { series: string; count: number; levels: number }): { rack: string; bin: string }[] {
  const series = spec.series.trim();
  const out: { rack: string; bin: string }[] = [];
  for (let n = 1; n <= spec.count && out.length < MAX_SEED_BINS; n++) {
    if (spec.levels <= 1) out.push({ rack: series || "Rack", bin: String(n) });
    else for (let l = 1; l <= spec.levels; l++) out.push({ rack: `${series}${n}`, bin: String(l) });
  }
  return out.slice(0, MAX_SEED_BINS);
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Racks in banks by their leading letters, sorted naturally: L2 before L10. */
export function floorPlan<B extends { rack: string; bin: string }>(bins: readonly B[]) {
  const banks = new Map<string, Map<string, B[]>>();
  for (const b of bins) {
    const series = /^\D*/.exec(b.rack.trim())![0].trim();
    const racks = banks.get(series) ?? new Map<string, B[]>();
    racks.set(b.rack, [...(racks.get(b.rack) ?? []), b]);
    banks.set(series, racks);
  }
  return [...banks.entries()].sort(([a], [b]) => natural.compare(a, b)).map(([series, racks]) => ({
    series,
    racks: [...racks.entries()].sort(([a], [b]) => natural.compare(a, b))
      .map(([rack, list]) => ({ rack, bins: [...list].sort((a, b) => natural.compare(a.bin, b.bin)) })),
  }));
}
