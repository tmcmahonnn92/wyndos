import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { preferenceLabel } from "@/lib/payment-preference";

export type RunSheetPdfRow = {
  n: number;
  name: string;
  address: string;
  area: string | null;
  phone: string;
  job: string | null;
  quote: boolean;
  price: string | null;
  owes: string | null;
  usually: string;
  slip: string;
  notes: string;
  done: boolean;
};

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 28, color: "#0f172a" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 10, color: "#475569", marginTop: 2, marginBottom: 10 },
  head: { flexDirection: "row", borderBottomWidth: 1.5, borderColor: "#0f172a", paddingBottom: 3, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#cbd5e1", paddingVertical: 4 },
  n: { width: 18 },
  who: { flex: 3, paddingRight: 4 },
  price: { width: 48, textAlign: "right", paddingRight: 6 },
  usual: { width: 42 },
  slip: { width: 24 },
  notes: { flex: 3, paddingRight: 4 },
  done: { width: 26, textAlign: "center" },
  cash: { width: 40, textAlign: "center", color: "#94a3b8" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#475569" },
  foot: { marginTop: 14, flexDirection: "row", gap: 24 },
});

export function RunSheetPDF({
  title,
  subtitle,
  rows,
  showPrices,
  total,
}: {
  title: string;
  subtitle: string;
  rows: RunSheetPdfRow[];
  showPrices: boolean;
  total: string;
}) {
  return (
    <Document title={title}>
      <Page size="A4" style={s.page} wrap>
        <Text style={s.h1}>{title}</Text>
        <Text style={s.sub}>{subtitle}</Text>
        <View style={s.head} fixed>
          <Text style={s.n}>#</Text>
          <Text style={s.who}>Customer / address</Text>
          {showPrices && <Text style={s.price}>Price</Text>}
          <Text style={s.usual}>Usually</Text>
          <Text style={s.slip}>Slip</Text>
          <Text style={s.notes}>Notes</Text>
          <Text style={s.done}>Done</Text>
          <Text style={s.cash}>Cash £</Text>
        </View>
        {rows.map((r) => (
          <View key={r.n} style={s.row} wrap={false}>
            <Text style={[s.n, s.bold]}>{r.n}</Text>
            <View style={s.who}>
              <Text style={s.bold}>{r.name}{r.area ? `  [${r.area}]` : ""}</Text>
              {r.address && r.address !== r.name ? <Text style={s.muted}>{r.address}</Text> : null}
              {r.job ? <Text style={s.muted}>{r.job}</Text> : null}
              {r.quote ? <Text style={s.bold}>QUOTE VISIT — £____ every ___ weeks</Text> : null}
              {r.phone ? <Text style={s.muted}>{r.phone}</Text> : null}
            </View>
            {showPrices && (
              <View style={s.price}>
                <Text>{r.quote ? "QUOTE" : r.price}</Text>
                {r.owes ? <Text style={s.bold}>owes {r.owes}</Text> : null}
              </View>
            )}
            <Text style={s.usual}>{r.usually}</Text>
            <Text style={s.slip}>{r.slip}</Text>
            <Text style={s.notes}>{r.notes}</Text>
            <Text style={s.done}>{r.done ? "[x]" : "[  ]"}</Text>
            <Text style={s.cash}>_____</Text>
          </View>
        ))}
        <View style={s.foot}>
          {showPrices && <Text><Text style={s.bold}>Day total: </Text>{total}</Text>}
          <Text><Text style={s.bold}>Cash collected: </Text>£________</Text>
        </View>
      </Page>
    </Document>
  );
}

export { preferenceLabel };
