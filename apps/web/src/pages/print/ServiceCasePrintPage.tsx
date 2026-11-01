import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  caseIssueLabel,
  caseProductCategoryLabel,
  caseSlaClock,
  caseWantLabel,
  myHolidaySet,
  type ServiceCase,
} from "@carres/shared";
import { apiFetch } from "@/lib/api";
import { appTodayIso, fmtDate } from "@/lib/fmt-date";
import { CARRES_COMPANY } from "@/lib/pdf/company-identity-store";
import Loading from "@/components/kit/Loading";

/**
 * /print/service-case/:id?copy=customer|supplier|office — the Houzs Print menu's
 * three copies (Houzs ServiceCases.tsx:6830). Houzs puts a QR to its customer
 * portal on the Customer Copy; Carres has no portal, so that part is absent.
 */
export type CaseCopy = "customer" | "supplier" | "office";

export const CASE_COPIES: { key: CaseCopy; label: string; hint: string }[] = [
  { key: "customer", label: "Customer Copy", hint: "Case details and what happens next" },
  { key: "supplier", label: "Supplier Copy", hint: "PO, deadline, acknowledgement" },
  { key: "office", label: "Office Copy", hint: "Full internal view" },
];

const DOC_DATE = { year: "always" } as const;

/** What each copy shows. The supplier gets no customer contact details, and the
 *  customer gets no supplier or internal cost. */
export function caseCopyRows(c: ServiceCase, copy: CaseCopy, dueIso: string | null, owner: string): { label: string; value: string }[] {
  const product = [c.productCategory ? caseProductCategoryLabel(c.productCategory) : null, c.productSku].filter(Boolean).join(" · ");
  const shared = [
    { label: "SO No", value: c.so == null ? "" : `SO-${c.so}` },
    { label: "Ref No.", value: c.refNo ?? "" },
    { label: "DO No", value: (c.doNumbers ?? []).join(", ") },
    { label: "Customer", value: c.customerName },
    { label: "Item", value: product },
    { label: "Issue Category", value: c.issueType ? caseIssueLabel(c.issueType) : "" },
    { label: "Complaint", value: c.whatHappened ?? "" },
    { label: "Deadline", value: dueIso ? fmtDate(dueIso, DOC_DATE) : "" },
  ];
  const contact = [
    { label: "Phone", value: c.customerPhone ?? "" },
    { label: "Address", value: c.customerAddress ?? "" },
  ];
  const wants = { label: "Customer wants", value: (c.customerWants ?? []).map(caseWantLabel).join(", ") };
  const resolution = { label: "Resolution", value: c.carresAction ?? "" };
  const rows = copy === "customer"
    ? [...shared, ...contact, wants, resolution]
    : copy === "supplier"
      ? [...shared, { label: "Supplier", value: c.supplierName ?? "" }, { label: "PO", value: (c.poNumbers ?? []).join(", ") }]
      : [
          ...shared, ...contact, wants, resolution,
          { label: "Stage", value: c.statusLabel ?? "" },
          { label: "Salesperson", value: c.salespersonName ?? "" },
          { label: "Assigned To", value: owner },
          { label: "Supplier", value: c.supplierName ?? "" },
          { label: "PO", value: (c.poNumbers ?? []).join(", ") },
          { label: "What was affected", value: c.whatAffected ?? "" },
          { label: "Incurred charges", value: c.incurredCharges ?? "" },
        ];
  return rows;
}

export default function ServiceCasePrintPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const copy = CASE_COPIES.find((x) => x.key === searchParams.get("copy")) ?? CASE_COPIES[2];

  const q = useQuery<ServiceCase>({
    queryKey: ["ops", "service-cases", id],
    queryFn: () => apiFetch(`/api/ops/service-cases/${id}`),
    enabled: !!id,
  });
  const staffQ = useQuery<{ staff?: Array<{ user_id: string; name: string | null }> }>({
    queryKey: ["operation", "staff"],
    queryFn: () => apiFetch("/api/operation/staff"),
    enabled: copy.key === "office",
  });
  const staffReady = copy.key !== "office" || !staffQ.isLoading;

  useEffect(() => {
    if (!q.data || !staffReady) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [q.data, staffReady]);

  const holidayOpts = useMemo(() => ({ holidays: myHolidaySet() }), []);
  if (q.isLoading) return <div className="p-8"><Loading variant="skeleton" label="Loading the service case" /></div>;
  if (!q.data) return <div className="p-8 text-body text-error-700">Service case not found.</div>;

  const c = q.data;
  const clock = caseSlaClock(
    { openedAt: c.openedAt, todayIso: appTodayIso(), events: c.slaEvents ?? [], closed: c.statusIsClosed, customerName: c.customerName },
    holidayOpts,
  );
  const owner = staffQ.data?.staff?.find((p) => p.user_id === c.ownerUserId)?.name ?? "";
  const rows = caseCopyRows(c, copy.key, clock.dueIso, owner).filter((r) => r.value);

  return (
    <div className="mx-auto max-w-3xl p-5 text-body text-base-900">
      <style>{"@media print { @page { size: A4; margin: 12mm; } .no-print { display: none !important; } }"}</style>
      <div className="no-print mb-4 flex justify-end">
        <button type="button" onClick={() => window.print()} className="rounded border border-base-300 bg-white px-3 py-1.5 text-body">Print</button>
      </div>
      <header className="mb-4 flex items-start justify-between gap-4 border-b border-base-300 pb-3">
        <div>
          <p className="text-strong font-semibold">{CARRES_COMPANY.legalName}</p>
          <p className="text-meta text-base-600">{CARRES_COMPANY.addressLines.join(", ")}</p>
        </div>
        <div className="text-right">
          <p className="text-strong font-semibold">SERVICE CASE</p>
          <p className="font-mono">{c.caseNo}</p>
          <p className="text-meta text-base-600">{copy.label} · {fmtDate(c.openedAt, DOC_DATE)}</p>
        </div>
      </header>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-base-600">{r.label}</dt>
            <dd className="whitespace-pre-wrap">{r.value}</dd>
          </div>
        ))}
      </dl>
      {copy.key === "supplier" && (
        <section className="mt-10">
          <p className="font-semibold">Acknowledgement</p>
          <div className="mt-10 grid grid-cols-2 gap-8">
            <p className="border-t border-base-400 pt-1 text-meta text-base-600">Name and signature</p>
            <p className="border-t border-base-400 pt-1 text-meta text-base-600">Date</p>
          </div>
        </section>
      )}
    </div>
  );
}
