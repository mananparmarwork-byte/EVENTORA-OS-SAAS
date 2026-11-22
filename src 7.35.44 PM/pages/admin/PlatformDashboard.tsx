import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Copy, Download, KeyRound, Loader2, RefreshCw, Save, Search, TrendingUp, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, useUi } from '@/components/ui';
import { usePlans, usePlatformActions, usePlatformDashboard, useSetTenantSubscription, useSubscriptionOverview, useTenantPayments } from '@/lib/api';
import { cn, fmtDate, inr } from '@/lib/format';
import type { SubRow, SubState } from '@/lib/types';

type Tone = 'success' | 'gold' | 'warning' | 'error' | 'neutral';
export const STATE: Record<SubState, { label: string; short: string; tone: Tone; help: string }> = {
  renewing: { label: 'Renewing (autopay on)', short: 'Renewing', tone: 'success', help: 'Paid, and Razorpay will charge them again by itself.' },
  manual_renew: { label: 'Paid, must renew by hand', short: 'Manual renew', tone: 'gold', help: 'Paid, but autopay is off. They must pay again before the end date.' },
  cancelling: { label: 'Cancelled, ends soon', short: 'Cancelling', tone: 'warning', help: 'Stopped autopay. Still has access until the end date, then will not renew.' },
  past_due: { label: 'Payment failed', short: 'Payment failed', tone: 'error', help: 'The last autopay charge failed. Razorpay retries for a few days.' },
  lapsed: { label: "Didn't renew", short: "Didn't renew", tone: 'error', help: 'Paid before, but the plan ended and they did not renew.' },
  trial: { label: 'On free trial', short: 'On trial', tone: 'gold', help: 'Trying the software for free.' },
  trial_ended: { label: 'Expired, never paid', short: 'Never paid', tone: 'neutral', help: 'Trial ended (or access removed) and they never paid.' },
  free_access: { label: 'Free access (given by you)', short: 'Free access', tone: 'neutral', help: 'You gave them access without payment.' },
  no_plan: { label: 'No plan', short: 'No plan', tone: 'neutral', help: 'No subscription record yet.' },
};
const PAYING: SubState[] = ['renewing', 'manual_renew', 'past_due', 'cancelling'];

export const daysText = (r: { daysLeft: number | null }) =>
  r.daysLeft == null ? '—' : r.daysLeft > 3650 ? 'No expiry' : r.daysLeft >= 1 ? `${r.daysLeft} days left` : r.daysLeft === 0 ? 'Ends today' : `Ended ${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} ago`;

