import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { type PoSendEvidence } from "../components/PoIssueEvidence";
import { DeliveryDatesEdit, LogisticsDetailsEdit } from "../components/DeliveryBrief";
import SupplierReplySection from "../purchase-orders/SupplierReplySection";
import { useDeliveryScopeCard } from "../delivery-scope-card";

/** After a save every Work read refreshes: the feed, the Route, the POs. */
export function useRefreshWork() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["operation"] });
    void qc.invalidateQueries({ queryKey: ["so-batch-purchase"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
  };
}

/** The PO's own register row: version, send history, lines, promises. */
interface PoRow {
  id: string;
  supplier_id: string;
  destination_id?: string | null;
  version?: number | null;
  sends?: PoSendEvidence[];
  official_delivery_date?: string | null;
  promises?: unknown[];
  do_number?: string | null;
  do_uploaded_at?: string | null;
  do_file_path?: string | null;
  purchase_order_lines?: Array<{ id: string; sku: string; model_name?: string | null; size?: string | null; qty?: number | string | null; received_qty?: number | string | null }>;
}

function usePoRow(poId: string) {
  return useQuery({
    queryKey: ["operation", "pos", "one", poId],
    queryFn: () =>
      apiFetch<{ pos: PoRow[]; destinations?: Array<{ id: string; name: string }>; referencedDestinations?: Array<{ id: string; name: string }> }>(
        `/api/operation/pos?status=all&poId=${encodeURIComponent(poId)}`,
      ),
    staleTime: 10_000,
  });
}

const LOADING = "Loading…";
const FAILED = "Some information could not be refreshed.";


export function SupplierAnswerForm({ poId, supplierName, onDone, onCancel }: { poId: string; supplierName: string; onDone: () => void; onCancel: () => void }) {
  const row = usePoRow(poId);
  const found = row.data?.pos.find((p) => p.id === poId) ?? null;
  if (row.isLoading) return <p className="text-body text-kit-slate-11" role="status">{LOADING}</p>;
  if (!found) return <p className="text-body text-kit-slate-11" role="status">{FAILED}</p>;
  const version = found.version ?? 1;
  const send = (found.sends ?? []).find((s) => s.kind === "confirmed_sent" && (s.po_version ?? 1) === version) ?? null;
  return (
    <SupplierReplySection
      startEditing
      onCancel={onCancel}
      poId={found.id}
      version={version}
      officialDeliveryDate={found.official_delivery_date ?? null}
      supplierName={supplierName}
      lines={(found.purchase_order_lines ?? []).map((line) => ({
        id: line.id,
        sku: line.sku,
        item: [line.model_name, line.size].filter(Boolean).join(" · ") || line.sku,
        qty: Number(line.qty ?? 0),
        receivedQty: Number(line.received_qty ?? 0),
        unitIds: [],
      }))}
      promises={(found.promises ?? []) as never}
      canRecord={Boolean(send)}
      defaultChannel={send?.channel === "email" ? "email" : "whatsapp"}
      defaultRecipient={send?.recipient ?? ""}
      supplierDo={found.do_number || found.do_uploaded_at ? { number: found.do_number ?? null, uploadedAt: found.do_uploaded_at ?? null, file: found.do_file_path ?? null } : null}
      onSaved={onDone}
    />
  );
}

export function DeliveryDateForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const scope = useDeliveryScopeCard(orderId, 0);
  if (!scope.card) return <p className="text-body text-kit-slate-11" role="status">{LOADING}</p>;
  return <DeliveryDatesEdit layout="grid" card={scope.card} onDone={onDone} />;
}

export function AssignLogisticsForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const scope = useDeliveryScopeCard(orderId, 0);
  if (!scope.card) return <p className="text-body text-kit-slate-11" role="status">{LOADING}</p>;
  return <LogisticsDetailsEdit card={scope.card} onDone={onDone} />;
}


