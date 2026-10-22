import { useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, CheckCircle2, Clock, CreditCard, Loader2, RefreshCw, Ticket } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Field, Input, Spinner, useUi } from '@/components/ui';
import { PricingCards } from '@/pages/Landing';
import { checkCoupon, startCheckout, useSubscription, useSubscriptionAdmin } from '@/lib/api';
import { fmtDate, inr } from '@/lib/format';
import { PRICES } from '@/lib/plans';
import type { BillingPeriod, CouponCheck, Subscription } from '@/lib/types';

const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5)) : 0);

export function statusLine(s: Subscription): { tone: 'success' | 'warning' | 'error' | 'info'; title: string; text: string } {
  const trialOver = s.status === 'trialing' && !s.writable;
  if (s.status === 'trialing') {
    if (trialOver) return { tone: 'error', title: 'Your free trial has ended', text: 'The software is locked. Your data is safe. Choose a plan to unlock it.' };
    const d = daysLeft(s.trialEndsAt);
    return s.autopay
      ? { tone: 'info', title: `Free trial: ${d} day${d === 1 ? '' : 's'} left`, text: `Autopay is set up. Your first payment is taken automatically on ${fmtDate(s.trialEndsAt ?? '')}.` }
      : { tone: 'info', title: `Free trial: ${d} day${d === 1 ? '' : 's'} left`, text: `Your trial ends on ${fmtDate(s.trialEndsAt ?? '')}. Set up autopay now so you are never locked out.` };
  }
  if (s.status === 'active') {
    if (!s.writable) return { tone: 'error', title: 'Your plan has ended', text: 'The software is locked. Renew to unlock it. Your data is safe.' };
    const d = daysLeft(s.currentPeriodEnd);
    if (s.autopay) return { tone: 'success', title: `${PRICES[s.period].label} plan is active`, text: s.currentPeriodEnd ? `Autopay is on. Next payment around ${fmtDate(s.currentPeriodEnd)}.` : 'Autopay is on.' };
    return d <= 7
      ? { tone: 'warning', title: `Your plan ends in ${d} day${d === 1 ? '' : 's'}`, text: `Paid until ${fmtDate(s.currentPeriodEnd ?? '')}. Renew with autopay so it never lapses.` }
      : { tone: 'success', title: `${PRICES[s.period].label} plan is active`, text: s.currentPeriodEnd ? `Paid until ${fmtDate(s.currentPeriodEnd)}.` : 'Your plan is active.' };
  }
  if (s.status === 'past_due') return { tone: 'warning', title: 'A payment did not go through', text: 'Please pay now. Access will stop in a few days if it stays unpaid.' };
  if (s.status === 'cancelled') return s.writable
    ? { tone: 'warning', title: 'Autopay is cancelled', text: `You can keep using Eventora until ${fmtDate(s.currentPeriodEnd ?? '')}, then it locks.` }
    : { tone: 'error', title: 'Your plan has ended', text: 'The software is locked. Choose a plan to unlock it.' };
  return { tone: 'error', title: 'Your plan has ended', text: 'The software is locked. Choose a plan to unlock it.' };
}

