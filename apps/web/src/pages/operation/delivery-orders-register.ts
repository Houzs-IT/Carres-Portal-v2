import { deliveryGroupOf, latestEvidenceAtOf, proofDecisionLabel, proofReviewStateOf, type DeliveryAttemptEvidenceRow, type DeliveryOrderStatus, type DeliveryProofReviewRow, type ProofReviewState } from "@carres/shared";

/** ⭐ EVERY VISIBLE WORD, IN ONE PLACE (COPY-STANDARD, Delivery section). */
export const DOR_COPY = {
  page: "Delivery Orders",
  docTitle: "Delivery Orders · Carres",
  search: "Search delivery orders…",
  railWork: "Work to do",
  allDocuments: "All",
  /* Houzs Delivery Orders page words (MfgDeliveryOrdersListV2.tsx:1646-1693),
     Weisiang's decision 2026-11-01: Carres follows Houzs. */
  totalDos: "Total DOs",
  revenue: "Revenue",
  inTransit: "In transit",
  delivered: "Delivered",
  salesOrders: "Sales Orders",
  deliveryPlanning: "Delivery Planning",
  logisticOverview: "Logistic Overview",
  dateBy: "Date by",
  doDate: "DO date",
  deliveryDate: "Delivery Date",
  from: "From",
  to: "To",
  recordResult: "Record delivery result",
  uploadPhoto: "Upload delivery photo",
  uploadSignedDo: "Upload signed Delivery Order",
  /** §6.1 — the review queue; the row's door is the DO object's Evidence
   *  section, where the three acts live. */
  checkProof: "Check delivery proof",
  loadFailed: "The register could not be loaded",
  tryAgain: "Try again",
  /** The register's own column words (owner ruling 2026-09-11). */
  driverSubmission: "Driver submission",
  photos: "Photos",
  videos: "Videos",
  signedDo: "Signed Delivery Order",
  openPhotos: "Open delivery photos",
  openVideos: "Open delivery videos",
  openSignedDo: "Open the signed Delivery Order",
  /** Governed absences — muted, never a dash (COPY-STANDARD 2026-08-15). */
  noConfirmedDate: "Not scheduled",
  /* Time is optional (owner ruling 2026-09-24): its absence is the plain
     register absence, never a warning. */
  noTime: "Not recorded",
  noLogistics: "Logistics not assigned",
  notDelivered: "Not delivered yet",
  noPhoto: "No delivery photo yet",
  /** A video is never automatically required (owner ruling 2026-09-11), so
   *  this absence is only ever stated inside the player a person opened. */
  noVideo: "No delivery video",
  photoSaved: "Delivery photo saved",
  noSignedDo: "No signed document yet",
  signedDoOnFile: "Signed document on file",
  notRecorded: "Not recorded",
  noGoods: "No items on this trip",
  /** An upload is an upload — never a verdict (owner ruling 2026-09-11). */
  submissionMeaning:
    "An uploaded file records what the driver sent. It is not proof accepted and not a successful delivery.",
  unboundNote:
    "delivery files on this Sales Order name no delivery order, so they are counted for none of them. Open the Sales Order to see them.",
  signedDoMissing: "This delivery order has no signed document on file.",
  signedDoFailed: "The signed Delivery Order could not be opened",
  mediaFailed: "The driver submission could not be loaded",
  loading: "Loading…",
  emptyRegister:
    "No delivery orders yet. The system issues one when a trip's goods, logistics and date are ready. The Order Route on each Sales Order shows what is still open.",
  emptyFiltered: "No matching delivery orders.",
  /* New Delivery Order: Weisiang's decision (Mr Lim, WhatsApp 2026-10-22),
     office staff open a DO from a Sales Order's lines. COPY-STANDARD
     "New Delivery Order words". */
  newDo: "New Delivery Order",
  newDoHelp: "Pick a Sales Order and the goods to deliver.",
  soNo: "SO No",
  find: "Find",
  soNotFound: "Sales Order not found.",
  otherItems: "Other items",
  otherItemsHelp: "Go with the whole order, when every group is ticked.",
  nothingLeft: "Everything on this Sales Order is already on a Delivery Order.",
  journeyOrder: "This order travels on a Delivery Journey. Each leg issues its own Delivery Order.",
  qty: "Qty",
  cancel: "Cancel",
  createDo: "Create Delivery Order",
  created: (doNumber: string) => `${doNumber} created`,
} as const;


