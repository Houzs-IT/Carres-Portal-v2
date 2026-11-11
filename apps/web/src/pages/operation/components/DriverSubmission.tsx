import { useRef } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { DELIVERY_PHOTO_MIMES, DELIVERY_VIDEO_MIMES } from "@carres/shared";
import { ApiError } from "@/lib/api";
import { useUploadDeliveryPhoto } from "@/lib/queries";
import { DOR_COPY } from "../delivery-orders-register";

const ACCEPT = [...DELIVERY_PHOTO_MIMES, ...DELIVERY_VIDEO_MIMES].join(",");


/**
 * THE ONE FILE-PICKING DOOR onto the delivery-proof ledger. `doNumber` names
 * the trip; the SERVER verifies that the number is one of this order's own
 * documents before it stamps anything, so passing it here asks and never
 * asserts. Photos and videos ride the same picker — the operator should not
 * have to know which kind of button to press.
 */
export function DeliveryProofUploadButton({
  orderId,
  doNumber,
  label = DOR_COPY.uploadPhoto,
  testId,
}: {
  orderId: string;
  doNumber?: string | null;
  label?: string;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadDeliveryPhoto(orderId, {
    doNumber: doNumber ?? null,
    onSuccess: () => toast.success("Delivery file uploaded"),
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : e.message || "Upload failed"),
  });
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Delivery file"
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload.mutate(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        data-testid={testId}
        disabled={upload.isPending}
        onClick={(event) => {
          event.stopPropagation();
          inputRef.current?.click();
        }}
        className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-control border border-kit-slate-6 bg-white px-2 text-body font-medium text-kit-slate-11 hover:bg-kit-slate-3 hover:text-kit-slate-12 disabled:opacity-60"
      >
        <Upload size={13} strokeWidth={1.75} aria-hidden />
        <span className="truncate">{upload.isPending ? "Uploading…" : label}</span>
      </button>
    </>
  );
}


