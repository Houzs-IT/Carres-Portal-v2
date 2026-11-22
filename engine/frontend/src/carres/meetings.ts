// Carres only (not part of Houzs's code). The Meetings page runs inside the portal's frame, whose own address is
// the engine site; a guest booking link must carry the address Carres staff and guests know, erp.carresofficial.com
// (owner, 22 Nov 2026: a link uses the address of the ERP it was made in). The portal sends /book/* on to the
// engine site (apps/web/public/_redirects), where the no-login booking page lives.
export const CARRES_BOOKING_ORIGIN = "https://erp.carresofficial.com";
