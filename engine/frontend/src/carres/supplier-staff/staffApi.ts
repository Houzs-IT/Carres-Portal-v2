// Carres only (not part of Houzs's code): the Carres side of the Supplier Platform talks to the engine as STAFF,
// through the staff client and its session (engine/backend/src/carres/supplier/staff-routes.ts).
import { api } from "../../api/client";

export interface ScopeModel { id: string; code: string; name: string; category: string }
export interface ScopeSku { code: string; name: string; category: string }

export interface AccessSummary {
  supplierId: string;
  code: string;
  name: string;
  enabled: boolean;
  ownItems: boolean;
  subscriptionShare: boolean;
  categories: string[];
  modelCount: number;
  skuCount: number;
  userCount: number;
  lastSignInAt: string | null;
}

export interface SupplierPerson {
  id: number;
  name: string;
  email: string;
  canOperation: boolean;
  canFinance: boolean;
  status: "active" | "disabled";
  hasPassword: boolean;
  lastLoginAt: string | null;
  linkExpiresAt: string | null;
}

export interface AccessDetail {
  supplierId: string;
  code: string;
  name: string;
  saved: boolean;
  enabled: boolean;
  ownItems: boolean;
  subscriptionShare: boolean;
  categories: string[];
  models: ScopeModel[];
  skus: ScopeSku[];
  boundItemCount: number;
  users: SupplierPerson[];
}

export interface AccessOptions {
  suppliers: Array<{ id: string; code: string; name: string }>;
  categories: string[];
  models: ScopeModel[];
  skus: ScopeSku[];
}

export interface AccessInput { enabled: boolean; ownItems: boolean; subscriptionShare: boolean; categories: string[]; modelIds: string[]; skuCodes: string[] }
export interface Preview { orders: number; lines: number; units: number; incomingOrders: number }
export interface ActivityRow { at: string; kind: string; who: string | null; subject: string | null; ip: string | null }
export interface SetupLink { url: string; expiresAt: string; purpose?: "setup" | "reset" }

const ACCESS = "/api/carres/supplier-access";

export const accessApi = {
  list: () => api.get<{ suppliers: AccessSummary[]; signInUrl: string }>(ACCESS),
  options: () => api.get<AccessOptions>(`${ACCESS}/options`),
  subscriptionShare: () => api.get<{ available: boolean; orders?: number; rates?: number[]; message?: string }>(`${ACCESS}/subscription-share`),
  get: (supplierId: string) => api.get<{ access: AccessDetail; activity: ActivityRow[] }>(`${ACCESS}/${supplierId}`),
  save: (supplierId: string, input: AccessInput) => api.put<{ access: AccessDetail }>(`${ACCESS}/${supplierId}`, input),
  preview: (supplierId: string, input: AccessInput) => api.post<{ preview: Preview }>(`${ACCESS}/${supplierId}/preview`, input),
  addPerson: (supplierId: string, input: { name: string; email: string; canOperation: boolean; canFinance: boolean }) =>
    api.post<{ person: SupplierPerson; link: SetupLink }>(`${ACCESS}/${supplierId}/people`, input),
  updatePerson: (id: number, patch: Partial<{ name: string; canOperation: boolean; canFinance: boolean; status: "active" | "disabled" }>) =>
    api.patch<{ person: SupplierPerson }>(`${ACCESS}/people/${id}`, patch),
  newLink: (id: number) => api.post<{ link: SetupLink }>(`${ACCESS}/people/${id}/link`, {}),
};

export type PickupStatus = "REQUESTED" | "ACCEPTED" | "COLLECTED" | "CANCELLED";
export interface PickupLine { soDocNo: string; soItemId: string; itemCode: string; description: string; spec: string | null; modelName: string | null; uom: string; qty: number }
export interface EligibleLine extends PickupLine { soDate: string | null; status: string; customerName: string; deliveryDate: string | null }
export interface StaffPickup {
  id: string;
  requestNo: string;
  supplierId: string;
  supplierName: string;
  expectedDate: string;
  expectedTime: string | null;
  note: string | null;
  status: PickupStatus;
  requestedAt: string | null;
  requestedByName: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  collectedAt: string | null;
  collectedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  soDocNos: string[];
  lineCount: number;
  unitCount: number;
  lines: PickupLine[];
}

const PICKUPS = "/api/carres/supplier-pickups";

export const pickupApi = {
  suppliers: () => api.get<{ suppliers: Array<{ id: string; code: string; name: string }> }>(`${PICKUPS}/suppliers`),
  eligible: (supplierId: string) => api.get<{ lines: EligibleLine[] }>(`${PICKUPS}/eligible?supplierId=${encodeURIComponent(supplierId)}`),
  list: () => api.get<{ rows: StaffPickup[] }>(PICKUPS),
  create: (input: { supplierId: string; expectedDate: string; expectedTime: string | null; note: string | null; soItemIds: string[] }) =>
    api.post<{ pickup: StaffPickup }>(PICKUPS, input),
  collect: (id: string) => api.post<{ pickup: StaffPickup }>(`${PICKUPS}/${id}/collect`, {}),
  cancel: (id: string, reason: string) => api.post<{ pickup: StaffPickup }>(`${PICKUPS}/${id}/cancel`, { reason }),
};
