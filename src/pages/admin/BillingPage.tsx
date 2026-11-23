import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, Building2, CheckCircle2, Clock, Copy, Download, FileText, Landmark, Loader2, MessageCircle, Minus, Plus, Send, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Spinner, Switch, useUi } from '@/components/ui';
import { UpiQr } from '@/components/UpiQr';
import { useBranchInfo } from '@/lib/branch';
import { MobileField, useMobile } from '@/components/MobileField';
import { PHONE_ERROR, validPhone } from '@/lib/phone';
import { useBillingQuote, useCreateRequest, useMyInvoices, useMyRequests, usePaymentInfo } from '@/lib/apiExt';
import { useBusiness, usePlans, useSubscription } from '@/lib/api';
import { cn, fmtDate, inr, todayISO } from '@/lib/format';
import { perLabel, planName } from '@/lib/plans';
import { isValidUpiId, whatsappLink } from '@/lib/settings';
import { buildInvoiceBlob, invoiceFileName, saveBlob } from '@/pdf/generate';
import type { Invoice, Subscription } from '@/lib/types';

const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5)) : 0);

/** One plain sentence about the plan. Access is switched on by the Eventora team after payment (manual). */
export function statusLine(s: Subscription, label: string): { tone: 'success' | 'warning' | 'error' | 'info'; title: string; text: string } {
  if (s.status === 'trialing') {
    if (!s.writable) return { tone: 'error', title: 'Your free trial has ended', text: 'The software is locked. Your data is safe. Pay below and send the request: we switch it on.' };
    const d = daysLeft(s.trialEndsAt);
    return { tone: 'info', title: `Free trial: ${d} day${d === 1 ? '' : 's'} left`, text: `Your trial ends on ${fmtDate(s.trialEndsAt ?? '')}. Pay before then to continue without a break.` };
  }
  if (s.status === 'active') {
    if (!s.writable) return { tone: 'error', title: 'Your access has ended', text: 'The software is locked. Pay below and send the request. Your data is safe.' };
    const d = daysLeft(s.currentPeriodEnd);
    if (s.currentPeriodEnd && d >= 3650) return { tone: 'success', title: `${label} access is active`, text: 'Your access has no end date.' };
    return d <= 7
      ? { tone: 'warning', title: `Your plan ends in ${d} day${d === 1 ? '' : 's'}`, text: `Active until ${fmtDate(s.currentPeriodEnd ?? '')}. Renew early so your team is not locked out.` }
      : { tone: 'success', title: `${label} plan is active`, text: s.currentPeriodEnd ? `Active until ${fmtDate(s.currentPeriodEnd)}.` : 'Your plan is active.' };
  }
  if (s.status === 'past_due') return { tone: 'warning', title: 'A payment is due', text: 'Please pay and send the request. Access will stop in a few days if it stays unpaid.' };
  if (s.status === 'cancelled') return s.writable
    ? { tone: 'warning', title: 'Your plan is ending', text: `You can keep using Eventora until ${fmtDate(s.currentPeriodEnd ?? '')}, then it locks.` }
    : { tone: 'error', title: 'Your access has ended', text: 'The software is locked. Pay below and send the request.' };
  return { tone: 'error', title: 'Your access has ended', text: 'The software is locked. Pay below and send the request.' };
}

const REQ_TONE = { pending: 'warning', approved: 'success', rejected: 'error', closed: 'neutral' } as const;
const MAX_NEW = 5;

function InvoiceRow({ inv }: { inv: Invoice }) {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const get = async () => { setBusy(true); try { saveBlob(await buildInvoiceBlob(inv), invoiceFileName(inv)); } catch (e) { toast(e instanceof Error ? e.message : 'Could not make the PDF.', 'error'); } finally { setBusy(false); } };
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
      <span className="min-w-0"><span className="block font-medium text-text">{inv.number}</span><span className="block truncate text-xs text-text-secondary">{fmtDate(inv.issuedAt)} · {inv.items.map((i) => i.description).join(', ')}</span></span>
      <span className="flex items-center gap-3"><span className="font-semibold text-text tabular">{inr(inv.total)}</span><Button size="sm" variant="outline" onClick={() => void get()} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF</Button></span>
    </li>
  );
}