/* ------------------------------------------------------------- small chart helpers --- */
function Bars({ data, format, label }: { data: { label: string; values: { v: number; cls: string; name: string }[] }[]; format: (n: number) => string; label: string }) {
  const max = Math.max(1, ...data.flatMap((d) => d.values.map((x) => x.v)));
  return (
    <div role="img" aria-label={label} className="flex h-44 items-end gap-1.5 sm:gap-2.5">
      {data.map((d) => (
        <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col justify-end">
          <div className="flex flex-1 items-end justify-center gap-0.5">
            {d.values.map((x) => <div key={x.name} title={`${d.label} · ${x.name}: ${format(x.v)}`} className={cn('w-full max-w-[22px] rounded-t-md', x.cls)} style={{ height: `${Math.max(x.v > 0 ? 4 : 1, (x.v / max) * 100)}%` }} />)}
          </div>
          <p className="mt-2 truncate text-center text-[10px] text-text-disabled">{d.label.split(' ')[0]}</p>
        </div>
      ))}
    </div>
  );
}
function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'error' | 'success' }) {
  return (
    <Card className="p-5">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular text-text', tone === 'error' && 'text-error', tone === 'success' && 'text-success')}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-text-disabled">{sub}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------------ Dashboard --- */
export function DashboardTab({ onGo }: { onGo: (filter: SubState | 'all' | 'attention', search?: string) => void }) {
  const { data: d, isLoading, error, refetch, isFetching } = usePlatformDashboard();
  if (isLoading) return <Spinner label="Loading dashboard" />;
  if (error || !d) return <Card className="p-8 text-center text-sm text-error">{(error as Error | null)?.message ?? 'Could not load the dashboard.'}</Card>;

  const c = (s: SubState) => d.counts[s] ?? 0;
  const paying = PAYING.reduce((a, s) => a + c(s), 0);
  const lastMonth = d.revenue.lastMonth;
  const delta = lastMonth > 0 ? Math.round(((d.revenue.thisMonth - lastMonth) / lastMonth) * 100) : null;
  const breakdown: { s: SubState; n: number }[] = (['renewing', 'manual_renew', 'cancelling', 'past_due', 'lapsed', 'trial', 'trial_ended', 'free_access'] as SubState[]).map((s) => ({ s, n: c(s) }));
  const maxN = Math.max(1, ...breakdown.map((b) => b.n));
  const planMax = Math.max(1, ...d.planMix.map((p) => p.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Dashboard</h2><p className="mt-1 text-sm text-text-secondary">Your whole software business at a glance. Only you can see this.</p></div>
        <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>{isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Paying customers" value={String(paying)} sub={`${d.total} businesses in total`} />
        <Kpi label="Monthly recurring revenue" value={inr(Math.round(d.mrr))} sub="what active paid plans bring in each month" />
        <Kpi label="Revenue this month" value={inr(Math.round(d.revenue.thisMonth))} sub={delta == null ? `Last month ${inr(Math.round(lastMonth))}` : `${delta >= 0 ? '+' : ''}${delta}% vs last month (${inr(Math.round(lastMonth))})`} tone={delta != null && delta < 0 ? 'error' : 'success'} />
        <Kpi label="Renewal rate, last 90 days" value={d.renewal.rate == null ? '—' : `${d.renewal.rate}%`} sub={`${d.renewal.renewed90} renewed · ${d.renewal.lapsed90} did not`} tone={d.renewal.rate != null && d.renewal.rate < 60 ? 'error' : undefined} />
        <Kpi label="On free trial" value={String(c('trial'))} sub="may become customers" />
        <Kpi label="Free access given" value={String(c('free_access'))} sub="access you gave without payment" />
        <Kpi label="Didn't renew / payment failed" value={String(c('lapsed') + c('past_due'))} sub="follow up with them" tone={c('lapsed') + c('past_due') > 0 ? 'error' : undefined} />
        <Kpi label="Ending in 14 days" value={String(d.expiring.length >= 10 ? '10+' : d.expiring.length)} sub="plans or trials about to end" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Revenue, last 12 months" subtitle={`${inr(Math.round(d.revenue.allTime))} collected all time`} />
          <div className="p-5"><Bars label="Revenue by month" format={inr} data={d.series.map((s) => ({ label: s.month, values: [{ v: s.revenue, cls: 'bg-gold', name: 'Revenue' }] }))} /></div>
        </Card>
        <Card>
          <CardHeader title="New businesses, last 12 months" subtitle="Signups, and how many became paying" />
          <div className="p-5">
            <Bars label="Signups and new paying customers by month" format={(n) => String(n)} data={d.series.map((s) => ({ label: s.month, values: [{ v: s.signups, cls: 'bg-text-disabled/60', name: 'Signed up' }, { v: s.newPaying, cls: 'bg-success', name: 'Started paying' }] }))} />
            <p className="mt-3 flex gap-4 text-[11px] text-text-secondary"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-text-disabled/60" />Signed up</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-success" />Started paying</span></p>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Who is renewing, who is not" subtitle="Tap a row to see those businesses" />
          <div className="space-y-2 p-5">
            {breakdown.map(({ s, n }) => (
              <button key={s} type="button" onClick={() => onGo(s)} className="group block w-full rounded-xl p-2 text-left transition-colors hover:bg-surface-hover" title={STATE[s].help}>
                <div className="flex items-center justify-between text-sm"><span className="text-text">{STATE[s].label}</span><span className="tabular font-semibold text-text">{n}</span></div>
                <div className="mt-1.5 h-2 rounded-full bg-border/60"><div className={cn('h-2 rounded-full', STATE[s].tone === 'success' ? 'bg-success' : STATE[s].tone === 'error' ? 'bg-error' : STATE[s].tone === 'warning' ? 'bg-warning' : STATE[s].tone === 'gold' ? 'bg-gold' : 'bg-text-disabled/60')} style={{ width: `${(n / maxN) * 100}%` }} /></div>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Plans in use" subtitle="Paying customers per plan" />
          {d.planMix.length === 0 ? <EmptyState icon={<TrendingUp size={20} />} title="No paying customers yet" text="They appear here after the first payment." /> : (
            <div className="space-y-3 p-5">
              {d.planMix.map((p) => (
                <div key={p.name}><div className="flex justify-between text-sm"><span className="text-text">{p.name}</span><span className="tabular font-semibold text-text">{p.count}</span></div>
                  <div className="mt-1.5 h-2 rounded-full bg-border/60"><div className="h-2 rounded-full bg-gold" style={{ width: `${(p.count / planMax) * 100}%` }} /></div></div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Ending in the next 14 days" subtitle="Plans and trials that need attention" action={<CalendarClock size={18} className="text-gold" />} />
          {d.expiring.length === 0 ? <EmptyState icon={<CalendarClock size={20} />} title="Nothing ends soon" /> : (
            <ul className="divide-y divide-border/60">
              {d.expiring.map((e) => (
                <li key={e.id}><button type="button" onClick={() => onGo('all', e.name)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-surface-hover">
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-text">{e.name}</span><span className="block truncate text-xs text-text-secondary">{e.planName ?? '—'} · {fmtDate(e.endsAt)}</span></span>
                  <span className="flex shrink-0 items-center gap-2">{e.state === 'renewing' ? <Badge tone="success">Autopay</Badge> : <Badge tone={STATE[e.state].tone}>{STATE[e.state].short}</Badge>}<span className="text-xs tabular text-text-secondary">{daysText(e)}</span></span>
                </button></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Didn't renew or payment failed" subtitle="Worth a call or message" action={<AlertTriangle size={18} className="text-error" />} />
          {d.lapsed.length === 0 ? <EmptyState icon={<Users size={20} />} title="Everyone is up to date" /> : (
            <ul className="divide-y divide-border/60">
              {d.lapsed.map((e) => (
                <li key={e.id}><button type="button" onClick={() => onGo('all', e.name)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-surface-hover">
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-text">{e.name}</span><span className="block truncate text-xs text-text-secondary">{e.ownerEmail ?? 'no owner email'} · {e.planName ?? '—'}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><Badge tone={STATE[e.state].tone}>{STATE[e.state].short}</Badge><span className="text-xs tabular text-text-secondary">{daysText(e)}</span></span>
                </button></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Latest payments" />
        {d.recentPayments.length === 0 ? <EmptyState icon={<TrendingUp size={20} />} title="No payments yet" text="Payments from Razorpay (and ones you record yourself) show here." /> : (
          <ul className="divide-y divide-border/60">
            {d.recentPayments.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-text">{p.tenant}</span><span className="block text-xs text-text-secondary">{p.planName ?? '—'} · {fmtDate(p.paidAt)}</span></span>
                <span className="flex shrink-0 items-center gap-2">{p.renewal && <Badge tone="success">Renewal</Badge>}{p.offline && <Badge tone="neutral">Offline</Badge>}<span className="tabular font-semibold text-text">{inr(p.amount)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------------- Subscriptions --- */
type Filter = SubState | 'all' | 'attention';
const CHIPS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'attention', label: 'Needs attention' }, { id: 'renewing', label: 'Renewing' }, { id: 'manual_renew', label: 'Manual renew' },
  { id: 'cancelling', label: 'Cancelling' }, { id: 'past_due', label: 'Payment failed' }, { id: 'lapsed', label: "Didn't renew" }, { id: 'trial', label: 'On trial' }, { id: 'trial_ended', label: 'Never paid' }, { id: 'free_access', label: 'Free access' },
];
const inFilter = (r: SubRow, f: Filter) => f === 'all' || (f === 'attention' ? r.state === 'past_due' || r.state === 'lapsed' || r.state === 'cancelling' || (r.daysLeft != null && r.daysLeft >= 0 && r.daysLeft <= 7 && r.state !== 'renewing' && r.state !== 'free_access') : r.state === f);

export function SubscriptionsTab({ initialFilter = 'all', initialSearch = '' }: { initialFilter?: Filter; initialSearch?: string }) {
  const { toast } = useUi();
  const { data = [], isLoading, error, refetch, isFetching } = useSubscriptionOverview();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState(initialSearch);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { setFilter(initialFilter); setSearch(initialSearch); }, [initialFilter, initialSearch]);

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => data.filter((r) => inFilter(r, filter) && (!q || [r.name, r.slug, r.ownerEmail ?? ''].some((v) => v.toLowerCase().includes(q)))), [data, filter, q]);
  const open = data.find((r) => r.id === openId) ?? null;

  const copy = async (path: string, label: string) => {
    const url = `${window.location.origin}${window.location.pathname}#/${path}`;
    try { await navigator.clipboard.writeText(url); toast(`${label} copied. Send it to your customer.`); } catch { toast(url, 'info'); }
  };
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Business', 'Owner email', 'Status', 'Plan', 'Ends on', 'Days left', 'Autopay', 'Payments', 'Renewals', 'Paid (INR)', 'Last payment', 'Note'];
    const lines = rows.map((r) => [r.name, r.ownerEmail, STATE[r.state].label, r.planName, r.endsAt ? fmtDate(r.endsAt) : '', r.daysLeft, r.autopay ? 'Yes' : 'No', r.paymentsCount, r.renewals, r.paid, r.lastPaymentAt ? fmtDate(r.lastPaymentAt) : '', r.note].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `eventora-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  if (isLoading) return <Spinner label="Loading subscriptions" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;
  const count = (f: Filter) => data.filter((r) => inFilter(r, f)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Subscriptions & access</h2><p className="mt-1 text-sm text-text-secondary">Every customer: when their plan ends, whether they renew, and what you have given them.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void copy('signup', 'Signup link')}><Copy size={14} /> Signup link</Button>
          <Button size="sm" variant="outline" onClick={() => void copy('buy', 'Buy link')}><Copy size={14} /> Buy link</Button>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>{isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</Button>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border/70 p-4">
          {CHIPS.map((ch) => (
            <button key={ch.id} type="button" onClick={() => setFilter(ch.id)} className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors', filter === ch.id ? 'border-gold bg-gold/12 text-gold' : 'border-border text-text-secondary hover:text-text')}>
              {ch.label} <span className="ml-1 tabular opacity-70">{count(ch.id)}</span>
            </button>
          ))}
        </div>
        <CardHeader title="Customers" subtitle={`${rows.length} shown`} action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-56"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" /><Input className="h-9 pl-9 text-xs" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}><Download size={14} /> Export CSV</Button>
          </div>} />
        {rows.length === 0 ? <EmptyState icon={<Users size={20} />} title="No customers match" text="Try another filter or search." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-text-disabled">
                <th className="px-5 py-3">Business</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Ends</th><th className="px-5 py-3">Autopay</th>
                <th className="px-5 py-3 text-right">Renewals</th><th className="px-5 py-3 text-right">Paid</th><th className="px-5 py-3 text-right">Access</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-3.5"><p className="font-medium text-text">{r.name}</p><p className="text-[11px] text-text-disabled">{r.ownerEmail ?? 'no owner email'}</p>{r.note && <p className="mt-0.5 max-w-[240px] truncate text-[11px] italic text-gold" title={r.note}>{r.note}</p>}</td>
                    <td className="px-5 py-3.5 text-text-secondary">{r.planName ?? '—'}</td>
                    <td className="px-5 py-3.5"><Badge tone={STATE[r.state].tone}>{STATE[r.state].short}</Badge></td>
                    <td className="px-5 py-3.5"><p className="text-text">{r.endsAt && (r.daysLeft ?? 0) < 3650 ? fmtDate(r.endsAt) : '—'}</p><p className={cn('text-[11px]', r.daysLeft != null && r.daysLeft < 0 ? 'text-error' : r.daysLeft != null && r.daysLeft <= 7 ? 'text-warning' : 'text-text-disabled')}>{daysText(r)}</p></td>
                    <td className="px-5 py-3.5">{r.autopay ? <Badge tone="success">On</Badge> : <span className="text-text-disabled">Off</span>}</td>
                    <td className="px-5 py-3.5 text-right tabular text-text">{r.renewals}</td>
                    <td className="px-5 py-3.5 text-right tabular text-text">{inr(r.paid)}</td>
                    <td className="px-5 py-3.5 text-right"><Button size="sm" variant="soft" onClick={() => setOpenId(r.id)}><KeyRound size={14} /> Manage</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <ManageModal row={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------ one customer's access --- */
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (base: Date, n: number) => { const x = new Date(base); x.setDate(x.getDate() + n); return x; };

function ManageModal({ row, onClose }: { row: SubRow; onClose: () => void }) {
  const { toast, confirm } = useUi();
  const { all: plans } = usePlans();
  const { grantAccess, setNote } = usePlatformActions();
  const quick = useSetTenantSubscription();
  const { data: payments = [], isLoading: loadingPay } = useTenantPayments(row.id);

  const running = row.endsAt && row.daysLeft != null && row.daysLeft >= 0 && row.daysLeft < 3650 ? new Date(row.endsAt) : new Date();
  const [period, setPeriod] = useState<string>('');
  const [until, setUntil] = useState(dateInput(addDays(running, 30)));
  const [kind, setKind] = useState<'free' | 'paid'>('free');
  const [amount, setAmount] = useState('');
  const [note, setNoteText] = useState(row.note);

  const give = () => {
    const end = new Date(`${until}T23:59:59`);
    if (!until || Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) { toast('Choose an end date in the future.', 'error'); return; }
    const rupees = kind === 'paid' ? Number(amount) : 0;
    if (kind === 'paid' && !(rupees > 0)) { toast('Enter the amount you received.', 'error'); return; }
    grantAccess.mutate({ tenantId: row.id, period: period || null, until: end.toISOString(), note, amountRupees: rupees },
      { onSuccess: () => { toast(`${row.name} has access until ${fmtDate(end.toISOString())}.`); onClose(); }, onError: (e) => toast(e.message, 'error') });
  };
  const saveNote = () => setNote.mutate({ tenantId: row.id, note }, { onSuccess: () => toast('Note saved.'), onError: (e) => toast(e.message, 'error') });
  const act = (status: 'active' | 'expired' | null, days: number, msg: string) => quick.mutate({ tenantId: row.id, status, extendDays: days }, { onSuccess: () => toast(msg), onError: (e) => toast(e.message, 'error') });
  const suspend = async () => { if (await confirm({ title: `Suspend ${row.name}?`, text: 'They can still view their data but cannot create or change anything until you give access again or they pay.', confirmLabel: 'Suspend', danger: true })) act('expired', 0, `${row.name} suspended.`); };

  return (
    <Modal title={row.name} eyebrow="Manage customer" onClose={onClose} width="max-w-2xl">
      <div className="space-y-6">
        <div className="rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={STATE[row.state].tone}>{STATE[row.state].label}</Badge>{row.autopay && <Badge tone="success">Autopay on</Badge>}{row.couponCode && <Badge tone="gold">{row.couponCode}</Badge>}</div>
          <p className="mt-2 text-sm text-text-secondary">{STATE[row.state].help}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs text-text-secondary sm:grid-cols-2">
            <div className="flex justify-between"><dt>Owner</dt><dd className="text-text">{row.ownerEmail ?? '—'}</dd></div>
            <div className="flex justify-between"><dt>Plan</dt><dd className="text-text">{row.planName ?? '—'}</dd></div>
            <div className="flex justify-between"><dt>Ends</dt><dd className="text-text">{row.endsAt && (row.daysLeft ?? 0) < 3650 ? `${fmtDate(row.endsAt)} (${daysText(row)})` : '—'}</dd></div>
            <div className="flex justify-between"><dt>Joined</dt><dd className="text-text">{fmtDate(row.createdAt)}</dd></div>
            <div className="flex justify-between"><dt>Paid so far</dt><dd className="text-text">{inr(row.paid)} ({row.paymentsCount} payment{row.paymentsCount === 1 ? '' : 's'}, {row.renewals} renewal{row.renewals === 1 ? '' : 's'})</dd></div>
            <div className="flex justify-between"><dt>Using it</dt><dd className="text-text">{row.bills} bills · {row.members} login{row.members === 1 ? '' : 's'}</dd></div>
          </dl>
        </div>

        <section className="space-y-4">
          <div><h3 className="font-semibold text-text">Give access</h3><p className="text-xs text-text-secondary">Choose a plan and an end date. They can use the software right away until that date.</p></div>
          {row.autopay && <p className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">Autopay is on for this customer, so Razorpay will still charge them on its own schedule.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan" hint="shown to them"><Select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="">Keep current ({row.planName ?? 'none'})</option>{plans.map((p) => <option key={p.period} value={p.period}>{p.name}{p.active ? '' : ' (off)'}</option>)}</Select></Field>
            <Field label="Access until" required><Input type="date" value={until} min={dateInput(addDays(new Date(), 1))} onChange={(e) => setUntil(e.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap gap-2">{[30, 90, 180, 365].map((n) => <button key={n} type="button" onClick={() => setUntil(dateInput(addDays(running, n)))} className="rounded-full border border-border px-3 py-1 text-xs text-text-secondary hover:text-text">+{n === 365 ? '1 year' : `${n} days`}</button>)}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['free', 'Free access', 'You are giving it for free'], ['paid', 'Paid outside Razorpay', 'Cash, UPI or bank transfer']] as const).map(([k, t, s]) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-xl border p-3 text-left transition-colors', kind === k ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/50')}><p className="text-sm font-medium text-text">{t}</p><p className="text-xs text-text-secondary">{s}</p></button>
            ))}
          </div>
          {kind === 'paid' && <Field label="Amount received (Rs)" hint="counted in your revenue"><Input type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1499" /></Field>}
          <Field label="Private note" hint="only you see it"><Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Friend of owner, promised 3 months free" /></Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="gold" onClick={give} disabled={grantAccess.isPending}>{grantAccess.isPending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Give access</Button>
            <Button variant="outline" onClick={saveNote} disabled={setNote.isPending}><Save size={15} /> Save note only</Button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold text-text">Quick actions</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => act(null, 7, `+7 days for ${row.name}.`)} disabled={quick.isPending}>+7 days</Button>
            <Button size="sm" variant="outline" onClick={() => act(null, 30, `+30 days for ${row.name}.`)} disabled={quick.isPending}>+30 days</Button>
            <Button size="sm" variant="soft" onClick={() => act('active', 0, `${row.name} activated.`)} disabled={quick.isPending}>Activate</Button>
            <Button size="sm" variant="danger" onClick={() => void suspend()} disabled={quick.isPending}>Suspend</Button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-text">Payment history</h3>
          {loadingPay ? <Spinner label="Loading payments" /> : payments.length === 0 ? <p className="text-sm text-text-secondary">No payments yet.</p> : (
            <ul className="divide-y divide-border/60 rounded-xl border border-border">
              {payments.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="text-text-secondary">{fmtDate(p.paidAt)} · {p.planName ?? '—'}</span><span className="flex items-center gap-2">{p.offline && <Badge tone="neutral">Offline</Badge>}<span className="tabular font-medium text-text">{inr(p.amount)}</span></span></li>)}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
