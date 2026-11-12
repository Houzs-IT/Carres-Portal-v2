// Carres only (not part of Houzs's code): the menu counts, for the portal's menu.
//
// Houzs's menu shows how many items wait on the reader (amendments to approve, fair links to settle, …),
// from useApprovalBadgeCounts. Inside the portal this app draws no menu, so it hands the same counts to the
// portal ({ type: "carres:badges", counts }), which shows them on the matching rows.
import { useEffect } from "react";
import { useApprovalBadgeCounts } from "../hooks/useAmendmentApprovals";
import { carresPortalOrigin } from "./embed";

export function CarresBadgeReporter() {
  const counts = useApprovalBadgeCounts();
  const key = JSON.stringify(counts);
  useEffect(() => {
    const portal = carresPortalOrigin();
    if (portal) window.parent.postMessage({ type: "carres:badges", counts: JSON.parse(key) }, portal);
  }, [key]);
  return null;
}
