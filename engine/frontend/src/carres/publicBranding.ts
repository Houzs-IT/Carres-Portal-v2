// Carres only (not part of Houzs's code). The public pages (customer portal, privacy page) have no staff
// session, so /api/branding is not open to them. They read the company contact from the public
// GET /api/track/company (Settings > Branding on the server) instead of Houzs's hard-coded details.
import { useEffect, useState } from "react";
import { portalApi } from "../portal/portalApi";
import { DEFAULT_BRANDING } from "../lib/branding";

export interface PublicCompany {
  companyName: string;
  registrationNo: string;
  address: string;
  postcode: string;
  phone: string;
  email: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function normalizePublicCompany(raw: unknown): PublicCompany {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    companyName: str(r.companyName) || DEFAULT_BRANDING.companyName,
    registrationNo: str(r.registrationNo),
    address: str(r.address),
    postcode: str(r.postcode),
    phone: str(r.phone),
    email: str(r.email),
  };
}

/** Address lines as printed: the free-text lines, then the postcode when it is not already in them. */
export function publicAddressLines(c: Pick<PublicCompany, "address" | "postcode">): string[] {
  const lines = c.address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (c.postcode && !c.address.includes(c.postcode)) lines.push(c.postcode);
  return lines;
}

let cached: PublicCompany | null = null;
let inflight: Promise<PublicCompany> | null = null;

function loadPublicCompany(): Promise<PublicCompany> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = portalApi
      .get<unknown>("/api/track/company", "")
      .then((raw) => (cached = normalizePublicCompany(raw)))
      .catch(() => normalizePublicCompany(null))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** The company contact for a public page. Starts with the blank Carres default (nothing of another
 *  company's), then fills in from Settings > Branding. */
export function usePublicCompany(): PublicCompany {
  const [company, setCompany] = useState<PublicCompany>(() => cached ?? normalizePublicCompany(null));
  useEffect(() => {
    let alive = true;
    void loadPublicCompany().then((c) => {
      if (alive) setCompany(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return company;
}

/** Test seam: forget the cached answer. */
export function resetPublicCompanyCache(): void {
  cached = null;
  inflight = null;
}
