import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Ticket } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Spinner, Switch, useUi } from '@/components/ui';
import { useCoupons, usePlans, usePlatformActions, useTrialDays } from '@/lib/api';
import { fmtDate, inr } from '@/lib/format';
import { PERIODS, PRICES } from '@/lib/plans';
import type { BillingPeriod, Coupon, CouponKind } from '@/lib/types';

/* ------------------------------------------------------------------- Plans --- */
export function PlansTab() {
  const { toast } = useUi();
  const { data = [], isLoading } = usePlansAll();
  const { savePlan } = usePlatformActions();
  const [draft, setDraft] = useState<Record<string, { price: string; active: boolean }>>({});
  useEffect(() => { setDraft(Object.fromEntries(data.map((p) => [p.period, { price: String(p.price), active: p.active }]))); }, [data]);
  if (isLoading) return <Spinner label="Loading plans" />;

  const save = (period: BillingPeriod) => {
    const d = draft[period];
    const price = Number(d?.price);
    if (!price || price < 1) { toast('Enter a price of at least Rs 1.', 'error'); return; }
    savePlan.mutate({ period, price, active: d.active }, { onSuccess: () => toast(`${PRICES[period].label} plan saved. New subscribers pay this price.`), onError: (e) => toast(e.message, 'error') });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Plans and prices" subtitle="What new subscribers pay. Razorpay plans are created for you automatically." />
        <div className="grid gap-5 p-5 md:grid-cols-3">
          {PERIODS.map((p) => {
            const d = draft[p] ?? { price: '', active: true };
            const monthly = Number(draft.monthly?.price) || 0;
            const per = Number(d.price) / PRICES[p].months;
            const saved = monthly > 0 && p !== 'monthly' ? Math.round((1 - Number(d.price) / (monthly * PRICES[p].months)) * 100) : 0;
            return (
              <div key={p} className="space-y-4 rounded-2xl border border-border p-5">
                <div className="flex items-center justify-between"><p className="font-semibold text-text">{PRICES[p].label}</p>{saved > 0 && <Badge tone="success">saves {saved}%</Badge>}</div>
                <Field label="Price (Rs)"><Input type="number" min={1} value={d.price} onChange={(e) => setDraft({ ...draft, [p]: { ...d, price: e.target.value } })} inputMode="numeric" /></Field>
                <p className="text-xs text-text-secondary">{per > 0 ? `About ${inr(Math.round(per))} a month` : ' '}</p>
                <Switch checked={d.active} onChange={(v) => setDraft({ ...draft, [p]: { ...d, active: v } })} label="Offer this plan" />
                <Button variant="gold" className="w-full" onClick={() => save(p)} disabled={savePlan.isPending}><Save size={15} /> Save</Button>
              </div>
            );
          })}
        </div>
        <p className="border-t border-border/70 px-5 py-4 text-xs text-text-secondary">A price change applies to new subscriptions. People already on autopay keep paying the price they signed up at, until they cancel and subscribe again.</p>
      </Card>
    </div>
  );
}
function usePlansAll() {
  const q = usePlans();
  return { data: q.all, isLoading: q.isLoading };
}

/* ----------------------------------------------------------------- Coupons --- */
const KINDS: { id: CouponKind; label: string; hint: string }[] = [
  { id: 'percent', label: 'Percent off', hint: 'e.g. 20 = 20% off every payment' },
  { id: 'amount', label: 'Rupees off', hint: 'Rs taken off every payment' },
  { id: 'free_days', label: 'Free days', hint: 'Adds days of free access straight away' },
];
const blank = { code: '', kind: 'percent' as CouponKind, value: '20', periods: '' as '' | BillingPeriod, maxUses: '', validUntil: '', note: '' };