/**
 * ⭐ DRIVER SUBMISSION — WHAT CAME BACK FROM **THIS** TRIP (owner ruling
 * 2026-09-11, replacing the default `Proof Status` column).
 *
 * THE DEFECT THIS EXISTS TO KILL. The register's media source is the SALES
 * ORDER's ledger (`ops_order_control.delivery_photos`). An order with two
 * Delivery Orders has ONE ledger, so counting it per row would have told an
 * operator that DO-A carried three photos when all three came back from DO-B —
 * and the warehouse's own handover evidence (`delivery_handover_evidence`)
 * describes a load leaving the warehouse, not goods reaching a customer. The
 * attach door now stamps the verified DO number on every new entry, and this
 * is the ONE place that reads the stamp.
 *
 * THE THREE ANSWERS ARE DIFFERENT, AND STAY DIFFERENT:
 *
 *   known === false   the ledger never reached this screen — UNKNOWN.
 *                     An unknown is printed as an unknown, never as `0`.
 *   photos/videos     files that name THIS document. A real count.
 *   unbound           files this order holds that name NO document. They
 *                     belong to no row's count — the Sales Order still shows
 *                     them, because that is the scope they actually prove.
 */
export interface DriverSubmissionFile {
  path: string;
  at: string;
  by?: string | null;
  doNumber?: string | null;
  kind?: "photo" | "video" | null;
  url?: string | null;
}

export interface DriverSubmission {
  known: boolean;
  photos: number;
  videos: number;
  unbound: number;
}

export const UNKNOWN_SUBMISSION: DriverSubmission = {
  known: false,
  photos: 0,
  videos: 0,
  unbound: 0,
};

export function driverSubmissionOf(
  ledger: readonly DriverSubmissionFile[] | null | undefined,
  doNumber: string,
): DriverSubmission {
  if (ledger == null) return UNKNOWN_SUBMISSION;
  let photos = 0;
  let videos = 0;
  let unbound = 0;
  for (const entry of ledger) {
    const named = (entry.doNumber ?? "").trim();
    if (!named) {
      unbound += 1;
      continue;
    }
    if (named !== doNumber) continue;
    /* The ledger was photo-only until videos existed, so a stamped entry with
       no kind is the photo it could only have been — never a guessed video. */
    if (entry.kind === "video") videos += 1;
    else photos += 1;
  }
  return { known: true, photos, videos, unbound };
}


export type DoWorkQueue = "record_result" | "upload_photo" | "upload_signed_do" | "check_proof";



/**
 * §6.1 (0489) — what Operation has said about THIS document's proof, and
 * whether a newer file reopened the question. ONE arithmetic
 * (`proofReviewStateOf` over `latestEvidenceAtOf`), read by this register,
 * Monitor's status line and the DO object's Evidence section.
 */
export interface DoProofReview {
  state: ProofReviewState;
  /** The latest review's reason, when it asked for more or refused. */
  reason: string | null;
  reviewedAt: string | null;
  /** The governed word of the latest review, or null while none exists. */
  label: string | null;
}

export const NO_PROOF_REVIEW: DoProofReview = { state: "none", reason: null, reviewedAt: null, label: null };

export function proofReviewOf(input: {
  doNumber: string;
  ledger: readonly DriverSubmissionFile[] | null | undefined;
  signedDoUploadedAt: string | null | undefined;
  reviews: ReadonlyArray<Pick<DeliveryProofReviewRow, "decision" | "reason" | "reviewed_at">>;
  attemptEvidence: ReadonlyArray<Pick<DeliveryAttemptEvidenceRow, "recorded_at">>;
}): DoProofReview {
  const latestEvidenceAt = latestEvidenceAtOf({
    ledger: input.ledger,
    doNumber: input.doNumber,
    attemptEvidence: input.attemptEvidence,
    signedDoUploadedAt: input.signedDoUploadedAt,
  });
  const { state, reviewedAt } = proofReviewStateOf({ latestEvidenceAt, reviews: input.reviews });
  const latest = [...input.reviews].sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at))[0] ?? null;
  return {
    state,
    reason: state === "rejected" || state === "more_required" ? latest?.reason ?? null : null,
    reviewedAt,
    label: latest ? proofDecisionLabel(latest.decision) : null,
  };
}


