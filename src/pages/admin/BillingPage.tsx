import { useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, Building2, CheckCircle2, Clock, Copy, Landmark, Loader2, MessageCircle, Send } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Field, Input, Spinner, useUi } from '@/components/ui';
import { useBranchInfo } from '@/lib/branch';
import { useCreateRequest, useMyRequests, usePaymentInfo } from '@/lib/apiExt';
import { usePlans, useSubscription } from '@/lib/api';
import { cn, fmtDate, inr, todayISO } from '@/lib/format';
import { perLabel, planName } from '@/lib/plans';
import { whatsappLink } from '@/lib/settings';
import type { Subscription } from '@/lib/types';

const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5)) : 0);

/** One plain sentence about the plan. Access is switched on by the Eventora team after payment (manual), so every text says "renew" not "autopay". */
export function statusLine(s: Subscription, label: string): { tone: 'success' | 'warning' | 'error' | 'info'; title: string; text: string } {
  if (s.status === 'trialing') {
    if (!s.writable) return { tone: 'error', title: 'Your free trial has ended', text: 'The software is locked. Your data is safe. Send a renewal request below and we will switch it on.' };
    const d = daysLeft(s.trialEndsAt);
    return { tone: 'info', title: `Free trial: ${d} day${d === 1 ? '' : 's'} left`, text: `Your trial ends on ${fmtDate(s.trialEndsAt ?? '')}. Contact us before then to continue without a break.` };
  }
  if (s.status === 'active') {
    if (!s.writable) return { tone: 'error', title: 'Your access has ended', text: 'The software is locked. Send a renewal request below. Your data is safe.' };
    const d = daysLeft(s.currentPeriodEnd);
    if (s.currentPeriodEnd && d >= 3650) return { tone: 'success', title: `${label} access is active`, text: 'Your access has no end date.' };
    return d <= 7
      ? { tone: 'warning', title: `Your plan ends in ${d} day${d === 1 ? '' : 's'}`, text: `Active until ${fmtDate(s.currentPeriodEnd ?? '')}. Renew early so your team is not locked out.` }
      : { tone: 'success', title: `${label} plan is active`, text: s.currentPeriodEnd ? `Active until ${fmtDate(s.currentPeriodEnd)}.` : 'Your plan is active.' };
  }
  if (s.status === 'past_due') return { tone: 'warning', title: 'A payment is due', text: 'Please pay and send a renewal request. Access will stop in a few days if it stays unpaid.' };
  if (s.status === 'cancelled') return s.writable
    ? { tone: 'warning', title: 'Your plan is ending', text: `You can keep using Eventora until ${fmtDate(s.currentPeriodEnd ?? '')}, then it locks.` }
    : { tone: 'error', title: 'Your access has ended', text: 'The software is locked. Send a renewal request below.' };
  return { tone: 'error', title: 'Your access has ended', text: 'The software is locked. Send a renewal request below.' };
}

const REQ_TONE = { pending: 'warning', approved: 'success', rejected: 'error', closed: 'neutral' } as const;

