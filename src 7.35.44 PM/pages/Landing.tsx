import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Check, CalendarCheck, FileText, History, IndianRupee, Users, Wallet } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Card } from '@/components/ui';
import { usePlans } from '@/lib/api';
import { FEATURES, PLAN_NAME, perLabel } from '@/lib/plans';
import { cn, inr } from '@/lib/format';
import type { BillingPeriod, Plan } from '@/lib/types';

const HIGHLIGHTS = [
  { icon: FileText, title: 'Quotes & invoices in minutes', text: 'Pick services, see the price live, send a branded PDF or WhatsApp message.' },
  { icon: CalendarCheck, title: 'No double bookings', text: 'See free time on every date. Booked slots are blocked automatically.' },
  { icon: Wallet, title: 'Collect payments', text: 'UPI QR, cash and bank. Every rupee tracked against the right bill.' },
  { icon: Users, title: 'Your team, your rules', text: 'Employees take payments and make bills. You decide what they may change.' },
  { icon: History, title: 'See everything that happens', text: 'Deleted bills, changed amounts, cancelled payments: all recorded with who did it.' },
  { icon: IndianRupee, title: 'Know your numbers', text: 'Revenue and bookings by day, week, month or any dates you choose.' },
];

/** The plans buyers can choose. They come from the database: the software owner creates them in Super admin -> Plans & prices. */
export function PricingCards({ cta, period: controlled, onPeriod, finalPrice }: { cta: (p: BillingPeriod) => React.ReactNode; period?: BillingPeriod; onPeriod?: (p: BillingPeriod) => void; finalPrice?: number | null }) {
  const { plans } = usePlans();
  const [inner, setInner] = useState<BillingPeriod>('');
  const fallback = (plans.find((x) => x.popular) ?? plans[0])?.period ?? '';
  const wanted = controlled ?? inner;
  const period = plans.some((x) => x.period === wanted) ? wanted : fallback;
  // keep the page that owns the selection (Buy / Billing) in step with what is really shown
  useEffect(() => { if (period && period !== controlled) onPeriod?.(period); }, [period, controlled, onPeriod]);
  const choose = (p: BillingPeriod) => { setInner(p); onPeriod?.(p); };
  const plan = plans.find((x) => x.period === period);
  if (!plan) return <p className="text-center text-sm text-text-secondary">No plans are on sale right now. Please check back soon.</p>;

  // "save X%" compares each plan with the cheapest price per month among the plans
  const perMonth = (p: Plan) => p.price / p.months;
  const best = Math.max(...plans.map(perMonth));
  const save = (p: Plan) => (best > 0 ? Math.max(0, Math.round((1 - perMonth(p) / best) * 100)) : 0);
  const features = plan.features.length ? plan.features : FEATURES;
  const shown = finalPrice ?? plan.price;
  return (
    <div>
      {plans.length > 1 && (
        <div className="mx-auto flex w-fit max-w-full flex-wrap justify-center rounded-2xl border border-border bg-surface p-1" role="tablist" aria-label="Plans">
          {plans.map((p) => (
            <button key={p.period} type="button" role="tab" aria-selected={period === p.period} onClick={() => choose(p.period)}
              className={cn('rounded-xl px-4 py-2 text-sm font-medium transition-colors', period === p.period ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>
              {p.name}{save(p) > 0 && <span className={cn('ml-2 text-[11px] font-semibold', period === p.period ? 'text-text-on-gold/70' : 'text-success')}>save {save(p)}%</span>}
            </button>
          ))}
        </div>
      )}
      <Card className="mx-auto mt-8 max-w-md border-gold/30 p-8 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">{PLAN_NAME} · {plan.name}{plan.popular && plans.length > 1 ? ' · most popular' : ''}</p>
        {plan.description && <p className="mt-2 text-sm text-text-secondary">{plan.description}</p>}
        {finalPrice != null && finalPrice < plan.price && <p className="mt-3 text-lg text-text-disabled line-through tabular">{inr(plan.price)}</p>}
        <p className={cn('font-display text-5xl font-semibold text-text tabular', finalPrice == null && 'mt-3')}>{inr(shown)}</p>
        <p className="mt-1 text-sm text-text-secondary">{perLabel(plan.months)}{plan.months > 1 ? ` · about ${inr(Math.round(shown / plan.months))} a month` : ''}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-[11px] font-medium text-success"><Check size={12} /> Autopay: you are charged automatically, nothing to remember</p>
        <ul className="mt-6 space-y-2.5 text-left text-sm">
          {features.map((f) => <li key={f} className="flex items-start gap-2.5 text-text-secondary"><Check size={16} className="mt-0.5 shrink-0 text-gold" />{f}</li>)}
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
