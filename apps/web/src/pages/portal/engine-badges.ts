import { create } from "zustand";

/** The counts Houzs's menu shows (engine useApprovalBadgeCounts), handed over by the engine frame
 *  ({ type: "carres:badges" }, engine/frontend/src/carres/BadgeReporter.tsx). The last counts stay
 *  while the frame is closed, until the next engine page sends fresh ones. */
export const ENGINE_BADGES = [
  "amendment-approvals",
  "po-amendment-approvals",
  "payment-backdate-approvals",
  "fair-links-to-settle",
  "product-request-approvals",
] as const;
export type EngineBadge = (typeof ENGINE_BADGES)[number];

interface EngineBadgeState {
  counts: Partial<Record<EngineBadge, number>>;
  set: (raw: unknown) => void;
}

export const useEngineBadges = create<EngineBadgeState>((setState) => ({
  counts: {},
  set: (raw) => {
    if (!raw || typeof raw !== "object") return;
    const counts: Partial<Record<EngineBadge, number>> = {};
    for (const key of ENGINE_BADGES) {
      const n = (raw as Record<string, unknown>)[key];
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) counts[key] = Math.floor(n);
    }
    setState({ counts });
  },
}));
