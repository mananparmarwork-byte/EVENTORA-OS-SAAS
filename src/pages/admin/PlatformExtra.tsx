import { useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Save, Tags, Ticket, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Switch, Textarea, useUi } from '@/components/ui';
import { useCoupons, usePlans, usePlatformActions, useTrialDays } from '@/lib/api';
import { cn, fmtDate, inr } from '@/lib/format';
import { perLabel, slugPlan } from '@/lib/plans';
import type { BillingPeriod, Coupon, CouponKind, Plan } from '@/lib/types';

/* ------------------------------------------------------------------- Plans --- */
type PlanForm = { period: string; name: string; months: string; price: string; description: string; features: string; sort: string; popular: boolean; active: boolean; isNew: boolean };
const blankPlan = (sort: number): PlanForm => ({ period: '', name: '', months: '1', price: '', description: '', features: '', sort: String(sort), popular: false, active: true, isNew: true });
const toForm = (p: Plan): PlanForm => ({ period: p.period, name: p.name, months: String(p.months), price: String(p.price), description: p.description, features: p.features.join('\n'), sort: String(p.sort), popular: p.popular, active: p.active, isNew: false });
const DURATIONS = [{ m: 1, l: '1 month' }, { m: 3, l: '3 months' }, { m: 6, l: '6 months' }, { m: 12, l: '1 year' }, { m: 24, l: '2 years' }];