/** Billing = plan and how to pay. Payment is manual: you pay the Eventora team, press "Request renewal", and they switch access on. */
export function BillingPage() {
  const { toast } = useUi();
  const { sub, isLoading } = useSubscription();
  const { all: allPlans, plans } = usePlans();
  const { info } = usePaymentInfo(true);
  const { info: branchInfo } = useBranchInfo();
  const { data: requests = [] } = useMyRequests(true);
  const create = useCreateRequest();
  const [period, setPeriod] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayISO());

  if (isLoading) return <Spinner label="Loading billing" />;
  const line = sub ? statusLine(sub, planName(allPlans, sub.period)) : null;
  const Icon = line?.tone === 'success' ? CheckCircle2 : line?.tone === 'info' ? Clock : AlertTriangle;
  const cls = { success: 'border-success/30 bg-success-bg text-success', warning: 'border-warning/30 bg-warning-bg text-warning', error: 'border-error/30 bg-error-bg text-error', info: 'border-info/30 bg-info/10 text-info' };
  const chosen = plans.find((p) => p.period === period) ?? plans.find((p) => p.period === sub?.period) ?? plans[0];
  const pending = requests.filter((r) => r.kind === 'renewal' && r.status === 'pending');
  const copy = async (v: string, what: string) => { try { await navigator.clipboard.writeText(v); toast(`${what} copied.`); } catch { toast(v, 'info'); } };
  const wa = (info.whatsapp ?? '').replace(/\D/g, '');

  const send = () => {
    if (!reference.trim()) { toast('Enter the payment reference (UTR / transaction number) so we can find your payment.', 'error'); return; }
    create.mutate({ kind: 'renewal', message: '', payload: { period: chosen?.period ?? '', reference: reference.trim(), amount: amount.trim() || String(chosen?.price ?? ''), paidOn } },
      { onSuccess: () => { toast('Renewal request sent. We will switch your access on soon.'); setReference(''); setAmount(''); }, onError: (e) => toast(e.message, 'error') });
  };

  return (
    <div className="space-y-6">
      {line && sub && (
        <div className={`flex items-start gap-3 rounded-2xl border p-5 ${cls[line.tone]}`}>
          <Icon size={20} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1"><p className="font-semibold">{line.title}</p><p className="mt-0.5 text-sm opacity-90">{line.text}</p></div>
          <Badge tone="neutral" className="shrink-0">{sub.status.replace('_', ' ')}</Badge>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="How to pay" subtitle="Pay the Eventora team directly" action={<Landmark size={16} className="text-gold" />} />
          <div className="space-y-4 p-5 text-sm">
            {info.instructions && <p className="text-text-secondary">{info.instructions}</p>}
            {info.upi && <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-input px-4 py-3"><div><p className="text-[11px] uppercase tracking-wide text-text-disabled">UPI ID{info.payee ? ` · ${info.payee}` : ''}</p><p className="font-mono text-text">{info.upi}</p></div><Button size="sm" variant="outline" onClick={() => void copy(info.upi ?? '', 'UPI ID')}><Copy size={13} /> Copy</Button></div>}
            {info.bankText && <div className="rounded-xl border border-border bg-input px-4 py-3"><p className="text-[11px] uppercase tracking-wide text-text-disabled">Bank transfer</p><p className="mt-1 whitespace-pre-line text-text">{info.bankText}</p></div>}
            {!info.upi && !info.bankText && <p className="text-text-secondary">Payment details have not been added yet. Please contact the Eventora team.</p>}
            <div className="flex flex-wrap gap-2">
              {wa && <a href={whatsappLink(wa, `Hello, I use Eventora OS. I want to renew my plan.`)} target="_blank" rel="noreferrer"><Button variant="outline"><MessageCircle size={15} /> WhatsApp us</Button></a>}
              {info.phone && <a href={`tel:${info.phone}`}><Button variant="ghost">Call {info.phone}</Button></a>}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Request renewal" subtitle="After you pay, tell us the payment reference" />
          <div className="space-y-4 p-5">
            {pending.length > 0 && <p className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">You already have a renewal request waiting ({fmtDate(pending[0].createdAt)}). You can send another if the details changed.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {plans.map((p) => (
                <button key={p.period} type="button" onClick={() => { setPeriod(p.period); setAmount(String(p.price)); }} className={cn('rounded-xl border p-3 text-left transition-colors', chosen?.period === p.period ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/50')}>
                  <p className="text-sm font-semibold text-text">{p.name}</p><p className="text-lg font-semibold text-gold tabular">{inr(p.price)}</p><p className="text-[11px] text-text-secondary">{perLabel(p.months)}</p>
                </button>
              ))}
              {plans.length === 0 && <p className="text-sm text-text-secondary sm:col-span-2">No plans are listed yet. Message us and we will set one for you.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Payment reference" required hint="UTR / transaction no."><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 4128 3391 0075" /></Field>
              <Field label="Amount paid (₹)"><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Paid on"><Input type="date" max={todayISO()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
            </div>
            <Button variant="gold" onClick={send} disabled={create.isPending || plans.length === 0}>{create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send renewal request</Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Your branches" subtitle={`${branchInfo.activeCount} of ${branchInfo.limit} branch${branchInfo.limit === 1 ? '' : 'es'} in use`} action={<Link href="/admin/branches" className="inline-flex items-center gap-1 text-xs text-gold hover:underline"><Building2 size={13} /> Manage branches</Link>} />
        <p className="p-5 text-sm text-text-secondary">Need another branch (a second hall, a restaurant, a new city)? Open <strong className="text-text">Branches</strong> and send a request. Once we approve it, the branch appears and your team can use it.{info.branchPrice ? ` Extra branch fee: ${inr(info.branchPrice)}.` : ''}</p>
      </Card>

      {requests.filter((r) => r.kind === 'renewal').length > 0 && (
        <Card>
          <CardHeader title="Your renewal requests" />
          <ul className="divide-y divide-border/60">
            {requests.filter((r) => r.kind === 'renewal').map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0"><span className="block text-text">{fmtDate(r.createdAt)} · ref {r.payload.reference || '—'}</span>{r.note && <span className="block text-xs text-text-secondary">{r.note}</span>}</span>
                <Badge tone={REQ_TONE[r.status]}>{r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Done' : r.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
