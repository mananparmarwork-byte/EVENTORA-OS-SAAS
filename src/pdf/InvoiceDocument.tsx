/**
 * Eventora OS — subscription invoice (what you send to a business after you approve their renewal / extra branch).
 * The WHOLE layout is in this one file. Built-in PDF fonts, so money is written as "INR 1,499.00".
 */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { fmtDate } from '@/lib/format';
import type { Invoice } from '@/lib/types';

const C = { navy: '#0B1733', gold: '#B8861B', goldBright: '#E6B84A', ink: '#1B2437', muted: '#667085', line: '#E4E1D6', white: '#FFFFFF', green: '#2F7D55', ivory: '#F7F5EF' };
const money = (n: number) => `INR ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)}`;

const s = StyleSheet.create({
  page: { paddingBottom: 60, fontFamily: 'Helvetica', fontSize: 9.5, color: C.ink, backgroundColor: C.white },
  band: { backgroundColor: C.navy, paddingHorizontal: 40, paddingTop: 30, paddingBottom: 24, flexDirection: 'row', justifyContent: 'space-between' },
  gold: { height: 3, backgroundColor: C.goldBright },
  name: { fontFamily: 'Times-Bold', fontSize: 20, color: C.white },
  sub: { fontSize: 8.5, color: '#C9D1E3', marginTop: 3, lineHeight: 1.4, maxWidth: 260 },
  title: { fontFamily: 'Times-Bold', fontSize: 24, color: C.goldBright, textAlign: 'right' },
  meta: { fontSize: 9, color: '#C9D1E3', textAlign: 'right', marginTop: 4 },
  body: { paddingHorizontal: 40, paddingTop: 24 },
  cols: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  box: { width: '48%', backgroundColor: C.ivory, borderRadius: 6, padding: 12 },
  label: { fontSize: 7.5, color: C.gold, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5, fontFamily: 'Helvetica-Bold' },
  strong: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 2 },
  line: { color: C.muted, lineHeight: 1.45 },
  th: { flexDirection: 'row', backgroundColor: C.navy, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 4 },
  thText: { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8.5, letterSpacing: 0.6, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: 0.7, borderBottomColor: C.line },
  cDesc: { flex: 1, paddingRight: 12 }, cAmt: { width: 110, textAlign: 'right' },
  totals: { marginTop: 14, marginLeft: 'auto', width: 250 },
  tot: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3.5 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.navy, borderRadius: 5, paddingVertical: 9, paddingHorizontal: 10, marginTop: 6 },
  paid: { marginTop: 14, borderWidth: 1, borderColor: C.green, borderRadius: 6, padding: 10, flexDirection: 'row', justifyContent: 'space-between' },
  small: { fontSize: 8.5, color: C.muted, lineHeight: 1.5 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'center', fontSize: 8, color: C.muted },
});

const partyLines = (p: { address?: string; phone?: string; email?: string; gstin?: string; pan?: string }) =>
  [p.address, p.phone && `Phone: ${p.phone}`, p.email, p.gstin && `GSTIN: ${p.gstin}`, p.pan && `PAN: ${p.pan}`].filter(Boolean) as string[];

export function InvoiceDocument({ invoice: i }: { invoice: Invoice }) {
  const seller = i.seller;
  return (
    <Document title={`Invoice ${i.number}`} author={seller.name || 'Eventora OS'}>
      <Page size="A4" style={s.page}>
        <View style={s.band}>
          <View>
            <Text style={s.name}>{seller.name || 'Eventora OS'}</Text>
            {partyLines(seller).map((l) => <Text key={l} style={s.sub}>{l}</Text>)}
          </View>
          <View>
            <Text style={s.title}>INVOICE</Text>
            <Text style={s.meta}>No. {i.number}</Text>
            <Text style={s.meta}>Date: {fmtDate(i.issuedAt)}</Text>
          </View>
        </View>
        <View style={s.gold} />

        <View style={s.body}>
          <View style={s.cols}>
            <View style={s.box}>
              <Text style={s.label}>Billed to</Text>
              <Text style={s.strong}>{i.billTo.name || i.business}</Text>
              {partyLines(i.billTo).map((l) => <Text key={l} style={s.line}>{l}</Text>)}
            </View>
            <View style={s.box}>
              <Text style={s.label}>Subscription</Text>
              {i.planName ? <Text style={s.strong}>{i.planName} plan</Text> : null}
              {i.periodTo ? <Text style={s.line}>{i.periodFrom ? `${fmtDate(i.periodFrom)} to ` : 'Until '}{fmtDate(i.periodTo)}</Text> : <Text style={s.line}>Extra branch add-on</Text>}
              {i.paymentRef ? <Text style={s.line}>Payment ref: {i.paymentRef}</Text> : null}
            </View>
          </View>

          <View style={s.th}><Text style={[s.thText, s.cDesc]}>Description</Text><Text style={[s.thText, s.cAmt]}>Amount</Text></View>
          {i.items.map((it, idx) => (
            <View key={idx} style={s.tr} wrap={false}><Text style={s.cDesc}>{it.description}</Text><Text style={s.cAmt}>{money(it.amount)}</Text></View>
          ))}

          <View style={s.totals} wrap={false}>
            {i.gstEnabled && <View style={s.tot}><Text style={s.line}>Taxable value</Text><Text>{money(i.subtotal)}</Text></View>}
            {i.gstEnabled && <View style={s.tot}><Text style={s.line}>GST @ {i.gstRate}% (included)</Text><Text>{money(i.gst)}</Text></View>}
            <View style={s.grand}><Text style={{ color: C.white, fontFamily: 'Helvetica-Bold' }}>Total</Text><Text style={{ color: C.goldBright, fontFamily: 'Helvetica-Bold', fontSize: 11 }}>{money(i.total)}</Text></View>
          </View>

          <View style={s.paid} wrap={false}>
            <Text style={{ color: C.green, fontFamily: 'Helvetica-Bold' }}>PAID{i.paidOn ? ` on ${fmtDate(i.paidOn)}` : ''}</Text>
            <Text style={{ color: C.green, fontFamily: 'Helvetica-Bold' }}>{money(i.paid)}</Text>
          </View>

          {i.notes ? <View style={{ marginTop: 16 }}><Text style={s.label}>Notes</Text><Text style={s.small}>{i.notes}</Text></View> : null}
          {seller.terms ? <View style={{ marginTop: 14 }}><Text style={s.label}>Terms</Text><Text style={s.small}>{seller.terms}</Text></View> : null}
        </View>
        <Text style={s.footer} fixed>{seller.footer || 'Thank you for choosing Eventora OS.'}</Text>
      </Page>
    </Document>
  );
}
