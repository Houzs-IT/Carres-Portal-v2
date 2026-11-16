// Carres only (not part of Houzs's code): the small parts Carres's own Supplier Pickups page draws with.
//
// These are staff parts (the staff kit's Badge and ResizableDetailDrawer), so they live on the staff side. The
// supplier's own pages were redrawn to the owner's design of 17 Nov 2026 and no longer use them
// (carres/supplier/ui.tsx); the words and dates both sides share still come from there.
import type { ReactNode } from "react";
import { X as XIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/Badge";
import { ResizableDetailDrawer } from "../../components/ResizableDetailDrawer";
import { useEscapeLayer } from "../../lib/escapeStack";
import { stageBadge } from "../supplier/ui";

export { count, fmtDay, fmtStamp } from "../supplier/ui";

/** A Sales Order's stage, in the words Carres staff use for it. */
export function SoStatusBadge({ status }: { status: string }) {
  const b = stageBadge(status);
  return <Badge tone={b.tone} size="sm" caseless>{b.label}</Badge>;
}

export function Card({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface", className)}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          {title && <h2 className="font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** A label over its value, for the fact grids. A value that is not known shows a named gap, never a blank. */
export function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">{label}</dt>
      <dd className="mt-1 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export const Missing = ({ children }: { children: ReactNode }) => <span className="text-ink-muted">{children}</span>;

/** The staff drawer's chrome (ResizableDetailDrawer: scrim, panel, drag to widen, the width remembered) with the staff
 *  Sales Orders drawer's inside (header, scrolling body, footer). */
export function Drawer({
  open, onClose, title, subtitle, headerRight, children, footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  headerRight?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEscapeLayer(onClose, open);
  return (
    <ResizableDetailDrawer open={open} onClose={onClose} ariaLabel={`${subtitle} ${title}`}>
      <div className="flex h-[60px] shrink-0 items-center gap-3 bg-sidebar px-5 text-sidebar-ink">
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sidebar-ink-muted hover:text-sidebar-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40" aria-label="Close details">
          <XIcon size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[14px] font-bold tracking-wide">{title}</div>
          <div className="mt-0.5 text-[11px] text-sidebar-ink-muted">{subtitle}</div>
        </div>
        {headerRight}
      </div>
      <div className="thin-scroll flex-1 overflow-y-auto px-5 py-5">{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-5 py-3">{footer}</div>}
    </ResizableDetailDrawer>
  );
}

/** The lines of an order or a request: item, specification, unit and quantity. */
export function LineList({ lines }: { lines: Array<{ key: string; itemCode: string; description: string; spec: string | null; modelName?: string | null; uom: string; qty: number; right?: ReactNode; sub?: ReactNode }> }) {
  return (
    <ul className="divide-y divide-border-subtle">
      {lines.map((l) => (
        <li key={l.key} className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">{l.description || l.itemCode}</div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{l.itemCode}{l.modelName ? ` · ${l.modelName}` : ""}</div>
            {l.spec && <div className="mt-0.5 text-[11.5px] text-ink-secondary">{l.spec}</div>}
            {l.sub}
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[13px] font-bold text-ink">{l.qty} <span className="text-[10.5px] font-semibold text-ink-muted">{l.uom}</span></div>
            {l.right && <div className="mt-1">{l.right}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
