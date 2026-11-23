import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Download, IndianRupee, Loader2, MessageCircle, Plus, Search, Wallet } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, useUi } from '@/components/ui';
import { PhoneLink } from '@/components/Contact';
import { usePlans } from '@/lib/api';
import { usePlatformExt } from '@/lib/apiExt';
import { cn, fmtDate, inr, todayISO } from '@/lib/format';
import { validPhone } from '@/lib/phone';
import { whatsappLink } from '@/lib/settings';
import { addMonthsTo, downloadCsv, istDay, istMonth, monthLabel, receiptText, thisMonthKey, useClients, useLedger, ymd, type ClientRow } from './platformShared';

const METHODS = ['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Other'];

/* ---------------------------------------------------------------- Mark as paid --- */
/** One step: the money you received + the new end date of their plan. `client` is preselected, or null to pick one. */
export function MarkPaidModal({ client, onClose }: { client: ClientRow | null; onClose: () => void }) {
  const { toast } = useUi();
  const { rows: clients } = useClients();
  const { all: plans } = usePlans();
  const { recordPayment } = usePlatformExt();
  const [tenantId, setTenantId] = useState(client?.id ?? '');
  const row = clients.find((c) => c.id === tenantId) ?? client;
  const startPlan = plans.find((p) => p.period === row?.period) ?? plans.find((p) => p.active) ?? plans[0];

  const [period, setPeriod] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState('UPI');
  const [reference, setReference] = useState('');
  const [extend, setExtend] = useState(true);
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState({ amount: false, until: false });
  const [done, setDone] = useState<{ text: string; phone: string } | null>(null);

  const chosen = plans.find((p) => p.period === period) ?? startPlan;
  const base = row && row.daysLeft != null && row.daysLeft >= 0 && row.daysLeft < 3650 && row.endsAt ? new Date(row.endsAt) : new Date();
  // plan, price and the new end date follow the chosen business and plan until you type your own
  useEffect(() => { if (!period && startPlan) setPeriod(startPlan.period); }, [startPlan, period]);
  useEffect(() => { if (chosen && !touched.amount) setAmount(chosen.price > 0 ? String(chosen.price) : ''); }, [chosen, touched.amount]);
  useEffect(() => { if (chosen && !touched.until) setUntil(ymd(addMonthsTo(chosen.months, base))); }, [chosen, touched.until, row?.endsAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!row) { toast('Choose the business.', 'error'); return; }
    const rupees = Number(amount);
    if (!(rupees > 0)) { toast('Enter the amount you received.', 'error'); return; }
    const end = extend ? new Date(`${until}T23:59:59+05:30`) : null;
    if (extend && (!until || Number.isNaN(end?.getTime()) || (end as Date).getTime() <= Date.now())) { toast('Choose a future date for the end of their plan.', 'error'); return; }
    recordPayment.mutate({ tenantId: row.id, amountRupees: rupees, paidOn, method, reference: reference.trim(), period: chosen?.period ?? null, until: end ? end.toISOString() : null, note: note.trim() }, {
      onSuccess: () => {
        toast('Payment recorded.');
        setDone({ phone: row.phone, text: receiptText({ business: row.name, amount: rupees, paidAt: new Date(`${paidOn}T12:00:00+05:30`).toISOString(), planName: chosen?.name, method, reference: reference.trim(), until: end ? end.toISOString() : null }) });
      },
      onError: (e) => toast(e.message, 'error'),
    });
  };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Receipt copied.'); } catch { toast('Copy is blocked in this browser.', 'error'); } };

  if (done) {
    return (
      <Modal title="Payment recorded" eyebrow={row?.name} onClose={onClose} width="max-w-md">
        <div className="space-y-4 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success-bg text-success"><CheckCircle2 size={26} /></span>
          <pre className="whitespace-pre-wrap rounded-xl border border-border bg-input p-4 text-left text-xs text-text-secondary">{done.text}</pre>
          <div className="flex flex-wrap justify-center gap-2">
            {validPhone(done.phone) && <a href={whatsappLink(done.phone, done.text)} target="_blank" rel="noreferrer"><Button variant="gold"><MessageCircle size={15} /> Send receipt on WhatsApp</Button></a>}
            <Button variant="outline" onClick={() => void copy(done.text)}><Copy size={15} /> Copy</Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={row ? row.name : 'Record a payment'} eyebrow="Mark as paid" onClose={onClose} width="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="gold" onClick={save} disabled={recordPayment.isPending}>{recordPayment.isPending ? <Loader2 size={15} className="animate-spin" /> : <IndianRupee size={15} />} Save payment</Button></>}>
      <div className="space-y-4">
        {!client && (
          <Field label="Business" required><Select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPeriod(''); setTouched({ amount: false, until: false }); }}>
            <option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select></Field>
        )}
        {row && <p className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-input px-3 py-2 text-xs text-text-secondary">Mobile: <PhoneLink phone={row.phone} /> · Plan ends: <span className="text-text">{row.endsAt && (row.daysLeft ?? 0) < 3650 ? fmtDate(row.endsAt) : '—'}</span></p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan paid for"><Select value={period} onChange={(e) => { setPeriod(e.target.value); setTouched({ amount: false, until: false }); }}>{plans.map((p) => <option key={p.period} value={p.period}>{p.name}{p.active ? '' : ' (off)'}</option>)}</Select></Field>
          <Field label="Amount received (₹)" required><Input type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setTouched((t) => ({ ...t, amount: true })); }} /></Field>
          <Field label="Paid on"><Input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label="Paid by"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label="Reference" hint="UTR / receipt no., optional" className="sm:col-span-2"><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
        </div>
        <div className="rounded-xl border border-border p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-text"><input type="checkbox" checked={extend} onChange={(e) => setExtend(e.target.checked)} className="size-4 accent-[var(--color-gold,#c9a14a)]" /> Also extend their plan</label>
          {extend && <Field label="Plan runs until" className="mt-3"><Input type="date" value={until} min={ymd(new Date(Date.now() + 86_400_000))} onChange={(e) => { setUntil(e.target.value); setTouched((t) => ({ ...t, until: true })); }} /></Field>}
        </div>
        <Field label="Private note" hint="only you see it"><Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Payments list --- */
