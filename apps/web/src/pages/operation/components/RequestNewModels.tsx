import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Button from "@/components/kit/Button";
import Input from "@/components/kit/Input";
import { ApiError, apiFetch } from "@/lib/api";

/* A purchase request's models the catalog does not have yet (Houzs
   product-request.ts:6-13; 0774). The requester asks while the request waits
   for its decision; once approved, the Purchasing Approver builds the model in
   the Catalog and links its SKU here, and the line joins the request. No PO is
   issued for the request while a model waits. The server decides who may. */

export const NM = {
  title: "New models",
  ask: "Ask for a new model",
  modelName: "Model name",
  spec: "Spec",
  qty: "Qty",
  waiting: "Waiting to be built",
  builtAs: "Built as",
  sku: "SKU",
  link: "Link SKU",
  save: "Save",
  asked: "New model asked.",
  linked: "SKU linked. The line is on the request.",
} as const;

type NewModel = { id: string; model_name: string; spec: string | null; qty: number; sku: string | null; built_at: string | null };

const key = (requestId: string) => ["operation", "purchasing", "new-models", requestId] as const;

export default function RequestNewModels({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const models = useQuery({
    queryKey: key(requestId),
    queryFn: () => apiFetch<{ models: NewModel[] }>(`/api/operation/purchasing/new-models?request=${requestId}`),
  });
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [qty, setQty] = useState("1");
  const [skus, setSkus] = useState<Record<string, string>>({});
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key(requestId) });
    void qc.invalidateQueries({ queryKey: ["operation", "purchasing"] });
  };

  const ask = useMutation<unknown, ApiError>({
    mutationFn: () => apiFetch("/api/operation/purchasing/new-models", {
      method: "POST",
      body: JSON.stringify({ requestId, modelName: name.trim(), spec: spec.trim() || undefined, qty: Number(qty) }),
    }),
    onSuccess: () => { toast.success(NM.asked); setAsking(false); setName(""); setSpec(""); setQty("1"); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const link = useMutation<unknown, ApiError, { id: string; sku: string }>({
    mutationFn: ({ id, sku }) => apiFetch(`/api/operation/purchasing/new-models/${id}/built`, {
      method: "POST", body: JSON.stringify({ sku }),
    }),
    onSuccess: () => { toast.success(NM.linked); refresh(); },
    onError: (e) => toast.error(e.message),
  });

  const list = models.data?.models ?? [];
  const qtyOk = Number.isInteger(Number(qty)) && Number(qty) >= 1;
  return (
    <div className="flex flex-col gap-2 px-4 py-3" data-testid={`new-models-${requestId}`}>
      {list.length > 0 && <p className="text-body font-medium">{NM.title}</p>}
      {list.map((m) => (
        <div key={m.id} className="flex flex-wrap items-end gap-2 text-body">
          <span className="min-w-0">{m.model_name}{m.spec ? ` · ${m.spec}` : ""} · {NM.qty} {m.qty}</span>
          {m.built_at
            ? <span className="text-base-700">· {NM.builtAs} {m.sku}</span>
            : (
              <>
                <span className="text-base-700">· {NM.waiting}</span>
                <Input id={`nm-sku-${m.id}`} label={NM.sku} value={skus[m.id] ?? ""}
                  onChange={(e) => setSkus((s) => ({ ...s, [m.id]: e.target.value }))} />
                <Button size="sm" variant="neutral" disabled={!(skus[m.id] ?? "").trim()} loading={link.isPending}
                  onClick={() => link.mutate({ id: m.id, sku: (skus[m.id] ?? "").trim() })}>{NM.link}</Button>
              </>
            )}
        </div>
      ))}
      {asking ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input id={`nm-name-${requestId}`} label={NM.modelName} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
          <Input id={`nm-spec-${requestId}`} label={NM.spec} value={spec} maxLength={500} onChange={(e) => setSpec(e.target.value)} />
          <Input id={`nm-qty-${requestId}`} label={NM.qty} type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!name.trim() || !qtyOk} loading={ask.isPending} onClick={() => ask.mutate()}>{NM.save}</Button>
        </div>
      ) : (
        <span><Button size="sm" variant="ghost" onClick={() => setAsking(true)}>{NM.ask}</Button></span>
      )}
    </div>
  );
}