export interface DoRegisterRow {
  id: string;
  doNumber: string;
  orderId: string;
  so: number;
  customer: string;
  /** The SO's promise to the customer — `Requested Delivery Date`. */
  requestedDelivery: string | null;
  requestedTbd: boolean;
  /** This trip's scheduled operational date — `Scheduled delivery`. */
  confirmedDelivery: string | null;
  confirmedTime: string | null;
  location: string;
  /** The partner named on the document. */
  logisticsPartner: string | null;
  status: DeliveryOrderStatus;
  issuedAt: string;
  /** The LATEST recorded result, or null while none exists. */
  latestResult: "delivered" | "partial" | "failed" | null;
  /** What the driver sent back from THIS document's trip. */
  submission: DriverSubmission;
  /** Every ledger entry of the owning Sales Order, so a viewer opened from
   *  this row can show THIS document's files without a second read. */
  submissionLedger: readonly DriverSubmissionFile[] | null;
  /** The T6 photo ledger, scoped to THIS document: null = unknown. */
  photosPresent: boolean | null;
  /** `orders.do_file_path` — the signed document on file. */
  signedDoPresent: boolean;
  /** §6.1 — Operation's review of this document's proof (0489). */
  proofReview: DoProofReview;
  /** 0491 — the Delivery scope: 0 the whole order, 1..n a Journey leg; the
   *  Journey's last leg; and the leg's route (`Klang WH → JB transit`). */
  leg: number;
  lastLeg: number;
  intermediateLeg?: boolean;
  legRoute: string | null;
  /** THIS TRIP's goods lines (trip_groups NULL = the whole order). */
  lines: Array<{ id?: string; sku: string; qty: number; attrs?: Record<string, unknown> | null }>;
  goodsSummary: string;
  /** The ONE primary work queue this document sits in, or null. */
  queue: DoWorkQueue | null;
  /* Houzs' DO columns the order already holds. */
  invoiceNos: string[];
  /** Set by the register page from the payload's document links. */
  sourcePos?: string[];
  returnNos?: string[];
  refNo: string | null;
  salesperson: string | null;
  driver: string | null;
  vehicle: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  buildingType: string | null;
  /** This trip's goods value. Null on a warehouse leg, so a Journey's order is
   *  counted once, on the leg that reaches the customer. */
  amount: number | null;
}


/**
 * THIS TRIP's goods — the SAME derivation the DO object page and the print
 * path run (Law D — one arithmetic): trip_groups NULL/empty = the whole
 * order; a split trip carries only its groups' lines.
 */
export function tripLinesOf<T extends { sku: string }>(
  lines: readonly T[],
  tripGroups: readonly string[] | null | undefined,
): T[] {
  if (!tripGroups || tripGroups.length === 0) return [...lines];
  const scope = new Set(tripGroups);
  return lines.filter((l) => {
    const g = deliveryGroupOf(l.sku);
    return g !== null && scope.has(g);
  });
}


/**
 * THE MISSING EVIDENCE of a recorded delivered result — the ONE arithmetic
 * (Architecture Law D) behind this register's two upload queues AND Monitor's
 * `Upload delivery proof` queue (owner correction 2026-09-07). A result that
 * has not reached the customer needs no proof; an UNKNOWN photo ledger
 * (older payload) claims nothing; the signed document is `orders.do_file_path`.
 */
export interface MissingDeliveryProof {
  photo: boolean;
  signedDo: boolean;
}

export function missingDeliveryProofOf(row: {
  latestResult: DoRegisterRow["latestResult"];
  photosPresent: boolean | null;
  signedDoPresent: boolean;
  /** Card 20 — an intermediate Journey leg's `delivered` is an ARRIVAL at a
   *  partner warehouse; the customer leg owes the delivery proof, not this one. */
  intermediateLeg?: boolean;
}): MissingDeliveryProof {
  const reached =
    !row.intermediateLeg && (row.latestResult === "delivered" || row.latestResult === "partial");
  if (!reached) return { photo: false, signedDo: false };
  return {
    /* photosPresent === null is UNKNOWN — never a missing photo. */
    photo: row.photosPresent === false,
    signedDo: !row.signedDoPresent,
  };
}

/** §6.1 — a review that asked for more, or refused, with nothing newer on
 *  record: the upload is reopened, and the row carries the reason. */
export function proofReopened(review: Pick<DoProofReview, "state"> | null | undefined): boolean {
  return review?.state === "rejected" || review?.state === "more_required";
}



/** §6.1's records, keyed by document number, as the page groups them once. */
export interface DoProofRecords {
  reviewsByDo: ReadonlyMap<string, DeliveryProofReviewRow[]>;
  evidenceByDo: ReadonlyMap<string, DeliveryAttemptEvidenceRow[]>;
}

export function groupProofRecords(
  reviews: readonly DeliveryProofReviewRow[] | undefined,
  evidence: readonly DeliveryAttemptEvidenceRow[] | undefined,
): DoProofRecords {
  const reviewsByDo = new Map<string, DeliveryProofReviewRow[]>();
  for (const r of reviews ?? []) reviewsByDo.set(r.do_number, [...(reviewsByDo.get(r.do_number) ?? []), r]);
  const evidenceByDo = new Map<string, DeliveryAttemptEvidenceRow[]>();
  for (const e of evidence ?? []) {
    if (!e.do_number) continue;
    evidenceByDo.set(e.do_number, [...(evidenceByDo.get(e.do_number) ?? []), e]);
  }
  return { reviewsByDo, evidenceByDo };
}


export interface DoRegisterFilters {
  queue: DoWorkQueue | null;
  status: DeliveryOrderStatus["kind"] | null;
}







export interface DoRegisterRails {
  work: Record<DoWorkQueue, number>;
  status: Record<DeliveryOrderStatus["kind"], number>;
  total: number;
}


