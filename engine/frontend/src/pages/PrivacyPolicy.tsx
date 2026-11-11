/**
 * The privacy policy — the live URL the iOS App Store submission points at
 * (https://erp.houzscentury.com/privacy).
 *
 * A PUBLIC SPA surface, not a static file, and that is a lesson, not a
 * preference: Cloudflare Pages 308-canonicalises every `*.html` asset to its
 * extensionless URL, directory indexes resolve the same way, and with the
 * `/* -> index.html` SPA rewrite in `_redirects` neither form ever reaches the
 * visitor — verified live twice on 2026-08-06 (BUG-HISTORY). Inside the SPA it
 * rides the same public-surface mechanism as /track.
 *
 * Content rule: whatever the app starts collecting must appear here AND in the
 * App Privacy answers in App Store Connect — the two must never disagree.
 *
 * Carres: the company name, registration, address and contact come from Settings > Branding (public read,
 * carres/publicBranding.ts), never Houzs's; a blank one is not printed. The policy text itself is Houzs's.
 */
import { publicAddressLines, usePublicCompany } from "../carres/publicBranding";

const ROWS: Array<[string, string]> = [
  [
    "Account details: your name, work email address, phone number, staff code, and role",
    "Signing you in and controlling what you can see and do in the system.",
  ],
  [
    "Employment records entered by the company, which can include your national identification (IC) number",
    "Payroll, commissions and statutory employment records.",
  ],
  [
    "Business records you create or appear in: sales orders, delivery orders, service cases, messages and approvals",
    "Running the company's operations. These are company business records, not personal profiles.",
  ],
  [
    "Location of the phone during an assigned delivery trip, including while the app is in the background",
    "Showing dispatch and the customer waiting for that delivery where the lorry is and when it will arrive. Tracking runs only during an assigned trip and stops when the trip is completed or cancelled.",
  ],
  [
    "Photos you take in the app: proof of delivery, odometer readings, workshop and supplier documents",
    "Delivery and maintenance records.",
  ],
  [
    "Technical logs: sign-in events, device type, and application errors",
    "Security and keeping the system working.",
  ],
];

const h2: React.CSSProperties = { fontSize: 17, margin: "28px 0 8px" };
const p: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.65 };
const meta: React.CSSProperties = { color: "#6b7263", fontSize: 13 };
const cell: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e2e4dc",
  padding: "8px 10px 8px 0",
  verticalAlign: "top",
  fontSize: 13.5,
  lineHeight: 1.55,
};

export function PrivacyPolicy() {
  const company = usePublicCompany(); // Carres
  const site = typeof window !== "undefined" ? window.location.host : "";
  const mail = company.email ? (
    <a href={`mailto:${company.email}`} style={{ color: "#2f6f68" }}>{company.email}</a>
  ) : null;
  return (
    <div style={{ background: "var(--hz-dk-surface-2, #fafaf7)", minHeight: "100vh", color: "#23281f" }}>
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 64px" }}>
        <h1 style={{ fontSize: 26, margin: "18px 0 4px" }}>Privacy Policy</h1>
        <p style={meta}>
          {company.companyName}{company.registrationNo ? ` (${company.registrationNo})` : ""} &middot; Last updated 6 August 2026
        </p>

        <p style={p}>
          This is an internal business application for the staff of {company.companyName} and its
          authorised partners (delivery carriers and dealers). It is not a consumer product. This page explains
          what personal data the application handles, why, and who can see it. It applies to the web application
          at {site || "this site"}.
        </p>

        <h2 style={h2}>What we collect and why</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...cell, color: "#6b7263", fontWeight: 600 }}>Data</th>
              <th style={{ ...cell, color: "#6b7263", fontWeight: 600 }}>Why it is collected</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([data, why]) => (
              <tr key={data}>
                <td style={cell}>{data}</td>
                <td style={cell}>{why}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 style={h2}>Face ID and fingerprint unlock</h2>
        <p style={p}>
          If you turn on biometric unlock in the iOS app, your sign-in session is stored in your phone's secure
          storage (the iOS Keychain) and unlocked with Face ID or Touch ID. The biometric check happens entirely
          on your device, through Apple's own mechanism. The app never receives, stores or transmits your face
          or fingerprint data, and we cannot access it.
        </p>

        <h2 style={h2}>Where the data lives</h2>
        <p style={p}>
          Data is processed by service providers acting on our instructions: Cloudflare, Inc. (application
          hosting and file storage) and Supabase (database hosting). If you use the iOS app, Apple processes
          push notification delivery. We do not sell personal data, we do not use it for advertising, and the
          app does not track you across other companies' apps or websites.
        </p>

        <h2 style={h2}>How long we keep it</h2>
        <p style={p}>
          Business records (orders, deliveries, service cases and the photos attached to them) are company
          records and are kept for as long as the company is required to keep them. Trip location fixes are kept
          as part of the delivery record of that trip. Accounts that leave the company are disabled; their
          historical records remain part of the business record.
        </p>

        <h2 style={h2}>Your rights</h2>
        <p style={p}>
          Under the Personal Data Protection Act 2010 (Malaysia) you may request access to, or correction of,
          your personal data. Write to {mail ?? "the company"}{mail ? " or" : ","}
          to the address below. Because this is a workplace system, some records (for example audit trails and
          business documents) are kept as required by law or by legitimate business need even after such a
          request.
        </p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>
          {company.companyName}
          {publicAddressLines(company).map((line, i) => (
            <span key={i}><br />{line}</span>
          ))}
          {mail && <><br />{mail}</>}
        </p>

        <p style={meta}>
          If this policy changes in a way that matters - new data collected, or a new use of existing data - the
          change will be dated here and announced inside the application.
        </p>
      </main>
    </div>
  );
}
