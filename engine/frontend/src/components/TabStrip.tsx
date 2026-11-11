import { cn } from "../lib/utils";

/**
 * Page-level tab strip — underlined, brass-accent on active.
 *
 * Matches the tab style used in the Trips page so every module that
 * splits its own surface into tabs (Projects: List/Calendar,
 * Service Cases: Cases/Quality Metrics, Trips: Queue/Drafts/…)
 * looks the same. Filter chips inside a page keep using
 * <FilterPills> — those are for value selection, not navigation.
 */

export interface TabOption<V extends string> {
  value: V;
  label: string;
  /** Hide this tab entirely when false. Omit to always show. */
  show?: boolean;
  /** Optional trailing count badge. */
  count?: number;
}

interface Props<V extends string> {
  value: V;
  onChange: (next: V) => void;
  options: TabOption<V>[];
  className?: string;
}

export function TabStrip<V extends string>({
  value,
  onChange,
  options,
  className,
}: Props<V>) {
  const visible = options.filter((o) => o.show !== false);
  return (
    <div
      className={cn(
        // Outer wrapper owns the bottom border so it spans the full
        // viewport even while the inner row scrolls horizontally — the
        // edge stays anchored when tabs overflow.
        "mb-4",
        className
      )}
    >
      <div
        className={cn(
          // Negative margin + matching padding lets the scrollable area
          // bleed to the screen edge on phones (where the page itself
          // has px-4) without breaking out of its container on larger
          // screens. Hidden scrollbar keeps the brass aesthetic.
          // Carres pill tabs: grey track, the chosen tab a white pill with blue words.
          "no-scrollbar inline-flex max-w-full items-center gap-0 overflow-x-auto rounded-[10px] bg-[#E2E4E8] p-[3px]",
          // Stop the row from compressing children; let them keep
          // their natural width so long labels never get clipped.
          "[&>*]:shrink-0"
        )}
      >
        {visible.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              onClick={() => onChange(t.value)}
              className={cn(
                "relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-[5px] text-[13px] leading-4 transition-colors",
                active
                  ? "bg-white font-medium text-[#2F55E0] shadow-[0_1px_2px_rgba(16,24,40,0.10)]"
                  : "font-normal text-[#4B5563] hover:bg-[#EEF0F3]"
              )}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span
                  className={cn(
                    "inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1.5 font-mono text-[9px] font-bold",
                    active
                      ? "bg-primary-soft text-primary-ink"
                      : "bg-surface-dim text-ink-muted"
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
