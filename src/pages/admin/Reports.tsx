import { useMemo, useState } from 'react';
import { BellRing, Download, Eye, FileSpreadsheet, Loader2, Mail, MessageCircle, Phone, Printer } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Modal, Select, Spinner, useUi } from '@/components/ui';
import { RangePicker } from '@/components/RangePicker';
import { StatusBadge } from '@/components/PaymentBadge';
import { useBusiness, useLogActivity, usePayment, useQuotes } from '@/lib/api';
import { paymentRequest } from '@/lib/activity';
import { dueInfo, dueMessage, emailDueLink, whatsappDueLink } from '@/lib/dues';
import type { Quote } from '@/lib/types';
import { useBranchScope } from '@/lib/branch';
import { formatEventDates, inr, inrCompact } from '@/lib/format';
import { dayOf, inPeriod, loadRange, resolveRange, saveRange, type RangeState } from '@/lib/range';
import { earliestDate } from '@/lib/stats';
import { quoteDates, quotePaymentState } from '@/lib/pricing';
import { buildReportBlob, saveBlob } from '@/pdf/generate';
import { usePdfPreview } from '@/components/PdfPreview';

type PayFilter = 'all' | 'paid' | 'unpaid';
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export function Reports() {
  const { data: quotes = [], isLoading } = useQuotes();
  const { business } = useBusiness();
  const { toast } = useUi();
  const [range, setRange] = useState<RangeState>(() => loadRange('reports'));
  const [basis, setBasis] = useState<'event' | 'created'>('event');
  const [busy, setBusy] = useState(false);
  const [payFilter, setPayFilter] = useState<PayFilter>('all');
  const [sendOpen, setSendOpen] = useState(false);
  const { payment: paySettings } = usePayment();
  const logActivity = useLogActivity();

  const r = useMemo(() => resolveRange(range, earliestDate(quotes)), [range, quotes]);
  const rows = useMemo(() => quotes.filter((q) => inPeriod(basis === 'event' ? quoteDates(q.customer)[0] ?? dayOf(q.createdAt) : q.createdAt, r)).filter((q) => { const d = dueInfo(q); return payFilter === 'all' || (payFilter === 'paid' ? d.isPaid : d.isUnpaid); }), [quotes, r, basis, payFilter]);
  const dueRows = useMemo(() => rows.filter((q) => dueInfo(q).isUnpaid), [rows]);
  const { current: viewBranch } = useBranchScope();
  const { preview: openPreview, element: previewElement } = usePdfPreview();

  if (isLoading) return <Spinner label="Loading reports" />;

  const sum = rows.reduce((a, q) => { const p = quotePaymentState(q.pricing); return { total: a.total + q.pricing.grandTotal, recv: a.recv + p.received, bal: a.bal + p.balance, booked: a.booked + (q.status === 'confirmed' ? 1 : 0) }; }, { total: 0, recv: 0, bal: 0, booked: 0 });
  const title = `Report — ${r.label}${viewBranch ? ` · ${viewBranch.name}` : ''}${payFilter === 'all' ? '' : payFilter === 'paid' ? ' · Paid' : ' · Unpaid'}`;
  const fileKey = `${r.from}_${r.to}`;

  const pdf = () => openPreview({ title, eyebrow: 'Report preview', filename: `eventora-report-${fileKey}.pdf`, build: () => buildReportBlob(title, rows, business) });

  const csv = () => {
    const head = ['Bill no', 'Customer', 'Mobile', 'Email', 'Event', 'Dates', 'Guests', 'Status', 'Total', 'Received', 'Balance', 'Payment'];
    const body = rows.map((q) => { const p = quotePaymentState(q.pricing); return [q.reference, q.customer.name, q.customer.mobile, q.customer.email ?? '', q.customer.eventType, formatEventDates(quoteDates(q.customer)), q.customer.guests, q.status === 'confirmed' ? 'Booked' : 'Enquiry', Math.round(q.pricing.grandTotal), Math.round(p.received), Math.round(p.balance), p.balance <= 0 ? 'Paid' : p.received > 0 ? 'Part paid' : 'Unpaid']; });
    saveBlob(new Blob([[head, ...body].map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), `eventora-report-${fileKey}.csv`);
  };

  const noteSent = (q: Quote, via: string) => { void logActivity(paymentRequest(q, dueInfo(q).balance)); toast(`${via} opened for ${q.customer.name}. Press Send there.`, 'info'); };

  return (
    <div className="space-y-6">
      {previewElement}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><h2 className="font-display text-2xl font-semibold text-text">Reports</h2><p className="mt-1 text-sm text-text-secondary">Choose any period, then download a PDF or spreadsheet. The report follows the branch you chose at the top.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="gold" onClick={pdf} disabled={busy || rows.length === 0}><Eye size={15} /> Preview PDF report</Button>
          <Button variant="outline" onClick={csv} disabled={rows.length === 0}><FileSpreadsheet size={15} /> CSV</Button>
          <Button variant="outline" onClick={() => setSendOpen(true)} disabled={dueRows.length === 0}><BellRing size={15} /> Send payment requests{dueRows.length > 0 ? ` (${dueRows.length})` : ''}</Button>
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <RangePicker value={range} onChange={(v) => { setRange(v); saveRange('reports', v); }} earliest={earliestDate(quotes)} grouping={false} />
        <Select value={basis} onChange={(e) => setBasis(e.target.value as 'event' | 'created')} className="h-10 w-52" aria-label="Count bills by"><option value="event">By event date</option><option value="created">By date bill was made</option></Select>
        <div className="flex gap-1 rounded-xl border border-border bg-surface p-1" role="group" aria-label="Payment status">
          {([['all', 'All'], ['paid', 'Paid'], ['unpaid', 'Unpaid']] as const).map(([id, l]) => <button key={id} type="button" onClick={() => setPayFilter(id)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${payFilter === id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text'}`}>{l}</button>)}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[['Quotations', String(rows.length)], ['Booked', String(sum.booked)], ['Total value', inrCompact(sum.total)], ['Collected', inrCompact(sum.recv)], ['Outstanding', inrCompact(sum.bal)]].map(([l, v]) => (
          <Card key={l} className="p-5"><p className="text-xs text-text-secondary">{l}</p><p className="mt-1 text-2xl font-semibold text-text tabular">{v}</p></Card>
        ))}
      </div>

      <Card>
        <CardHeader title={title} subtitle={`${rows.length} record${rows.length === 1 ? '' : 's'}`} action={<Button variant="ghost" size="sm" onClick={() => window.print()}><Printer size={14} /> Print</Button>} />
        {rows.length === 0 ? <EmptyState icon={<FileSpreadsheet />} title="No records" text="Nothing matches this period." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-text-disabled"><th className="px-5 py-3">Bill</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Total</th><th className="px-5 py-3 text-right">Received</th><th className="px-5 py-3 text-right">Balance</th><th className="px-5 py-3 text-right">Remind</th></tr></thead>
              <tbody>
                {rows.map((q) => { const p = quotePaymentState(q.pricing); return (
                  <tr key={q.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-gold">{q.reference}</td>
                    <td className="px-5 py-3"><p className="font-medium text-text">{q.customer.name}</p><p className="text-xs text-text-secondary">{q.customer.eventType}</p></td>
                    <td className="px-5 py-3 text-xs text-text-secondary"><p className="flex items-center gap-1.5"><Phone size={12} />{q.customer.mobile || '—'}</p><p className="mt-0.5 flex items-center gap-1.5"><Mail size={12} />{q.customer.email || '—'}</p></td>
                    <td className="px-5 py-3 text-text-secondary">{formatEventDates(quoteDates(q.customer))}</td>
                    <td className="px-5 py-3"><StatusBadge status={q.status} /></td>
                    <td className="px-5 py-3 text-right font-semibold tabular text-text">{inr(q.pricing.grandTotal)}</td>
                    <td className="px-5 py-3 text-right tabular text-success">{inr(p.received)}</td>
                    <td className="px-5 py-3 text-right tabular text-warning">{inr(p.balance)}</td>
                    <td className="px-5 py-3 text-right">{p.balance > 0 ? <span className="inline-flex gap-1.5"><a href={whatsappDueLink(q, business, paySettings)} target="_blank" rel="noreferrer" onClick={() => noteSent(q, 'WhatsApp')} title={p.received > 0 ? 'Send payment reminder on WhatsApp' : 'Send payment request on WhatsApp'}><Button size="sm" variant="outline"><MessageCircle size={13} /></Button></a>{q.customer.email ? <a href={emailDueLink(q, business, paySettings)} onClick={() => noteSent(q, 'E-mail')} title="Send by e-mail"><Button size="sm" variant="outline"><Mail size={13} /></Button></a> : null}</span> : <Badge tone="success">Paid</Badge>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {sendOpen && (
        <Modal title={`Payment requests (${dueRows.length})`} eyebrow="Reports" onClose={() => setSendOpen(false)} width="max-w-2xl" footer={<Button variant="gold" onClick={() => setSendOpen(false)}>Done</Button>}>
          <p className="mb-3 text-xs text-text-secondary">Customers in this report who still owe money. WhatsApp or your e-mail app opens with the message ready for each person; you press Send. Customers who already paid part get a <strong className="text-text">reminder</strong>, the rest get a <strong className="text-text">payment request</strong>.</p>
          <ul className="max-h-[420px] divide-y divide-border/60 overflow-y-auto rounded-xl border border-border">
            {dueRows.map((q) => { const d = dueInfo(q); const m = dueMessage(q, business, paySettings); return (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="flex items-center gap-2 font-medium text-text">{q.customer.name}<Badge tone={m.kind === 'reminder' ? 'warning' : 'info'}>{m.kind === 'reminder' ? 'Reminder' : 'Request'}</Badge></span><span className="block truncate text-[11px] text-text-disabled">{q.reference} · {q.customer.mobile || 'no mobile'}{q.customer.email ? ` · ${q.customer.email}` : ''}</span></span>
                <span className="flex items-center gap-2"><span className="font-semibold text-warning tabular">{inr(d.balance)}</span>
                  <a href={whatsappDueLink(q, business, paySettings)} target="_blank" rel="noreferrer" onClick={() => noteSent(q, 'WhatsApp')}><Button size="sm" variant="outline"><MessageCircle size={13} /> WhatsApp</Button></a>
                  {q.customer.email ? <a href={emailDueLink(q, business, paySettings)} onClick={() => noteSent(q, 'E-mail')}><Button size="sm" variant="outline"><Mail size={13} /> E-mail</Button></a> : <span className="text-[11px] text-text-disabled">no e-mail</span>}
                </span>
              </li>
            ); })}
          </ul>
        </Modal>
      )}
    </div>
  );
}
