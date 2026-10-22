import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ExternalLink, Lock, RefreshCw, Tag } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Field, Input } from '@/components/ui';
import { PricingCards } from '@/pages/Landing';
import { createPurchase, purchaseStatus } from '@/lib/api';
import { PRICES } from '@/lib/plans';
import { inr } from '@/lib/format';
import type { BillingPeriod } from '@/lib/types';

const STORE = 'eventora-order';
type Order = { id: string; url: string; email: string; amount: number; period: BillingPeriod };
const readOrder = (): Order | null => { try { const r = window.localStorage.getItem(STORE); return r ? (JSON.parse(r) as Order) : null; } catch { return null; } };
const writeOrder = (o: Order | null) => { try { if (o) window.localStorage.setItem(STORE, JSON.stringify(o)); else window.localStorage.removeItem(STORE); } catch { /* ignore */ } };
const isPeriod = (v?: string): v is BillingPeriod => v === 'monthly' || v === 'quarterly' || v === 'yearly';

/** Step 1 of buying: choose a plan and the ADMIN email, then pay. No account is needed yet:
 *  the admin login and the business are created automatically at the first sign-in after payment. */
export function Buy({ period: initial }: { period?: string }) {
  const [, navigate] = useLocation();
  const [period, setPeriod] = useState<BillingPeriod>(isPeriod(initial) ? initial : 'quarterly');
  const [email, setEmail] = useState('');
  const [coupon, setCoupon] = useState('');
  const [showCoupon, setShowCoupon] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(() => readOrder());
  const [checking, setChecking] = useState(false);

  const goWelcome = (id: string) => { writeOrder(null); navigate(`/welcome/${id}`); };

  // While the payment page is open in the other tab, wait here and continue by ourselves the moment the payment arrives.
  useEffect(() => {
    if (!order) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await purchaseStatus({ id: order.id });
        if (stop) return;
        if (!s.found) { writeOrder(null); setOrder(null); return; }
        if (s.status === 'paid' || s.status === 'claimed') goWelcome(order.id);
      } catch { /* keep waiting */ }
    };
    void tick();
    const t = window.setInterval(() => { void tick(); }, 4000);
    return () => { stop = true; window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await createPurchase({ email: email.trim(), period, coupon: coupon.trim() || undefined });
      const o: Order = { id: r.purchaseId, url: r.url, email: email.trim().toLowerCase(), amount: r.amount, period };
      writeOrder(o);
      setOrder(o);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start the payment.'); }
    finally { setBusy(false); }
  };

  const checkNow = async () => {
    if (!order) return;
    setChecking(true);
    try { const s = await purchaseStatus({ id: order.id }); if (s.status === 'paid' || s.status === 'claimed') goWelcome(order.id); }
    finally { setChecking(false); }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-page px-4 py-10 sm:px-8">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[720px] -translate-x-1/2 rounded-full bg-gold/[0.06] blur-3xl" />
      <div className="relative mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <Brand subtitle="Venue & event operations" />
          <Link href="/login"><Button variant="ghost">Sign in</Button></Link>
        </div>

        {order ? (
          <div className="fade-up mx-auto max-w-md rounded-3xl border border-border bg-surface p-8 text-center card-glow">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gold/12 text-gold"><Lock size={22} /></span>
            <h1 className="mt-4 font-display text-2xl font-semibold text-text">Complete your payment</h1>
            <p className="mt-2 text-sm text-text-secondary">Eventora Pro · {PRICES[order.period].label} · <strong className="text-text">{inr(order.amount)}</strong><br />Admin email: <strong className="text-text">{order.email}</strong></p>
            <a href={order.url} target="_blank" rel="noopener noreferrer" className="mt-6 block">
              <Button variant="gold" size="lg" className="w-full">Pay {inr(order.amount)} securely <ExternalLink size={16} /></Button>
            </a>
            <p className="mt-3 text-xs text-text-disabled">Opens Razorpay in a new tab (UPI AutoPay, card or e-mandate). Keep this page open.</p>
            <div className="mt-6 flex items-center justify-center gap-2.5 rounded-2xl border border-border bg-input px-4 py-3 text-sm text-text-secondary" role="status" aria-live="polite">
              <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-gold/60" /><span className="relative inline-flex size-2.5 rounded-full bg-gold" /></span>
              Waiting for your payment…
            </div>
            <p className="mt-2 text-xs text-text-disabled">This page continues by itself as soon as the payment is received.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => void checkNow()} disabled={checking}><RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> I have paid</Button>
              <Button size="sm" variant="ghost" onClick={() => { writeOrder(null); setOrder(null); }}>Use another email or plan</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-8 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Step 1 of 2 · Choose your plan</p>
              <h1 className="mt-3 font-display text-3xl font-semibold text-text sm:text-4xl">Pay once, your workspace opens by itself.</h1>
              <p className="mx-auto mt-3 max-w-lg text-sm text-text-secondary">Enter the email that will be the admin. After payment you set a password; your business and admin login are created automatically at your first sign-in.</p>
            </div>
            <PricingCards period={period} onPeriod={setPeriod} cta={() => (
              <form onSubmit={submit} className="space-y-4 text-left">
                <Field label="Admin email" required hint="you will sign in with this"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required /></Field>
                {showCoupon
                  ? <Field label="Coupon code" hint="optional"><Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="WELCOME20" autoCapitalize="characters" /></Field>
                  : <button type="button" onClick={() => setShowCoupon(true)} className="inline-flex items-center gap-1.5 text-xs text-gold hover:underline"><Tag size={12} /> Have a coupon?</button>}
                {error && <p role="alert" className="rounded-xl border border-error/40 bg-error-bg px-3 py-2 text-xs text-error">{error}{/already|autopay|paid until|trial/i.test(error) && <> <Link href="/login" className="underline">Sign in</Link></>}</p>}
                <Button type="submit" variant="gold" size="lg" className="w-full" disabled={busy}>{busy ? 'Preparing your payment…' : 'Continue to payment'}</Button>
                <p className="text-center text-xs text-text-disabled">Renewing? Use the same admin email and your old data is connected again automatically.</p>
              </form>
            )} />
          </>
        )}

        <Link href="/" className="mt-8 flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-gold"><ArrowLeft size={14} /> Back to home</Link>
      </div>
    </div>
  );
}
