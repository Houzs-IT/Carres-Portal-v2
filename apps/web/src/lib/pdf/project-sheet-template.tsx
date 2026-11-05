/**
 * PROJECT SHEET: one fair, exhibition or roadshow on paper (Projects slice 7).
 *
 * Weisiang's decision (Mr Lim, 2026-10-22): clear Carres rules, implement Houzs.
 * Jess was not part of this decision. Follows Houzs `projects_print.ts` (the Event
 * Summary Report): title and dates, overview, then the sections that have something
 * to say. Internal paper for the team, never handed to a customer. Built from the
 * reads the project page already holds, so the paper and the screen cannot disagree.
 * Words are in COPY-STANDARD "Projects words".
 */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  checklistDueDate, checklistProgress, projectDateRange, projectDurationDays,
  type ChecklistTask, type ProjectRow, type ProjectSalesOrder, type ProjectTeamMember,
} from "@carres/shared/projects";
import { NOTO_SANS_SC_FAMILY } from "./fonts/noto";
import { DocHeader, moneyDigits, niceDate } from "./letterhead";

export interface ProjectSheetData {
  project: ProjectRow;
  team: ProjectTeamMember[];
  checklist: ChecklistTask[];
  salesOrders: { orders: ProjectSalesOrder[]; totals: { count: number; total: number; paid: number; balance: number } } | null;
  printedAt: string;
}

const INK = "#1A1714";
const GREY = "#7A7268";
const HAIR = "#CFC9C0";

const STATUS: Record<ChecklistTask["status"], string> = { pending: "To do", done: "Done", na: "Not needed", blocked: "Blocked" };

const s = StyleSheet.create({
  page: { fontFamily: NOTO_SANS_SC_FAMILY, fontSize: 8, color: INK, paddingTop: 34, paddingBottom: 44, paddingHorizontal: 34 },
  title: { fontSize: 13, fontWeight: 700 },
  dates: { fontSize: 9, color: GREY, marginTop: 2, marginBottom: 12 },
  h2: { fontSize: 9, fontWeight: 700, marginTop: 12, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  cells: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "33.33%", paddingVertical: 3, paddingRight: 8 },
  k: { fontSize: 7, color: GREY },
  v: { fontSize: 8.5 },
  bar: { flexDirection: "row", backgroundColor: INK },
  th: { color: "#FFFFFF", fontSize: 7.5, fontWeight: 700, paddingVertical: 3, paddingHorizontal: 4, textTransform: "uppercase" },
  row: { flexDirection: "row", borderBottomWidth: 0.3, borderBottomColor: HAIR },
  group: { flexDirection: "row", borderBottomWidth: 0.3, borderBottomColor: HAIR, fontWeight: 700 },
  td: { fontSize: 7.5, paddingVertical: 3, paddingHorizontal: 4 },
  num: { textAlign: "right" },
  total: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: INK, fontWeight: 700 },
  quiet: { fontSize: 8, color: GREY },
  notes: { fontSize: 8.5, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 18, left: 34, right: 34, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: GREY },
});

function Cell({ k, v }: { k: string; v: string | number | null | undefined }) {
  if (v == null || v === "") return null;
  return (
    <View style={s.cell}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{String(v)}</Text>
    </View>
  );
}

