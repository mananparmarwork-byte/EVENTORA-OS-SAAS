import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Building2, Check, CalendarCheck, FileText, Gift, History, IndianRupee, Megaphone, Minus, Plus, ShieldCheck, Users, Wallet, BarChart3, Bell, Layers } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Card } from '@/components/ui';
import { usePlans } from '@/lib/api';
import { BONUSES, branchMonthlyRate, branchPlanPrice, FEATURES, PLAN_NAME, perLabel } from '@/lib/plans';
import { cn, inr } from '@/lib/format';
import type { BillingPeriod, Plan } from '@/lib/types';

const HIGHLIGHTS = [
  { icon: FileText, title: 'Quotes & invoices in minutes', text: 'Pick services, see the price live, send a branded PDF or WhatsApp message.' },
  { icon: CalendarCheck, title: 'No double bookings', text: 'See free time on every date. Booked slots are blocked automatically.' },
  { icon: Wallet, title: 'Collect payments', text: 'UPI QR, cash and bank. Every rupee tracked against the right bill.' },
  { icon: Users, title: 'Your team, your rules', text: 'Employees take payments and make bills. You decide what they may change.' },
  { icon: History, title: 'See everything that happens', text: 'Deleted bills, changed amounts, cancelled payments: all recorded with who did it.' },
  { icon: IndianRupee, title: 'Know your numbers', text: 'Revenue and bookings by day, week, month or any dates you choose.' },
  { icon: Building2, title: 'Multiple branches, one login', text: 'Run several halls or outlets together. Every branch has its own bills, staff and calendar, and you switch or combine them in one click.' },
  { icon: BarChart3, title: 'Branch-wise reports', text: 'See bookings, collections and balances for each branch side by side, and download PDF or Excel reports.' },
  { icon: Layers, title: 'Your catalog, your prices', text: 'Edit menus, services and rates, and add custom items to any quotation on the spot.' },
  { icon: Bell, title: 'Reminders and messages', text: 'Plan reminders and updates from the Eventora team appear right inside your workspace.' },
  { icon: ShieldCheck, title: 'Safe and private', text: 'Two-step verification, automatic sign-out and data that only your team can see.' },
  { icon: Gift, title: 'Free website included', text: 'A business website worth ₹25,000 comes free while you use Eventora OS.' },
];