export function PlansTab() {
  const { toast, confirm } = useUi();
  const { all, isLoading } = usePlans();
  const { upsertPlan, deletePlan } = usePlatformActions();
  const [form, setForm] = useState<PlanForm | null>(null);

  if (isLoading) return <Spinner label="Loading plans" />;

  const months = Number(form?.months) || 0;
  const price = Number(form?.price) || 0;
  const code = form ? (form.isNew ? slugPlan(form.period || form.name) : form.period) : '';

  const save = () => {
    if (!form) return;
    if (form.name.trim().length < 2) { toast('Give the plan a name.', 'error'); return; }
    if (code.length < 2) { toast('The plan code needs at least 2 letters or numbers.', 'error'); return; }
    if (!Number.isInteger(months) || months < 1 || months > 36) { toast('Duration must be a whole number of months, from 1 to 36.', 'error'); return; }
    if (!price || price < 1) { toast('Enter a price of at least Rs 1.', 'error'); return; }
    const plan: Plan = {
      period: code, name: form.name.trim(), months, price, description: form.description.trim(),
      features: form.features.split('\n').map((l) => l.trim()).filter(Boolean), sort: Number(form.sort) || 100, popular: form.popular, active: form.active,
    };
    upsertPlan.mutate(plan, { onSuccess: () => { toast(form.isNew ? `Plan "${plan.name}" created. People can buy it now.` : `Plan "${plan.name}" saved.`); setForm(null); }, onError: (e) => toast(e.message, 'error') });
  };

  const remove = async (p: Plan) => {
    if (!(await confirm({ title: `Delete "${p.name}"?`, text: 'This removes the plan for good. A plan that someone already bought cannot be deleted: switch it off instead.', confirmLabel: 'Delete plan', danger: true }))) return;
    deletePlan.mutate(p.period, { onSuccess: () => toast('Plan deleted.', 'info'), onError: (e) => toast(e.message, 'error') });
  };
  const toggle = (p: Plan) => upsertPlan.mutate({ ...p, active: !p.active }, { onSuccess: () => toast(p.active ? `"${p.name}" is hidden from buyers.` : `"${p.name}" is on sale again.`, 'info'), onError: (e) => toast(e.message, 'error') });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Plans for sale" subtitle="Everything buyers can choose on the website and in Billing. Razorpay plans are created for you automatically."
          action={<Button variant="gold" size="sm" onClick={() => setForm(blankPlan((all.at(-1)?.sort ?? 0) + 1))}><Plus size={15} /> New plan</Button>} />
        {all.length === 0 ? (
          <EmptyState icon={<Tags size={20} />} title="No plans yet" text="Create your first plan so people can buy." />
        ) : (
          <div className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
            {all.map((p) => (
              <div key={p.period} className={cn('flex flex-col rounded-2xl border p-5', p.active ? 'border-border' : 'border-border/60 opacity-70')}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-text">{p.name}</p>
                  {p.popular && <Badge tone="gold">Most popular</Badge>}
                  {!p.active && <Badge tone="warning">Switched off</Badge>}
                </div>
                <p className="mt-3 font-display text-3xl font-semibold text-text tabular">{inr(p.price)}</p>
                <p className="text-xs text-text-secondary">{perLabel(p.months)} · about {inr(Math.round(p.price / p.months))} a month</p>
                {p.description && <p className="mt-3 text-sm text-text-secondary">{p.description}</p>}
                <p className="mt-3 text-xs text-text-disabled">{p.features.length ? `${p.features.length} feature line${p.features.length === 1 ? '' : 's'}` : 'Shows the standard feature list'} · code <code className="text-gold">{p.period}</code></p>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  <Button size="sm" variant="gold" onClick={() => setForm(toForm(p))}><Pencil size={14} /> Edit</Button>
                  <Button size="sm" onClick={() => toggle(p)} disabled={upsertPlan.isPending}>{p.active ? 'Switch off' : 'Switch on'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(p)} aria-label={`Delete ${p.name}`}><Trash2 size={14} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="border-t border-border/70 px-5 py-4 text-xs text-text-secondary">A new price applies to new subscriptions. People already on autopay keep the price they signed up at, until they cancel and subscribe again. A plan that has been sold can be switched off but not deleted, and its duration cannot change.</p>
      </Card>

      {form && (
        <Modal title={form.isNew ? 'Create a plan' : `Edit ${form.name}`} eyebrow="Plans & prices" onClose={() => setForm(null)} width="max-w-2xl"
          footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button variant="gold" onClick={save} disabled={upsertPlan.isPending}>{upsertPlan.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {form.isNew ? 'Create plan' : 'Save changes'}</Button></>}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Plan name" required hint="what buyers see"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Starter, Pro, Diwali offer..." maxLength={40} /></Field>
              <Field label="Plan code" hint={form.isNew ? 'made from the name, cannot change later' : 'cannot be changed'}><Input value={code} onChange={(e) => setForm({ ...form, period: slugPlan(e.target.value) })} disabled={!form.isNew} placeholder="starter" /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Price (Rs)" required hint="charged every period"><Input type="number" min={1} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="numeric" placeholder="1499" /></Field>
              <Field label="Duration (months)" required hint="1 to 36"><Input type="number" min={1} max={36} value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} inputMode="numeric" /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => <button key={d.m} type="button" onClick={() => setForm({ ...form, months: String(d.m) })} className={cn('rounded-full border px-3 py-1 text-xs transition-colors', months === d.m ? 'border-gold bg-gold/12 text-gold' : 'border-border text-text-secondary hover:text-text')}>{d.l}</button>)}
            </div>
            <p className="text-xs text-text-secondary">{price > 0 && months > 0 ? `Buyers pay ${inr(price)} ${perLabel(months)}, about ${inr(Math.round(price / months))} a month.` : 'Enter a price and a duration.'}</p>
            <Field label="Short description" hint="optional, one line"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} placeholder="Best for small venues" /></Field>
            <Field label="What is included" hint="one line per feature, up to 12. Blank = standard list"><Textarea rows={6} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder={'Quotations and PDF bills\nCalendar with double-booking protection\nUp to 3 employee logins'} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Order on page" hint="1 = first"><Input type="number" min={1} value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} inputMode="numeric" /></Field>
              <div className="pt-6"><Switch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Offer this plan" /></div>
              <div className="pt-6"><Switch checked={form.popular} onChange={(v) => setForm({ ...form, popular: v })} label="Most popular" /></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
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
  const { all: plans } = usePlans();
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
          {f.kind !== 'free_days' && <Field label="Works on"><Select value={f.periods} onChange={(e) => setF({ ...f, periods: e.target.value as '' | BillingPeriod })}><option value="">All plans</option>{plans.map((p) => <option key={p.period} value={p.period}>{p.name} only</option>)}</Select></Field>}
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
