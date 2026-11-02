/** Shared document preview — docs/02-components.md; Purchasing MASTER §8.2. */
import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { paintPdfPages } from "@/lib/pdf/paint";
import Button from "./Button";
import Tooltip from "./Tooltip";
import Modal from "./Modal";
import type { ReactNode } from "react";

/** Source-owned identity/actions, also present while its PDF is loading or failed. */
export function PdfPreviewHeader({ title, actions, onClose, closeLabel }: { title: string; actions?: ReactNode; onClose: () => void; closeLabel: string }) {
  return <div className="mb-2 flex min-w-0 items-start gap-2">
    <h3 className="min-w-0 flex-1 break-words text-body font-semibold">{title}</h3>
    <div className="flex shrink-0 items-center gap-2">{actions}<Tooltip content={closeLabel}><Button size="sm" icon="close" iconOnly aria-label={closeLabel} onClick={onClose} /></Tooltip></div>
  </div>;
}

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url,
).toString();

interface PdfPreviewProps {
  src: string;
  title: string;
  onReady?: (ready: boolean) => void;
  "data-testid"?: string;
}

/** Actual PDF pages, using the same painter as Sales Order review. */
export default function PdfPreview({ src, title, onReady, "data-testid": testId }: PdfPreviewProps) {
  const pane = useRef<HTMLDivElement | null>(null);
  const [paneEpoch, setPaneEpoch] = useState(0);
  const setPane = useCallback((node: HTMLDivElement | null) => {
    pane.current = node;
    if (node) setPaneEpoch(n => n + 1);
  }, []);
  const [expanded, setExpanded] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const scroll = useRef([0, 0]);
  const changeExpanded = (next: boolean) => {
    if (pane.current) scroll.current = [pane.current.scrollLeft, pane.current.scrollTop];
    setExpanded(next);
  };
  const readiness = useRef(onReady);
  readiness.current = onReady;
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const node = pane.current;
    if (!node || paneEpoch === 0) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 120);
    });
    observer.observe(node);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [expanded, paneEpoch]);

  useEffect(() => {
    const node = pane.current;
    if (!node || paneEpoch === 0) return;
    let cancelled = false;
    let task: pdfjs.RenderTask | undefined;
    setStatus("loading");
    readiness.current?.(false);
    node.replaceChildren();
    let loading: pdfjs.PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        loading = pdfjs.getDocument(src);
        const doc = await loading.promise;
        if (cancelled) return;
        await paintPdfPages(doc, node, (width || 320) * zoom,
          () => cancelled, (next) => { task = next; });
        if (cancelled) return;
        node.scrollLeft = scroll.current[0]!;
        node.scrollTop = scroll.current[1]!;
        setStatus("ready");
        readiness.current?.(true);
      } catch {
        if (cancelled) return;
        node.replaceChildren();
        setStatus("error");
        readiness.current?.(false);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      void loading?.destroy().catch(() => {});
    };
  }, [src, width, zoom, attempt, expanded, paneEpoch]);

  const content = (
    <section aria-label={title} data-testid={testId} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" disabled={zoom <= 1} onClick={() => setZoom((n) => Math.max(1, n - 0.25))} aria-label="Zoom out" title="Zoom out">−</Button>
        <span className="text-meta tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="sm" disabled={zoom >= 3} onClick={() => setZoom((n) => Math.min(3, n + 0.25))} aria-label="Zoom in" title="Zoom in">+</Button>
        {!expanded && <Button ref={expandButton} size="sm" onClick={() => changeExpanded(true)}>Expand</Button>}
        <Button size="sm" disabled={zoom === 1} onClick={() => setZoom(1)}>Fit width</Button>
      </div>
      {status !== "ready" && (
        <div role="status" className="mb-2 flex flex-wrap items-center gap-2 text-meta text-kit-slate-11">
          {status === "loading" ? "Rendering preview…" : <>
            <span>Could not load the preview.</span>
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </>}
        </div>
      )}
      <div ref={setPane} aria-busy={status === "loading"} className="min-h-0 min-w-0 flex-1 overflow-auto" />
    </section>
  );
  return <>
    {!expanded && content}
    <Modal open={expanded} onOpenChange={changeExpanded} title={title} width="document" returnFocusRef={expandButton}>
      {expanded && <div className="flex h-[calc(100dvh-112px)] min-h-0 flex-col">{content}</div>}
    </Modal>
  </>;
}
