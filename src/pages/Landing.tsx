import { useState } from 'react';
import { Link } from 'wouter';
import { Check, CalendarCheck, FileText, History, IndianRupee, Users, Wallet } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Card } from '@/components/ui';
import { usePlans } from '@/lib/api';
import { FEATURES, PERIODS, PLAN_NAME, PRICES } from '@/lib/plans';
import { cn, inr } from '@/lib/format';
import type { BillingPeriod } from '@/lib/types';

const HIGHLIGHTS = [
  { icon: FileText, title: 'Quotes & invoices in minutes', text: 'Pick services, see the price live, send a branded PDF or WhatsApp message.' },
  { icon: CalendarCheck, title: 'No double bookings', text: 'See free time on every date. Booked slots are blocked automatically.' },
  { icon: Wallet, title: 'Collect payments', text: 'UPI QR, cash and bank. Every rupee tracked against the right bill.' },
  { icon: Users, title: 'Your team, your rules', text: 'Employees take payments and make bills. You decide what they may change.' },
  { icon: History, title: 'See everything that happens', text: 'Deleted bills, changed amounts, cancelled payments: all recorded with who did it.' },
  { icon: IndianRupee, title: 'Know your numbers', text: 'Revenue and bookings by day, week, month or any dates you choose.' },
];

/** The three billing periods. Prices come from the database (you edit them in "All businesses" -> Plans). */
export function PricingCards({ cta, period: controlled, onPeriod, finalPrice }: { cta: (p: BillingPeriod) => React.ReactNode; period?: BillingPeriod; onPeriod?: (p: BillingPeriod) => void; finalPrice?: number | null }) {
  const { plans } = usePlans();
  const [inner, setInner] = useState<BillingPeriod>('quarterly');
  const period = controlled ?? inner;
  const choose = (p: BillingPeriod) => { setInner(p); onPeriod?.(p); };
  const price = (p: BillingPeriod) => plans.find((x) => x.period === p)?.price ?? PRICES[p].price;
  const months = (p: BillingPeriod) => PRICES[p].months;
  const save = (p: BillingPeriod) => Math.max(0, Math.round((1 - price(p) / (price('monthly') * months(p))) * 100));
  const list = PERIODS.filter((p) => plans.some((x) => x.period === p));
  const shown = finalPrice ?? price(period);
  return (
    <div>
      <div className="mx-auto flex w-fit rounded-2xl border border-border bg-surface p-1" role="tablist" aria-label="Billing period">
        {list.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => choose(p)}
            className={cn('rounded-xl px-4 py-2 text-sm font-medium transition-colors', period === p ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>
            {PRICES[p].label}{save(p) > 0 && <span className={cn('ml-2 text-[11px] font-semibold', period === p ? 'text-text-on-gold/70' : 'text-success')}>save {save(p)}%</span>}
          </button>
        ))}
      </div>
      <Card className="mx-auto mt-8 max-w-md border-gold/30 p-8 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">{PLAN_NAME}</p>
        {finalPrice != null && finalPrice < price(period) && <p className="mt-3 text-lg text-text-disabled line-through tabular">{inr(price(period))}</p>}
        <p className={cn('font-display text-5xl font-semibold text-text tabular', finalPrice == null && 'mt-3')}>{inr(shown)}</p>
        <p className="mt-1 text-sm text-text-secondary">per {period === 'monthly' ? 'month' : period === 'quarterly' ? '3 months' : 'year'} · about {inr(Math.round(shown / months(period)))} a month</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-[11px] font-medium text-success"><Check size={12} /> Autopay: you are charged automatically, nothing to remember</p>
        <ul className="mt-6 space-y-2.5 text-left text-sm">
          {FEATURES.map((f) => <li key={f} className="flex items-start gap-2.5 text-text-secondary"><Check size={16} className="mt-0.5 shrink-0 text-gold" />{f}</li>)}
        </ul>
        <div className="mt-8">{cta(period)}</div>
      </Card>
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-dvh bg-page text-text">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-page/85 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-8">
          <Brand subtitle="Venue & event operations" />
          <div className="flex items-center gap-2">
            <Link href="/login"><Button variant="ghost">Sign in</Button></Link>
            <Link href="/buy"><Button variant="gold">Choose a plan</Button></Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden px-4 py-20 text-center sm:px-8 sm:py-28">
        <div className="pointer-events-none absolute -top-32 left-1/2 size-[720px] -translate-x-1/2 rounded-full bg-gold/[0.07] blur-3xl" />
        <div className="relative mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">For banquets, venues and event planners</p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight sm:text-6xl">Run your venue from one calm dashboard.</h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-text-secondary">Quotations, bookings, payments and your team in one place, with a full record of everything that happens.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/buy"><Button variant="gold" size="lg">Choose your plan</Button></Link>
            <Link href="/signup"><Button variant="outline" size="lg">Start free trial</Button></Link>
          </div>
          <p className="mt-3 text-xs text-text-disabled">Pay, set a password, and your workspace opens by itself · cancel anytime · <a href="#pricing" className="text-gold hover:underline">see pricing</a></p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="p-6"><span className="grid size-11 place-items-center rounded-xl bg-surface-hover text-gold"><Icon size={20} /></span><h3 className="mt-4 text-base font-semibold">{title}</h3><p className="mt-1.5 text-sm text-text-secondary">{text}</p></Card>
          ))}
        </div>
      </section>

      <section id="pricing" className="px-4 pb-24 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-display text-3xl font-semibold">Simple pricing</h2>
          <p className="mx-auto mb-8 mt-2 max-w-md text-center text-sm text-text-secondary">One plan with everything included. Pay monthly, quarterly or yearly.</p>
          <PricingCards cta={(p) => (
            <div className="space-y-3">
              <Link href={`/buy/${p}`}><Button variant="gold" size="lg" className="w-full">Buy this plan</Button></Link>
              <Link href="/signup" className="block text-xs text-text-secondary hover:text-gold">Or try it free first</Link>
            </div>
          )} />
        </div>
      </section>

      <footer className="border-t border-border/60 px-4 py-8 text-center text-xs text-text-disabled">© {new Date().getFullYear()} Eventora OS</footer>
    </div>
  );
}
