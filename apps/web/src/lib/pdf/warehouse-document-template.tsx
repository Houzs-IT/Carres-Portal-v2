/**
 * WAREHOUSE AND CONSIGNMENT PAPER: one A4 layout for Stock Adjustment, Stock
 * Transfer, Stock Take, Customer Consignment Order, Consignment Note and
 * Customer Consignment Return, the documents Houzs prints (Weisiang, WhatsApp
 * 2026-10-22: implement Houzs). Plus the rack label sheet.
 *
 * It prints only what the caller holds, so an open blind count, whose Units the
 * API withholds, cannot print them.
 */
import { Document, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { NOTO_SANS_SC_FAMILY } from "./fonts/noto";
import { DocHeader } from "./letterhead";

export interface WarehouseDocTable {
  title: string;
  headers: string[];
  rows: string[][];
  /** Headers whose cells sit to the right. */
  numeric?: string[];
}
export interface WarehouseDocData {
  title: string;
  docNo: string;
  date: string;
  facts: [string, string][];
  tables: WarehouseDocTable[];
  /** Names of the signature boxes. */
  signatures?: string[];
}
export interface BinLabel { title: string; subtitle: string; qr: { size: number; path: string } }

const BORDER = "#D9D2C7";
const MUTED = "#7A7268";
const INK = "#1A1714";

const s = StyleSheet.create({
  page: { fontFamily: NOTO_SANS_SC_FAMILY, fontSize: 10, padding: 36, color: INK },
  facts: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
  fact: { width: "50%", marginBottom: 6, paddingRight: 8 },
  label: { fontSize: 8, color: MUTED },
  heading: { fontSize: 11, fontWeight: 700, marginTop: 6, marginBottom: 4 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: BORDER },
  cell: { flex: 1, paddingVertical: 4, paddingHorizontal: 3, fontSize: 9 },
  headCell: { flex: 1, paddingVertical: 4, paddingHorizontal: 3, fontSize: 8, fontWeight: 700, color: MUTED },
  right: { textAlign: "right" },
  signs: { flexDirection: "row", gap: 24, marginTop: 36 },
  sign: { flex: 1, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 4, fontSize: 8, color: MUTED },
  empty: { fontSize: 9, color: MUTED },
  labels: { flexDirection: "row", flexWrap: "wrap" },
  sticker: { width: "33.33%", alignItems: "center", padding: 10, borderWidth: 0.5, borderColor: BORDER },
  stickerTitle: { fontSize: 13, fontWeight: 700, marginTop: 6, textAlign: "center" },
  stickerSub: { fontSize: 8, color: MUTED, textAlign: "center" },
});

export function WarehouseDocumentTemplate(d: WarehouseDocData) {
  return (
    <Document title={`${d.title} ${d.docNo}`}>
      <Page size="A4" style={s.page}>
        <DocHeader docTitle={d.title.toUpperCase()} docMetaRows={[d.docNo, `Date: ${d.date}`]} />
        <View style={s.facts}>
          {d.facts.map(([k, v]) => (
            <View key={k} style={s.fact}><Text style={s.label}>{k}</Text><Text>{v || " "}</Text></View>
          ))}
        </View>
        {d.tables.map((t) => (
          <View key={t.title}>
            <Text style={s.heading}>{t.title}</Text>
            {t.rows.length === 0 ? <Text style={s.empty}>None.</Text> : (
              <>
                <View style={s.head} fixed>
                  {t.headers.map((h) => <Text key={h} style={t.numeric?.includes(h) ? [s.headCell, s.right] : s.headCell}>{h}</Text>)}
                </View>
                {t.rows.map((r, i) => (
                  <View key={i} style={s.row} wrap={false}>
                    {t.headers.map((h, j) => <Text key={h} style={t.numeric?.includes(h) ? [s.cell, s.right] : s.cell}>{r[j] ?? ""}</Text>)}
                  </View>
                ))}
              </>
            )}
          </View>
        ))}
        {d.signatures?.length ? (
          <View style={s.signs} wrap={false}>{d.signatures.map((n) => <Text key={n} style={s.sign}>{n}</Text>)}</View>
        ) : null}
      </Page>
    </Document>
  );
}

/** One QR sticker per Bin, three across. */
export function BinLabelsTemplate({ labels }: { labels: BinLabel[] }) {
  return (
    <Document title="Rack labels">
      <Page size="A4" style={s.page}>
        <View style={s.labels}>
          {labels.map((l, i) => (
            <View key={i} style={s.sticker} wrap={false}>
              <Svg width={96} height={96} viewBox={`0 0 ${l.qr.size} ${l.qr.size}`}><Path d={l.qr.path} fill={INK} /></Svg>
              <Text style={s.stickerTitle}>{l.title}</Text>
              <Text style={s.stickerSub}>{l.subtitle}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}
