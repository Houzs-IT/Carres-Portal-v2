import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Button from "@/components/kit/Button";
import Input from "@/components/kit/Input";
import Modal from "@/components/kit/Modal";
import Textarea from "@/components/kit/Textarea";
import { ApiError, apiFetch } from "@/lib/api";
import { rm } from "@/lib/format-currency";

/* Price after DO (Houzs PriceAfterDoModal.tsx:61-107): change one delivered
   line's unit price with a reason. The DO reads the line, and the order's
   invoices move with it (0772). Who may is checked by the server. */

export const PA = {
  open: "Change price",
  title: "Change price after DO",
  unitPrice: "Unit price (RM)",
  newAmount: "New amount",
  reason: "Reason (shown in History)",
  cancel: "Cancel",
  save: "Save",
  saved: "Price changed. The invoice follows.",
  invalid: "Unit price must be zero or more.",
} as const;

type Line = { id: string; sku: string; qty: number; unit_price: string | number };

export default function PriceAfterDoButton({ line }: { line: Line }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(line.unit_price));
  const [reason, setReason] = useState("");
  const unit = Number(price);
  const valid = price.trim() !== "" && Number.isFinite(unit) && unit >= 0;

  const save = useMutation<unknown, ApiError>({
    mutationFn: () =>
      apiFetch(`/api/operation/order-lines/${line.id}/price-after-do`, {
        method: "POST",
        body: JSON.stringify({ unitPrice: unit, reason: reason.trim() || undefined }),
      }),
    onSuccess: () => {
      toast.success(PA.saved);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["operation", "delivery-orders"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <Button size="sm" variant="neutral" onClick={() => setOpen(true)} data-testid={`price-after-do-${line.id}`}>
        {PA.open}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={PA.title}
        description={`${line.sku} × ${line.qty}`}
        footer={
          <>
            <Button variant="neutral" onClick={() => setOpen(false)}>{PA.cancel}</Button>
            <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}
              data-testid="price-after-do-save">
              {PA.save}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input id={`pa-price-${line.id}`} label={PA.unitPrice} type="number" min={0} step="0.01" required
            value={price} onChange={(e) => setPrice(e.target.value)} error={valid ? undefined : PA.invalid} />
          <p className="text-body text-base-700">
            {PA.newAmount}: <span className="font-medium tabular-nums">{valid ? rm(unit * line.qty) : ""}</span>
          </p>
          <Textarea id={`pa-reason-${line.id}`} label={PA.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