export function CouponsTab() {
  const { toast } = useUi();
  const { data = [], isLoading, error } = useCoupons(true);
  const { saveCoupon } = usePlatformActions();
  const [f, setF] = useState(blank);

  const randomCode = () => setF({ ...f, code: Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('') });
  const create = () => {
    const value = Number(f.value);
    if (!value || value <= 0) { toast('Enter the discount or number of days.', 'error'); return; }
    const c: Coupon = { code: f.code.trim().toUpperCase(), kind: f.kind, value, periods: f.periods ? [f.periods] : null, maxUses: f.maxUses ? Number(f.maxUses) : null, usedCount: 0, validUntil: f.validUntil ? new Date(`${f.validUntil}T23:59:59`).toISOString() : null, active: true, note: f.note.trim() };
    saveCoupon.mutate(c, { onSuccess: () => { toast(`Coupon ${c.code} created.`); setF(blank); }, onError: (e) => toast(e.message, 'error') });
  };
  const toggle = (c: Coupon) => saveCoupon.mutate({ ...c, active: !c.active }, { onSuccess: () => toast(c.active ? 'Coupon switched off.' : 'Coupon switched on.', 'info'), onError: (e) => toast(e.message, 'error') });
  const describe = (c: Coupon) => (c.kind === 'percent' ? `${c.value}% off` : c.kind === 'amount' ? `${inr(c.value)} off` : `${c.value} free days`);

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="h-fit xl:col-span-1">
        <CardHeader title="New coupon" subtitle="Give a discount or free access" />
        <div className="space-y-4 p-5">
          <Field label="Code"><div className="flex gap-2"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="WELCOME20" /><Button variant="outline" onClick={randomCode} type="button">Random</Button></div></Field>
          <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CouponKind, value: e.target.value === 'percent' ? '20' : e.target.value === 'free_days' ? '30' : '500' })}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></Field>
          <Field label={f.kind === 'percent' ? 'Percent off' : f.kind === 'amount' ? 'Rupees off' : 'Free days'} hint={KINDS.find((k) => k.id === f.kind)?.hint}><Input type="number" min={1} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} inputMode="numeric" /></Field>
          {f.kind !== 'free_days' && <Field label="Works on"><Select value={f.periods} onChange={(e) => setF({ ...f, periods: e.target.value as '' | BillingPeriod })}><option value="">All plans</option>{PERIODS.map((p) => <option key={p} value={p}>{PRICES[p].label} only</option>)}</Select></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max uses" hint="blank = unlimited"><Input type="number" min={1} value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} inputMode="numeric" /></Field>
            <Field label="Last day" hint="blank = no end"><input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} className="h-11 w-full rounded-xl border border-border bg-input px-3 text-sm text-text focus:border-gold focus:outline-none" /></Field>
          </div>
          <Field label="Note to yourself" hint="optional"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Diwali offer" /></Field>
          <Button variant="gold" className="w-full" onClick={create} disabled={saveCoupon.isPending || f.code.length < 3}>{saveCoupon.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create coupon</Button>
          <p className="text-xs text-text-secondary">Each business can use a coupon once. A discount coupon applies to every autopay payment of that subscription.</p>
        </div>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader title="Your coupons" subtitle={`${data.length} coupon${data.length === 1 ? '' : 's'}`} />
        {isLoading ? <Spinner label="Loading coupons" /> : error ? <p className="p-5 text-sm text-error">{(error as Error).message}. Run supabase/08-saas-billing.sql.</p> : data.length === 0 ? <EmptyState icon={<Ticket />} title="No coupons yet" text="Create one on the left." /> : (
          <ul className="divide-y divide-border/60">
            {data.map((c) => {
              const expired = c.validUntil ? new Date(c.validUntil).getTime() < Date.now() : false;
              const full = c.maxUses !== null && c.usedCount >= c.maxUses;
              return (
                <li key={c.code} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2"><code className="rounded-md bg-input px-2 py-0.5 font-mono text-sm font-semibold text-gold">{c.code}</code><span className="text-sm font-medium text-text">{describe(c)}</span>{c.periods && <Badge>{c.periods.join(', ')} only</Badge>}{expired && <Badge tone="error">expired</Badge>}{full && <Badge tone="warning">used up</Badge>}</p>
                    <p className="mt-1 text-xs text-text-secondary">Used {c.usedCount}{c.maxUses !== null ? ` of ${c.maxUses}` : ''} times{c.validUntil ? ` · until ${fmtDate(c.validUntil)}` : ''}{c.note ? ` · ${c.note}` : ''}</p>
                  </div>
                  <Switch checked={c.active} onChange={() => toggle(c)} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- Settings --- */
export function PlatformSettingsTab() {
  const { toast } = useUi();
  const { data, isLoading } = useTrialDays(true);
  const { saveTrial } = usePlatformActions();
  const [days, setDays] = useState('14');
  useEffect(() => { if (data !== undefined) setDays(String(data)); }, [data]);
  if (isLoading) return <Spinner label="Loading settings" />;
  const save = () => {
    const d = Math.floor(Number(days));
    if (!(d >= 0 && d <= 365)) { toast('Enter between 0 and 365 days.', 'error'); return; }
    saveTrial.mutate(d, { onSuccess: () => toast(`New businesses now get a ${d}-day free trial.`), onError: (e) => toast(e.message, 'error') });
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Free trial" subtitle="How long new businesses can use Eventora free" />
      <div className="space-y-4 p-5">
        <Field label="Free trial length (days)" hint="0 = no free trial" className="max-w-xs"><Input type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></Field>
        <p className="text-xs text-text-secondary">Applies to businesses that sign up from now on. The trial ends by itself and the software locks until they subscribe. To give one business extra time, use <strong className="text-text">+7 d / +30 d</strong> in the Businesses tab, or give them a free-days coupon.</p>
      </div>
      <div className="flex justify-end border-t border-border/70 px-5 py-4"><Button variant="gold" onClick={save} disabled={saveTrial.isPending}>{saveTrial.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</Button></div>
    </Card>
  );
}
