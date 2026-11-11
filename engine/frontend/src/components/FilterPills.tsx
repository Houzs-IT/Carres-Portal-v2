import { cn } from "../lib/utils";

interface Pill<T extends string> {
  value: T;
  label: string;
  /**
   * Optional count badge after the label. CALLER-SUPPLIED, deliberately: on a
   * client-filtered list (Amendments — the whole ≤500-row population is
   * loaded) counting the loaded rows is honest, but on a server-filtered /
   * paginated list the loaded page is NOT the population — pass the backend's
   * status-counts aggregate (the `statusCounts` shape the GRN/SO/DO/PI/SI
   * list endpoints already return), never a count of what happens to be
   * loaded.
   */
  count?: number;
}

interface Props<T extends string> {
  options: Pill<T>[];
  value: T;
  onChange: (v: T) => void;
}

/**
 * In-page filter chip group. Visually paired with <TabStrip/> — both
 * use brass as the active colour, but FilterPills stays compact and
 * self-contained (rounded slab) so it reads as "filter the current
 * view" while TabStrip reads as "switch views".
 */
export function FilterPills<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    // Outer track is the visible "slab"; the inner scroller is what
    // actually owns the buttons. When the option set is short the
    // group stays inline-sized; when it overflows (long label set on
    // a phone) it scrolls horizontally inside the slab without
    // bleeding into the layout. max-w-full prevents the inline-flex
    // from forcing parent width.
    <div className="inline-block max-w-full overflow-hidden rounded-[10px] bg-[#E2E4E8] align-middle">
      <div
        className={cn(
          "no-scrollbar flex items-center gap-0 overflow-x-auto p-[3px]",
          "[&>*]:shrink-0"
        )}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                // Carres pill tabs (apps/web components/kit/Tabs.tsx).
                "whitespace-nowrap rounded-lg px-3 py-[5px] text-[13px] leading-4 transition-colors",
                active
                  ? "bg-white font-medium text-[#2F55E0] shadow-[0_1px_2px_rgba(16,24,40,0.10)]"
                  : "font-normal text-[#4B5563] hover:bg-[#EEF0F3]"
              )}
            >
              {opt.label}
              {typeof opt.count === "number" && (
                <span
                  className={cn(
                    "ml-1.5 inline-block rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums align-middle",
                    active ? "bg-primary-soft text-primary-ink" : "bg-white/70 text-ink-muted"
                  )}
                >
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
/* cache-rotate 2026-07-31: see StatusDot.tsx — same edge-poisoned-URL
   incident; comment rotates this chunk's hash to a clean URL. */