export function ProjectSheetTemplate({ project: p, team, checklist, salesOrders, printedAt }: ProjectSheetData) {
  const sections = [...new Set(checklist.map((t) => t.section ?? ""))];
  const so = salesOrders;
  return (
    <Document title={p.code}>
      <Page size="A4" style={s.page}>
        <DocHeader docTitle="PROJECT SHEET" docMetaRows={[p.code, `Printed ${printedAt}`]} />
        <Text style={s.title}>{p.name}</Text>
        <Text style={s.dates}>
          {projectDateRange(p.startDate, p.endDate)}{p.picName ? ` · PIC ${p.picName}` : ""}
        </Text>

        <Text style={s.h2}>Overview</Text>
        <View style={s.cells}>
          <Cell k="Event type" v={p.eventType === "solo" ? "Solo" : p.eventType === "exhibition" ? "Exhibition" : null} />
          <Cell k="Brand" v={p.brand} />
          <Cell k="Venue" v={p.venue} />
          <Cell k="Venue address" v={p.venueAddress} />
          <Cell k="State" v={p.state} />
          <Cell k="Organizer" v={p.organizer} />
          <Cell k="Contractor" v={p.contractor} />
          <Cell k="Booth no" v={p.boothNo} />
          <Cell k="Size (sqm)" v={p.sizeSqm} />
          <Cell k="Days" v={projectDurationDays(p.startDate, p.endDate)} />
        </View>

        {team.length ? (
          <View>
            <Text style={s.h2}>Team</Text>
            <View style={s.cells}>
              {team.map((m) => <Cell key={m.id} k={m.role ?? "Team"} v={m.name ?? ""} />)}
            </View>
          </View>
        ) : null}

        {so && so.orders.length ? (
          <View>
            <Text style={s.h2}>Sales Orders</Text>
            <View style={s.bar} fixed>
              <Text style={[s.th, { width: "18%" }]}>SO No</Text>
              <Text style={[s.th, { width: "34%" }]}>Customer</Text>
              <Text style={[s.th, s.num, { width: "16%" }]}>Total (RM)</Text>
              <Text style={[s.th, s.num, { width: "16%" }]}>Paid (RM)</Text>
              <Text style={[s.th, s.num, { width: "16%" }]}>Balance (RM)</Text>
            </View>
            {so.orders.map((o) => (
              <View key={o.id} style={s.row} wrap={false}>
                <Text style={[s.td, { width: "18%" }]}>{o.so}</Text>
                <Text style={[s.td, { width: "34%" }]}>{o.status === "cancelled" ? `${o.customerName ?? ""} · Cancelled` : o.customerName ?? ""}</Text>
                <Text style={[s.td, s.num, { width: "16%" }]}>{o.total == null ? "No value" : moneyDigits(o.total)}</Text>
                <Text style={[s.td, s.num, { width: "16%" }]}>{moneyDigits(o.paid)}</Text>
                <Text style={[s.td, s.num, { width: "16%" }]}>{moneyDigits(o.balance)}</Text>
              </View>
            ))}
            <View style={s.total} wrap={false}>
              <Text style={[s.td, { width: "52%" }]}>{`TOTAL · ${so.totals.count} ${so.totals.count === 1 ? "order" : "orders"}, cancelled left out`}</Text>
              <Text style={[s.td, s.num, { width: "16%" }]}>{moneyDigits(so.totals.total)}</Text>
              <Text style={[s.td, s.num, { width: "16%" }]}>{moneyDigits(so.totals.paid)}</Text>
              <Text style={[s.td, s.num, { width: "16%" }]}>{moneyDigits(so.totals.balance)}</Text>
            </View>
          </View>
        ) : null}

        {checklist.length ? (
          <View>
            <Text style={s.h2}>Checklist · {checklistProgress(checklist)}% done</Text>
            <View style={s.bar} fixed>
              <Text style={[s.th, { width: "46%" }]}>Task</Text>
              <Text style={[s.th, { width: "18%" }]}>Due</Text>
              <Text style={[s.th, { width: "14%" }]}>Status</Text>
              <Text style={[s.th, { width: "22%" }]}>Finished</Text>
            </View>
            {sections.map((sec) => (
              <View key={sec || "none"}>
                {sec ? <View style={s.group} wrap={false}><Text style={s.td}>{sec}</Text></View> : null}
                {checklist.filter((t) => (t.section ?? "") === sec).map((t) => (
                  <View key={t.id} style={s.row} wrap={false}>
                    <Text style={[s.td, { width: "46%" }]}>{t.title}</Text>
                    <Text style={[s.td, { width: "18%" }]}>{niceDate(checklistDueDate(p.startDate, t.dueOffsetDays)) ?? ""}</Text>
                    <Text style={[s.td, { width: "14%" }]}>{STATUS[t.status]}</Text>
                    <Text style={[s.td, { width: "22%" }]}>
                      {t.completedAt ? `${niceDate(t.completedAt)}${t.completedByName ? ` · ${t.completedByName}` : ""}` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {p.notes ? (
          <View>
            <Text style={s.h2}>Notes</Text>
            <Text style={s.notes}>{p.notes}</Text>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{p.code}</Text>
          <Text>This is a computer generated document. No signature is required.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