export function PaymentsTab() {
  const { toast } = useUi();
  const { ledger, isLoading, error, refetch, isFetching } = useLedger();
  const [month, setMonth] = useState('all');
  const [method, setMethod] = useState('all');
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState(false);

  const months = useMemo(() => [...new Set(ledger.map((p) => istMonth(p.paidAt)))].sort().reverse(), [ledger]);
  const methods = useMemo(() => [...new Set(ledger.map((p) => p.method))].sort(), [ledger]);
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => ledger.filter((p) => (month === 'all' || istMonth(p.paidAt) === month) && (method === 'all' || p.method === method)
    && (!q || [p.business, p.reference, p.phone, p.ownerEmail ?? ''].some((v) => v.toLowerCase().includes(q)))), [ledger, month, method, q]);
  const total = rows.reduce((a, p) => a + p.amount, 0);
  const thisMonth = ledger.filter((p) => istMonth(p.paidAt) === thisMonthKey()).reduce((a, p) => a + p.amount, 0);
  const byMonth = useMemo(() => months.slice(0, 6).map((m) => ({ m, sum: ledger.filter((p) => istMonth(p.paidAt) === m).reduce((a, p) => a + p.amount, 0) })), [months, ledger]);

  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Receipt copied.'); } catch { toast('Copy is blocked in this browser.', 'error'); } };
  const receipt = (p: (typeof ledger)[number]) => receiptText({ business: p.business, amount: p.amount, paidAt: p.paidAt, planName: p.planName, method: p.method, reference: p.reference });
  const exportCsv = () => downloadCsv(`eventora-payments-${istDay(new Date().toISOString())}.csv`,
    ['Date', 'Business', 'Mobile', 'Owner email', 'Paid for', 'Paid by', 'Reference', 'Amount (INR)', 'Note'],
    rows.map((p) => [istDay(p.paidAt), p.business, p.phone, p.ownerEmail, p.planName, p.method, p.reference, p.amount, p.note]));

  if (isLoading) return <Spinner label="Loading payments" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Payments</h2><p className="mt-1 text-sm text-text-secondary">Every rupee you have received, with date, method and reference.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>{isFetching ? <Loader2 size={14} className="animate-spin" /> : 'Refresh'}</Button>
          <Button variant="gold" onClick={() => setRecording(true)}><Plus size={16} /> Record a payment</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5"><p className="text-xs text-text-secondary">Received this month</p><p className="tabular mt-1 font-display text-2xl font-semibold text-text">{inr(thisMonth)}</p></div>
        <div className="rounded-2xl border border-border bg-surface p-5"><p className="text-xs text-text-secondary">{month === 'all' && method === 'all' && !q ? 'All time' : 'Shown below'}</p><p className="tabular mt-1 font-display text-2xl font-semibold text-text">{inr(total)}</p><p className="text-[11px] text-text-disabled">{rows.length} payment{rows.length === 1 ? '' : 's'}</p></div>
        <div className="rounded-2xl border border-border bg-surface p-5"><p className="text-xs text-text-secondary">Last months</p>
          <ul className="mt-1 space-y-0.5 text-sm">{byMonth.length === 0 ? <li className="text-text-disabled">—</li> : byMonth.slice(0, 3).map((b) => <li key={b.m} className="flex justify-between"><span className="text-text-secondary">{monthLabel(b.m)}</span><span className="tabular font-medium text-text">{inr(b.sum)}</span></li>)}</ul></div>
      </div>

      <Card>
        <CardHeader title="All payments" subtitle={`${rows.length} shown`} action={
          <div className="flex flex-wrap items-center gap-2">
            <Select className="h-9 w-36 text-xs" value={month} onChange={(e) => setMonth(e.target.value)}><option value="all">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</Select>
            <Select className="h-9 w-36 text-xs" value={method} onChange={(e) => setMethod(e.target.value)}><option value="all">All methods</option>{methods.map((m) => <option key={m}>{m}</option>)}</Select>
            <div className="relative w-48"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" /><Input className="h-9 pl-9 text-xs" placeholder="Business or reference" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}><Download size={14} /> Export CSV</Button>
          </div>} />
        {rows.length === 0 ? <EmptyState icon={<Wallet size={20} />} title="No payments here" text="Use “Mark as paid” on a client, or “Record a payment”, and it appears in this list." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-text-disabled">
                <th className="px-5 py-3">Date</th><th className="px-5 py-3">Client</th><th className="px-5 py-3">Paid for</th><th className="px-5 py-3">Paid by</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3 text-right">Amount</th><th className="px-5 py-3 text-right">Receipt</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-3 text-text-secondary">{fmtDate(p.paidAt)}</td>
                    <td className="px-5 py-3"><p className="font-medium text-text">{p.business}</p><PhoneLink phone={p.phone} className="text-xs" /></td>
                    <td className="px-5 py-3 text-text-secondary">{p.planName ?? '—'}</td>
                    <td className="px-5 py-3"><Badge tone={p.offline ? 'neutral' : 'info'}>{p.method}</Badge></td>
                    <td className="px-5 py-3 font-mono text-xs text-text-secondary">{p.reference || '—'}</td>
                    <td className={cn('tabular px-5 py-3 text-right font-semibold text-text')}>{inr(p.amount)}</td>
                    <td className="px-5 py-3 text-right"><span className="inline-flex gap-1.5">
                      {validPhone(p.phone) && <a href={whatsappLink(p.phone, receipt(p))} target="_blank" rel="noreferrer" title="Send receipt on WhatsApp"><Button size="sm" variant="ghost"><MessageCircle size={14} /></Button></a>}
                      <Button size="sm" variant="ghost" title="Copy receipt" onClick={() => void copy(receipt(p))}><Copy size={14} /></Button>
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {recording && <MarkPaidModal client={null} onClose={() => setRecording(false)} />}
    </div>
  );
}