/** The plans buyers can choose. They come from the database: the software owner creates them in Super admin -> Plans & prices. */
export function PricingCards({ cta, period: controlled, onPeriod, finalPrice }: { cta: (p: BillingPeriod) => React.ReactNode; period?: BillingPeriod; onPeriod?: (p: BillingPeriod) => void; finalPrice?: number | null }) {
  const { plans } = usePlans();
  const [inner, setInner] = useState<BillingPeriod>('');
  const [extra, setExtra] = useState(0);
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
  const features = plan.features.length >= 4 ? plan.features : FEATURES;
  const shown = finalPrice ?? plan.price;
  const branchRate = branchMonthlyRate(plan.months);
  const branchTotal = branchPlanPrice(plan.months);
  const grand = shown + extra * branchTotal;
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
      <Card className="mx-auto mt-8 max-w-lg border-gold/30 p-8 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">{PLAN_NAME} · {plan.name}{plan.popular && plans.length > 1 ? ' · most popular' : ''}</p>
        {plan.description && <p className="mt-2 text-sm text-text-secondary">{plan.description}</p>}
        {finalPrice != null && finalPrice < plan.price && <p className="mt-3 text-lg text-text-disabled line-through tabular">{inr(plan.price)}</p>}
        <p className={cn('font-display text-5xl font-semibold text-text tabular', finalPrice == null && 'mt-3')}>{inr(shown)}</p>
        <p className="mt-1 text-sm text-text-secondary">{perLabel(plan.months)}{plan.months > 1 ? ` · about ${inr(Math.round(shown / plan.months))} a month` : ''}</p>
        <p className="mt-1 text-xs text-text-secondary">for your main branch</p>
        <div className="mt-5 rounded-2xl border border-border bg-surface-hover/60 p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-sm font-semibold text-text">Extra branches</p><p className="text-xs text-text-secondary">{inr(branchRate)} per month for each · {inr(branchTotal)} {perLabel(plan.months)}</p></div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Fewer branches" onClick={() => setExtra((n) => Math.max(0, n - 1))} className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-text-secondary hover:text-text"><Minus size={14} /></button>
              <span className="w-6 text-center text-sm font-semibold tabular text-text">{extra}</span>
              <button type="button" aria-label="More branches" onClick={() => setExtra((n) => Math.min(20, n + 1))} className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-text-secondary hover:text-text"><Plus size={14} /></button>
            </div>
          </div>
          {extra > 0 && <p className="mt-3 border-t border-border pt-3 text-xs text-text-secondary">{inr(shown)} main + {extra} × {inr(branchTotal)} = <strong className="text-sm text-text">{inr(grand)}</strong> {perLabel(plan.months)}</p>}
        </div>
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-[11px] font-medium text-success"><Check size={12} /> Simple manual billing: pay us directly, we switch access on</p>
        <div className="mt-5 space-y-2 text-left">
          {BONUSES.map((b, i) => (
            <div key={b.title} className="flex gap-3 rounded-xl border border-gold/30 bg-gold/5 p-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">{i === 0 ? <Gift size={16} /> : <Megaphone size={16} />}</span>
              <span><span className="block text-sm font-semibold text-text">{b.title}</span><span className="block text-xs text-text-secondary">{b.text}</span></span>
            </div>
          ))}
        </div>
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
      <header className="sidebar-dark sticky top-0 z-20 bg-gradient-to-r from-[#0A1226] via-[#101D35] to-[#1B3160] shadow-[0_10px_30px_rgba(10,18,38,.35)]">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-8">
          <Brand subtitle="Venue & event operations" onDark />
          <div className="flex items-center gap-2">
            <Link href="/login"><Button variant="ghost" className="text-[#EAF0FB] hover:bg-white/10">Sign in</Button></Link>
            <Link href="/request-access"><Button variant="gold" className="bg-[#3478F6] hover:bg-[#4A8AFF]">Request access</Button></Link>
          </div>
        </div>
        <div className="h-[3px] bg-gradient-to-r from-transparent via-[#3478F6] to-transparent" />
      </header>

      <section className="relative overflow-hidden px-4 py-20 text-center sm:px-8 sm:py-28">
        <div className="pointer-events-none absolute -top-32 left-1/2 size-[720px] -translate-x-1/2 rounded-full bg-gold/[0.07] blur-3xl" />
        <div className="relative mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">For banquets, venues and event planners</p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight sm:text-6xl">Run your venue from one calm dashboard.</h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-text-secondary">Quotations, bookings, payments and your team in one place, with a full record of everything that happens.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/request-access"><Button variant="gold" size="lg">Request access</Button></Link>
            <Button variant="outline" size="lg" onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>See pricing</Button>
          </div>
          <p className="mt-3 text-xs text-text-disabled">We set up your owner login and switch your workspace on · your data stays yours · <Link href="/login" className="text-gold hover:underline">sign in</Link></p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="p-6"><span className="grid size-11 place-items-center rounded-xl bg-surface-hover text-gold"><Icon size={20} /></span><h3 className="mt-4 text-base font-semibold">{title}</h3><p className="mt-1.5 text-sm text-text-secondary">{text}</p></Card>
          ))}
        </div>
      </section>

      <section id="pricing" className="scroll-mt-24 px-4 pb-24 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-display text-3xl font-semibold">Simple pricing</h2>
          <p className="mx-auto mb-8 mt-2 max-w-lg text-center text-sm text-text-secondary">One plan with everything included for your main branch. Add branches at a lower rate on longer plans. Choose the period that suits you.</p>
          <PricingCards cta={(p) => (
            <div className="space-y-3">
              <Link href="/request-access"><Button variant="gold" size="lg" className="w-full">Request access</Button></Link>
              <p className="text-xs text-text-secondary">We will contact you and set everything up.</p>
            </div>
          )} />
        </div>
      </section>

      <footer className="border-t border-border/60 px-4 py-8 text-center text-xs text-text-disabled">© {new Date().getFullYear()} Eventora OS</footer>
    </div>
  );
}