/** Billing: plan status, choose what to pay for (renew and/or extra branches), pay by UPI QR, send the transaction ID. */
export function BillingPage() {
  const { toast } = useUi();
  const { sub, isLoading } = useSubscription();
  const { all: allPlans, plans } = usePlans();
  const { info } = usePaymentInfo(true);
  const { info: branchInfo } = useBranchInfo();
  const { business } = useBusiness();
  const { data: requests = [] } = useMyRequests(true);
  const { data: invoices = [] } = useMyInvoices(true);
  const create = useCreateRequest();

  const extras = Math.max(0, branchInfo.limit - 1);
  const canSkipRenew = Boolean(sub && sub.status === 'active' && sub.writable);
  const [renew, setRenew] = useState(true);
  const [period, setPeriod] = useState('');
  const [keep, setKeep] = useState(0);
  const [names, setNames] = useState<string[]>([]);
  const [mobile, setMobile] = useMobile();
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const inited = useRef(false);

  // sensible starting choices once the plan is known: renew when it is ending / ended, otherwise just branches
  useEffect(() => {
    if (inited.current || !sub || plans.length === 0) return;
    inited.current = true;
    const ending = !(sub.status === 'active' && sub.writable) || daysLeft(sub.currentPeriodEnd) <= 7;
    setRenew(ending);
    setPeriod(plans.some((p) => p.period === sub.period) ? (sub.period as string) : plans[0].period);
  }, [sub, plans]);
  // by default every extra branch you already have is kept; once you change it yourself it stays as you set it
  const keepTouched = useRef(false);
  useEffect(() => { setKeep((k) => (keepTouched.current ? Math.min(Math.max(k, 0), extras) : extras)); }, [extras]);

  const effRenew = renew || !canSkipRenew;
  const wantsAnything = effRenew || names.length > 0;
  const quote = useBillingQuote({ renew: effRenew, period: effRenew ? period : '', keep: effRenew ? keep : extras, newCount: names.length }, Boolean(sub) && wantsAnything && (!effRenew || period !== ''));
  const q = quote.data;
  useEffect(() => { if (q) setAmount(String(q.total)); }, [q?.total]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <Spinner label="Loading billing" />;
  const line = sub ? statusLine(sub, planName(allPlans, sub.period)) : null;
  const Icon = line?.tone === 'success' ? CheckCircle2 : line?.tone === 'info' ? Clock : AlertTriangle;
  const cls = { success: 'border-success/30 bg-success-bg text-success', warning: 'border-warning/30 bg-warning-bg text-warning', error: 'border-error/30 bg-error-bg text-error', info: 'border-info/30 bg-info/10 text-info' };
  const total = q?.total ?? 0;
  const bp = info.branchPrice ?? 0;
  const copy = async (v: string, what: string) => { try { await navigator.clipboard.writeText(v); toast(`${what} copied.`); } catch { toast(v, 'info'); } };
  const wa = (info.whatsapp ?? '').replace(/\D/g, '');
  const upiOk = isValidUpiId(info.upi ?? '');
  const needsRef = total > 0;

  const send = () => {
    if (!q) { toast(quote.error?.message ?? 'Choose what you want to pay for.', 'error'); return; }
    if (!validPhone(mobile)) { toast(PHONE_ERROR, 'error'); return; }
    if (names.some((n) => n.trim().length < 2)) { toast('Enter a name for every new branch.', 'error'); return; }
    if (needsRef && reference.trim().length < 4) { toast('Enter the UPI transaction ID (UTR) so we can find your payment.', 'error'); return; }
    create.mutate({ kind: 'renewal', payload: { contact: mobile.trim(), renew: effRenew, period: effRenew ? period : '', keep: effRenew ? keep : extras, newBranches: names.map((n) => ({ name: n.trim() })), reference: reference.trim(), amount: amount.trim() || String(total), paidOn } },
      { onSuccess: () => { toast('Request sent. We will check the payment and switch everything on.'); setReference(''); setNames([]); }, onError: (e) => toast(e.message, 'error') });
  };

  const pending = requests.filter((r) => r.kind !== 'support' && r.status === 'pending');
  const history = requests.filter((r) => r.kind !== 'support');

  return (
    <div className="space-y-6">
      {line && sub && (
        <div className={`flex items-start gap-3 rounded-2xl border p-5 ${cls[line.tone]}`}>
          <Icon size={20} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1"><p className="font-semibold">{line.title}</p><p className="mt-0.5 text-sm opacity-90">{line.text}</p></div>
          <Badge tone="neutral" className="shrink-0">{sub.status.replace('_', ' ')}</Badge>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        {/* ---------------------------------------------- what to pay for */}
        <Card>
          <CardHeader title="What do you want to pay for?" subtitle="Choose a renewal, extra branches, or both in one payment" />
          <div className="space-y-6 p-5">
            <div className="space-y-4">
              <Switch checked={effRenew} onChange={setRenew} disabled={!canSkipRenew} label="Renew / change my plan" description={canSkipRenew ? 'Switch off if you only want to add a branch to your running plan.' : 'Your plan is not running, so a renewal is needed.'} />
              {effRenew && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {plans.map((p) => (
                    <button key={p.period} type="button" onClick={() => setPeriod(p.period)} className={cn('rounded-xl border p-3 text-left transition-colors', period === p.period ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/50')}>
                      <p className="text-sm font-semibold text-text">{p.name}</p><p className="text-lg font-semibold text-gold tabular">{inr(p.price)}</p><p className="text-[11px] text-text-secondary">{perLabel(p.months)}</p>
                    </button>
                  ))}
                  {plans.length === 0 && <p className="text-sm text-text-secondary sm:col-span-2">No plans are listed yet. Message us and we will set one for you.</p>}
                </div>
              )}
            </div>

            {effRenew && extras > 0 && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-text">Extra branches you already have: {extras}</p>
                <p className="mt-0.5 text-xs text-text-secondary">Extra branches are a monthly cost. Branches you do not renew are switched off when this payment is approved. Their data is kept.</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-sm text-text-secondary">Keep</span>
                  <div className="flex items-center rounded-lg border border-border bg-input">
                    <button type="button" aria-label="Keep fewer" onClick={() => { keepTouched.current = true; setKeep((k) => Math.max(0, k - 1)); }} className="grid size-9 place-items-center text-text-secondary hover:text-text"><Minus size={15} /></button>
                    <span className="w-9 text-center text-sm font-semibold tabular">{keep}</span>
                    <button type="button" aria-label="Keep more" onClick={() => { keepTouched.current = true; setKeep((k) => Math.min(extras, k + 1)); }} className="grid size-9 place-items-center text-text-secondary hover:text-text"><Plus size={15} /></button>
                  </div>
                  <span className="text-sm text-text-secondary">of {extras}</span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-text"><Building2 size={15} className="text-gold" /> Add extra branches</h3>
                <p className="mt-1 rounded-lg bg-gold/10 px-3 py-2 text-xs text-gold">
                  {bp > 0 ? <>Each extra branch costs <strong>{inr(bp)} per month</strong>. This is a <strong>monthly cost, not a one-time fee</strong>.</> : 'The extra-branch fee has not been set yet. Please contact us.'}
                  {q && names.length > 0 && bp > 0 ? ` You pay for ${q.branchMonths} month${q.branchMonths === 1 ? '' : 's'}: ${effRenew ? 'the rest of your current plan plus the new plan period' : 'the rest of your current plan'}.` : ''}
                </p>
              </div>
              {names.map((n, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={n} onChange={(e) => setNames((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Branch ${i + 1} name, e.g. Restaurant, Alkapuri`} maxLength={60} aria-label={`New branch ${i + 1} name`} />
                  <Button variant="ghost" onClick={() => setNames((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove this branch"><Trash2 size={15} className="text-error" /></Button>
                </div>
              ))}
              <Button variant="outline" onClick={() => setNames((cur) => [...cur, ''])} disabled={names.length >= MAX_NEW}><Plus size={15} /> Add a branch</Button>
            </div>

            <div className="rounded-xl border border-border bg-input p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-disabled">Your payment</p>
              {!wantsAnything ? <p className="mt-2 text-sm text-text-secondary">Choose a renewal or add a branch to see the amount.</p>
                : quote.isLoading ? <Spinner label="Working out the amount" />
                : quote.error ? <p className="mt-2 text-sm text-error">{quote.error.message}</p>
                : q && (
                  <>
                    <ul className="mt-2 divide-y divide-border/60 text-sm">{q.lines.map((l) => <li key={l.label} className="flex justify-between gap-4 py-2"><span className="text-text-secondary">{l.label}</span><span className="shrink-0 font-medium text-text tabular">{inr(l.amount)}</span></li>)}</ul>
                    {q.lines.length === 0 && <p className="mt-2 text-sm text-text-secondary">Nothing to pay for this choice.</p>}
                    <div className="mt-2 flex items-center justify-between border-t border-border pt-3"><span className="text-sm font-semibold text-text">Total to pay</span><span className="font-display text-2xl font-semibold text-gold tabular">{inr(q.total)}</span></div>
                    {q.renew && q.newEnd && <p className="mt-1 text-xs text-text-secondary">Your plan then runs until about {fmtDate(q.newEnd)}.</p>}
                  </>
                )}
            </div>
          </div>
        </Card>

        {/* ---------------------------------------------------- pay + send */}
        <Card className="h-fit xl:sticky xl:top-24">
          <CardHeader title="Pay by UPI" subtitle="Scan, pay, then send us the transaction ID" action={<Landmark size={16} className="text-gold" />} />
          <div className="space-y-5 p-5">
            {total > 0 ? (
              upiOk ? (
                <div className="flex flex-col items-center gap-3">
                  <UpiQr upi={info.upi ?? ''} payee={info.payee ?? ''} amount={total} note={`Eventora ${business.name}`.slice(0, 40)} />
                  <p className="font-display text-3xl font-semibold text-gold tabular">{inr(total)}</p>
                  <p className="text-center text-xs text-text-secondary">Scan with GPay, PhonePe, Paytm or any UPI app. The amount is already filled in.</p>
                </div>
              ) : <p className="rounded-xl border border-border bg-input p-4 text-sm text-text-secondary">UPI details have not been added yet. Please contact the Eventora team to pay.</p>
            ) : <p className="rounded-xl border border-border bg-input p-4 text-sm text-text-secondary">{wantsAnything && q ? 'No payment is needed for this choice.' : 'Choose what you want to pay for. The QR code appears here with the exact amount.'}</p>}

            {info.upi && <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-input px-4 py-3"><div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-text-disabled">UPI ID{info.payee ? ` · ${info.payee}` : ''}</p><p className="truncate font-mono text-sm text-text">{info.upi}</p></div><Button size="sm" variant="outline" onClick={() => void copy(info.upi ?? '', 'UPI ID')}><Copy size={13} /> Copy</Button></div>}
            {info.bankText && <details className="rounded-xl border border-border bg-input px-4 py-3 text-sm"><summary className="cursor-pointer text-text-secondary">Pay by bank transfer instead</summary><p className="mt-2 whitespace-pre-line text-text">{info.bankText}</p></details>}

            <div className="space-y-4 border-t border-border/70 pt-5">
              {pending.length > 0 && <p className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">You already have {pending.length} request{pending.length === 1 ? '' : 's'} waiting for approval. Only send another if this is a different payment.</p>}
              <MobileField value={mobile} onChange={setMobile} />
              <Field label="UPI transaction ID (UTR)" required={needsRef} hint="from your payment app"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 412833910075" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount paid (₹)"><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
                <Field label="Paid on"><Input type="date" max={todayISO()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              </div>
              <Button variant="gold" size="lg" className="w-full" onClick={send} disabled={create.isPending || !q}>{create.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send request to Eventora</Button>
              <p className="text-center text-[11px] text-text-disabled">After we approve it, your plan and branches update and your invoice appears below.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {wa && <a href={whatsappLink(wa, 'Hello, I use Eventora OS and have a question about my payment.')} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><MessageCircle size={14} /> WhatsApp us</Button></a>}
                {info.phone && <a href={`tel:${info.phone}`}><Button variant="ghost" size="sm">Call {info.phone}</Button></a>}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Your branches" subtitle={`${branchInfo.activeCount} of ${branchInfo.limit} branch${branchInfo.limit === 1 ? '' : 'es'} in use`} action={<Link href="/admin/branches" className="inline-flex items-center gap-1 text-xs text-gold hover:underline"><Building2 size={13} /> Manage branches</Link>} />
        <p className="p-5 text-sm text-text-secondary">Extra branches are paid monthly{bp > 0 ? ` (${inr(bp)} per branch per month)` : ''}. Add them above, then name, edit and assign employees in <strong className="text-text">Branches</strong>.</p>
      </Card>

      <Card>
        <CardHeader title="Your invoices" subtitle="Created automatically when we approve a payment" action={<FileText size={16} className="text-gold" />} />
        {invoices.length === 0 ? <EmptyState icon={<FileText />} title="No invoices yet" text="After we approve your payment, the invoice appears here as a PDF." /> : <ul className="divide-y divide-border/60">{invoices.map((i) => <InvoiceRow key={i.id} inv={i} />)}</ul>}
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader title="Your payment requests" />
          <ul className="divide-y divide-border/60">
            {history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0"><span className="block text-text">{r.subject || 'Request'} · ref {r.payload.reference || '—'}</span><span className="block text-xs text-text-secondary">{fmtDate(r.createdAt)}{r.payload.quote?.total ? ` · ${inr(Number(r.payload.quote.total))}` : ''}{r.note ? ` · ${r.note}` : ''}</span></span>
                <Badge tone={REQ_TONE[r.status]}>{r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Done' : r.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
