import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1e293b",
    padding: 48,
    backgroundColor: "#ffffff",
  },
  // Header row
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 32,
  },
  logo: { width: 72, height: 72, objectFit: "contain" },
  businessBlock: { alignItems: "flex-end", maxWidth: 220 },
  businessName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#1e293b", marginBottom: 3 },
  businessDetail: { fontSize: 9, color: "#64748b", marginBottom: 1 },
  // Invoice title strip
  titleStrip: {
    backgroundColor: "#1e40af",
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  titleText: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  titleMeta: { alignItems: "flex-end" },
  titleMetaText: { fontSize: 9, color: "#bfdbfe" },
  titleMetaValue: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  // Bill to
  addressRow: { flexDirection: "row", marginBottom: 24, gap: 32 },
  addressBlock: { flex: 1 },
  addressLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  addressName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#1e293b", marginBottom: 2 },
  addressLine: { fontSize: 9, color: "#475569", marginBottom: 1 },
  // Table
  table: { marginBottom: 20 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  tableRowAlt: { backgroundColor: "#f8fafc" },
  colDate: { width: 80, fontSize: 9 },
  colDesc: { flex: 1, fontSize: 9 },
  colPrice: { width: 64, fontSize: 9, textAlign: "right" },
  colPaid: { width: 64, fontSize: 9, textAlign: "right" },
  colDue: { width: 64, fontSize: 9, textAlign: "right" },
  headerText: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 },
  // Totals
  totalsBlock: { alignItems: "flex-end", marginBottom: 24 },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 3, gap: 8 },
  totalLabel: { fontSize: 9, color: "#64748b", width: 100, textAlign: "right" },
  totalValue: { fontSize: 9, color: "#1e293b", width: 70, textAlign: "right" },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    backgroundColor: "#1e40af",
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 4,
    gap: 8,
  },
  grandTotalLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#ffffff", width: 100, textAlign: "right" },
  grandTotalValue: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#ffffff", width: 70, textAlign: "right" },
  // Bank details
  bankBox: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    padding: 12,
    marginBottom: 20,
  },
  bankLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5 },
  bankText: { fontSize: 9, color: "#475569", lineHeight: 1.5 },
  // Footer
  footer: { borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 12, marginTop: 8 },
  footerText: { fontSize: 8, color: "#94a3b8", textAlign: "center" },
  vatText: { fontSize: 8, color: "#94a3b8", textAlign: "center", marginTop: 2 },
});

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  business: {
    name: string;
    ownerName: string;
    phone: string;
    email: string;
    address: string;
    bankDetails: string;
    vatNumber: string;
    logoBase64?: string | null;
  };
  customer: {
    name: string;
    address: string;
    email: string;
  };
  jobs: Array<{
    id: number;
    date: string;
    description: string;
    price: number;
    paid: number;
  }>;
  subtotal: number;
  totalPaid: number;
  amountDue: number;
}

function fmt(n: number) {
  return `£${n.toFixed(2)}`;
}

export function InvoicePDF({ data }: { data: InvoiceData }) {
  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={data.business.name}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            {data.business.logoBase64 ? (
              <Image style={styles.logo} src={data.business.logoBase64} />
            ) : (
              <View style={{ width: 72 }} />
            )}
          </View>
          <View style={styles.businessBlock}>
            <Text style={styles.businessName}>{data.business.name}</Text>
            {data.business.ownerName ? <Text style={styles.businessDetail}>{data.business.ownerName}</Text> : null}
            {data.business.address
              ? data.business.address.split("\n").map((line, i) => (
                  <Text key={i} style={styles.businessDetail}>{line}</Text>
                ))
              : null}
            {data.business.phone ? <Text style={styles.businessDetail}>{data.business.phone}</Text> : null}
            {data.business.email ? <Text style={styles.businessDetail}>{data.business.email}</Text> : null}
          </View>
        </View>

        {/* Title strip */}
        <View style={styles.titleStrip}>
          <Text style={styles.titleText}>INVOICE</Text>
          <View style={styles.titleMeta}>
            <Text style={styles.titleMetaText}>Invoice Number</Text>
            <Text style={styles.titleMetaValue}>{data.invoiceNumber}</Text>
            <Text style={[styles.titleMetaText, { marginTop: 4 }]}>Date</Text>
            <Text style={styles.titleMetaValue}>{data.invoiceDate}</Text>
          </View>
        </View>

        {/* Bill to */}
        <View style={styles.addressRow}>
          <View style={styles.addressBlock}>
            <Text style={styles.addressLabel}>Bill To</Text>
            <Text style={styles.addressName}>{data.customer.name}</Text>
            {data.customer.address
              ? data.customer.address.split(",").map((part, i) => (
                  <Text key={i} style={styles.addressLine}>{part.trim()}</Text>
                ))
              : null}
            {data.customer.email ? <Text style={[styles.addressLine, { marginTop: 3 }]}>{data.customer.email}</Text> : null}
          </View>
        </View>

        {/* Jobs table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colDate, styles.headerText]}>Date</Text>
            <Text style={[styles.colDesc, styles.headerText]}>Description</Text>
            <Text style={[styles.colPrice, styles.headerText]}>Price</Text>
            <Text style={[styles.colPaid, styles.headerText]}>Paid</Text>
            <Text style={[styles.colDue, styles.headerText]}>Due</Text>
          </View>
          {data.jobs.map((job, i) => (
            <View key={job.id} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={styles.colDate}>{job.date}</Text>
              <Text style={styles.colDesc}>{job.description}</Text>
              <Text style={styles.colPrice}>{fmt(job.price)}</Text>
              <Text style={styles.colPaid}>{job.paid > 0 ? fmt(job.paid) : "—"}</Text>
              <Text style={styles.colDue}>{fmt(Math.max(0, job.price - job.paid))}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{fmt(data.subtotal)}</Text>
          </View>
          {data.totalPaid > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Payments received</Text>
              <Text style={[styles.totalValue, { color: "#16a34a" }]}>−{fmt(data.totalPaid)}</Text>
            </View>
          )}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Amount Due</Text>
            <Text style={styles.grandTotalValue}>{fmt(data.amountDue)}</Text>
          </View>
        </View>

        {/* Bank details */}
        {data.business.bankDetails ? (
          <View style={styles.bankBox}>
            <Text style={styles.bankLabel}>Payment Details</Text>
            <Text style={styles.bankText}>{data.business.bankDetails}</Text>
          </View>
        ) : null}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Thank you for your business — {data.business.name}</Text>
          {data.business.vatNumber ? (
            <Text style={styles.vatText}>VAT Registration: {data.business.vatNumber}</Text>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}