export function BillingPage() {
  const { toast, confirm } = useUi();
  const { sub, isLoading } = useSubscription();
  const admin = useSubscriptionAdmin();
  const [period, setPeriod] = useState<BillingPeriod>('quarterly');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<CouponCheck | null>(null);
  const [checking, setChecking] = useState(false);

  // a discount coupon is priced for the plan that is selected; re-check when the plan changes
  useEffect(() => {
    if (!applied?.code || applied.kind === 'free_days') return;
    let live = true;
    void checkCoupon(applied.code, period).then((r) => { if (live) { setApplied(r.ok ? r : null); if (!r.ok) toast(r.error ?? 'This coupon does not apply to this plan.', 'error'); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const apply = async () => {
    if (!code.trim()) return;
    setChecking(true);
    const r = await checkCoupon(code.trim(), r0(period));
    setChecking(false);
    if (!r.ok) { setApplied(null); toast(r.error ?? 'This coupon is not valid.', 'error'); return; }
    setApplied(r);
    toast(r.kind === 'free_days' ? `${r.days} free days are ready: press Redeem.` : 'Coupon applied.');
  };
  const r0 = (p: BillingPeriod) => p; // coupons are checked against the selected plan

  const redeem = () => admin.redeem.mutate(applied?.code ?? '', { onSuccess: (d) => { toast(`${d} free days added.`); setApplied(null); setCode(''); }, onError: (e) => toast(e.message, 'error') });

  const pay = async () => {
    setBusy(true);
    try { window.location.assign(await startCheckout(period, applied && applied.kind !== 'free_days' ? applied.code : undefined)); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not start the payment.', 'error'); setBusy(false); }
  };

  const stopAutopay = async () => {
    if (!(await confirm({ title: 'Turn autopay off?', text: sub?.status === 'active' ? 'You keep access until the end of the period you already paid for. After that the software locks until you subscribe again.' : 'Your first payment will not be taken, and the software locks when the trial ends unless you subscribe again.', confirmLabel: 'Turn off autopay', danger: true }))) return;
    admin.cancelAutopay.mutate(undefined, { onSuccess: () => toast('Autopay turned off.', 'info'), onError: (e) => toast(e.message, 'error') });
  };

  if (isLoading) return <Spinner label="Loading billing" />;
  const line = sub ? statusLine(sub) : null;
  const Icon = line?.tone === 'success' ? CheckCircle2 : line?.tone === 'info' ? Clock : AlertTriangle;
  const cls = { success: 'border-success/30 bg-success-bg text-success', warning: 'border-warning/30 bg-warning-bg text-warning', error: 'border-error/30 bg-error-bg text-error', info: 'border-info/30 bg-info/10 text-info' };
  const discount = applied && applied.kind !== 'free_days' ? applied.finalPrice ?? null : null;
  const autopayOn = Boolean(sub?.autopay && (sub.status === 'active' || sub.status === 'trialing'));

  return (
    <div className="space-y-6">
      {line && sub && (
        <div className={`flex items-start gap-3 rounded-2xl border p-5 ${cls[line.tone]}`}>
          <Icon size={20} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1"><p className="font-semibold">{line.title}</p><p className="mt-0.5 text-sm opacity-90">{line.text}</p></div>
          <Badge tone="neutral" className="shrink-0">{sub.status.replace('_', ' ')}</Badge>
        </div>
      )}

      {autopayOn && (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-success-bg text-success"><RefreshCw size={18} /></span><div><p className="font-semibold text-text">Autopay is ON</p><p className="text-xs text-text-secondary">Payments are taken automatically. You do not need to remember.{sub?.couponCode ? ` Coupon ${sub.couponCode} applied.` : ''}</p></div></div>
          <Button variant="outline" onClick={() => void stopAutopay()} disabled={admin.cancelAutopay.isPending}>Turn off autopay</Button>
        </Card>
      )}

      {!autopayOn && (
        <>
          <Card>
            <CardHeader title="Have a coupon?" subtitle="Discount codes and free-day codes" action={<Ticket size={16} className="text-gold" />} />
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
              <Field label="Coupon code" className="flex-1"><Input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setApplied(null); }} placeholder="WELCOME20" autoCapitalize="characters" /></Field>
              <Button variant="outline" onClick={() => void apply()} disabled={checking || !code.trim()}>{checking ? <Loader2 size={15} className="animate-spin" /> : null} Apply</Button>
              {applied?.kind === 'free_days' && <Button variant="gold" onClick={redeem} disabled={admin.redeem.isPending}><BadgeCheck size={15} /> Redeem {applied.days} free days</Button>}
            </div>
            {applied && applied.kind !== 'free_days' && <p className="px-5 pb-5 text-sm text-success">Coupon <strong>{applied.code}</strong> applied: {applied.kind === 'percent' ? `${applied.value}% off` : `${inr(applied.value ?? 0)} off`} every payment. You pay {inr(applied.finalPrice ?? 0)}.</p>}
          </Card>

          <Card>
            <CardHeader title="Choose your plan" subtitle="Set up autopay once. Your payment is taken automatically each period." action={<span className="inline-flex items-center gap-1.5 text-xs text-text-secondary"><CreditCard size={14} className="text-gold" /> UPI AutoPay, cards, e-mandate</span>} />
            <div className="p-5 sm:p-8">
              <PricingCards period={period} onPeriod={setPeriod} finalPrice={discount} cta={() => (
                <Button variant="gold" size="lg" className="w-full" onClick={() => void pay()} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} {sub?.status === 'trialing' && sub.writable ? 'Set up autopay' : 'Subscribe with autopay'}</Button>
              )} />
              {sub?.status === 'trialing' && sub.writable && <p className="mt-4 text-center text-xs text-text-secondary">You will not be charged during your free trial. The first payment is taken on {fmtDate(sub.trialEndsAt ?? '')}.</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
