/**
 * Settings → Company · Office · Settings editors — the reads and saves
 * (API `routes/operation/settings-core.ts`, storage 0668 + 0669). Kept out of
 * the giant `queries.ts` so each Settings section owns its own small file.
 *
 * `useOfficeCalendar()` is also THE web reader of the Office calendar for
 * every Office-based date the browser computes (Payment Monitor, Order Route,
 * Work): it returns the shared `OfficeCalendar` shape with the owner defaults
 * while loading or when the storage is not installed.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_OFFICE_CALENDAR, officeCalendarOf, officeCalendarResponseSchema, type OfficeCalendar } from "@carres/shared";
import { apiFetch } from "./api";
import { MY_ADDRESS, applyAddressOverrides, type AddressOverride } from "@/data/malaysia-postcodes";



export const settingsKeys = {
  company: ["settings", "company"] as const,
  companyIdentity: ["settings", "company-identity"] as const,
  office: ["settings", "office"] as const,
  editors: ["settings", "editors"] as const,
};



export function useOfficeSettings() {
  return useQuery({
    queryKey: settingsKeys.office,
    queryFn: async () => officeCalendarResponseSchema.parse(await apiFetch<unknown>("/api/operation/settings/office")),
    staleTime: 60_000,
  });
}

/** The Office calendar every Office-based browser date reads (owner defaults until loaded). */
export function useOfficeCalendar(): OfficeCalendar {
  const q = useOfficeSettings();
  if (!q.data || !q.data.stored) return DEFAULT_OFFICE_CALENDAR;
  return officeCalendarOf(q.data.values, q.data.holidays.map((h) => ({ holiday_date: h.date, name: h.name })));
}





/**
 * Settings → Address lists (0722) — Weisiang's decision (Mr Lim, WhatsApp
 * 2026-10-22; Jess was not part of it): the State · City · Postcode lists every
 * address picker offers are the generated national file with the office's
 * changes on top. While loading, or before 0722, the national file alone.
 */
const addressListsKey = ["address-lists"] as const;

export function useAddressOverrides() {
  return useQuery({
    queryKey: addressListsKey,
    queryFn: () => apiFetch<{ stored: boolean; rows: AddressOverride[] }>("/api/address-lists"),
    staleTime: 5 * 60_000,
  });
}

export function useAddressLists() {
  const rows = useAddressOverrides().data?.rows;
  return useMemo(() => {
    const map = rows?.length ? applyAddressOverrides(MY_ADDRESS, rows) : MY_ADDRESS;
    return {
      states: Object.keys(map).sort(),
      cities: (state: string | null) => (state && map[state] ? Object.keys(map[state]).sort() : []),
      postcodes: (state: string | null, city: string | null) =>
        state && city && map[state]?.[city] ? [...new Set(map[state][city])].sort() : [],
    };
  }, [rows]);
}

