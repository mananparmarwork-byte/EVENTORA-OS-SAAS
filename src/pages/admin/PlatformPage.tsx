import { useMemo, useState } from 'react';
import { Building2, Search, Settings, Tags, Ticket, Users } from 'lucide-react';
import { CouponsTab, PlansTab, PlatformSettingsTab } from './PlatformExtra';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Select, Spinner, useUi } from '@/components/ui';
import { useSetTenantSubscription, useTenants } from '@/lib/api';
import { cn, fmtDate, inr } from '@/lib/format';
import type { SubStatus } from '@/lib/types';

const TONE: Record<SubStatus, 'success' | 'gold' | 'warning' | 'error' | 'neutral'> = { active: 'success', trialing: 'gold', past_due: 'warning', cancelled: 'warning', expired: 'error' };
const STATUSES: SubStatus[] = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];

/** Software-owner panel: every business that uses your SaaS. */
type PTab = 'businesses' | 'plans' | 'coupons' | 'settings';
const TABS: { id: PTab; label: string; icon: React.ReactNode }[] = [
  { id: 'businesses', label: 'Businesses', icon: <Users size={16} /> }, { id: 'plans', label: 'Plans & prices', icon: <Tags size={16} /> },
  { id: 'coupons', label: 'Coupons', icon: <Ticket size={16} /> }, { id: 'settings', label: 'Free trial', icon: <Settings size={16} /> },
];

export function PlatformPage() {
  const [tab, setTab] = useState<PTab>('businesses');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-surface p-1.5">
        {TABS.map((t) => <button key={t.id} type="button" onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors', tab === t.id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>{t.icon}{t.label}</button>)}
      </div>
      {tab === 'businesses' && <Businesses />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'coupons' && <CouponsTab />}
      {tab === 'settings' && <PlatformSettingsTab />}
    </div>
  );
}

function Businesses() {
  const { toast, confirm } = useUi();
  const { data = [], isLoading, error } = useTenants(true);
  const set = useSetTenantSubscription();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | SubStatus>('all');

  const rows = useMemo(() => data.filter((t) => (filter === 'all' || t.status === filter) && (!search.trim() || [t.name, t.slug, t.ownerEmail ?? ''].some((v) => v.toLowerCase().includes(search.trim().toLowerCase())))), [data, filter, search]);
  const count = (s: SubStatus) => data.filter((t) => t.status === s).length;

  const act = (id: string, status: SubStatus | null, days: number, msg: string) => set.mutate({ tenantId: id, status, extendDays: days }, { onSuccess: () => toast(msg), onError: (e) => toast(e.message, 'error') });
  const suspend = async (id: string, name: string) => { if (await confirm({ title: `Suspend ${name}?`, text: 'They can still view their data but cannot create or change anything until you reactivate or they pay.', confirmLabel: 'Suspend', danger: true })) act(id, 'expired', 0, `${name} suspended.`); };

  if (isLoading) return <Spinner label="Loading businesses" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;

  return (
    <div className="space-y-6">
      <div><h2 className="font-display text-2xl font-semibold text-text">All businesses</h2><p className="mt-1 text-sm text-text-secondary">Every venue using your software. Only you can see this page.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[['Businesses', String(data.length)], ['Paying', String(count('active'))], ['On trial', String(count('trialing'))], ['Overdue', String(count('past_due'))], ['Revenue so far', inr(data.reduce((a, t) => a + (t.paid ?? 0), 0))]].map(([l, v]) => (
          <Card key={l} className="p-5"><p className="text-xs text-text-secondary">{l}</p><p className="mt-1 text-2xl font-semibold text-text tabular">{v}</p></Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Businesses" subtitle={`${rows.length} shown`} action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | SubStatus)} className="h-9 w-40 text-xs" aria-label="Status"><option value="all">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
            <div className="relative w-56"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" /><Input className="h-9 pl-9 text-xs" placeholder="Name, address, email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search businesses" /></div>
          </div>} />
        {rows.length === 0 ? <EmptyState icon={<Building2 />} title="No businesses found" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-text-disabled"><th className="px-5 py-3">Business</th><th className="px-5 py-3">Owner</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Ends</th><th className="px-5 py-3">Autopay</th><th className="px-5 py-3 text-right">Paid</th><th className="px-5 py-3 text-right">Bills</th><th className="px-5 py-3 text-right">People</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-3.5"><p className="font-medium text-text">{t.name}</p><p className="font-mono text-[11px] text-text-disabled">/t/{t.slug} · joined {fmtDate(t.createdAt)}</p></td>
                    <td className="px-5 py-3.5 text-text-secondary">{t.ownerEmail ?? '—'}</td>
                    <td className="px-5 py-3.5">{t.status ? <Badge tone={TONE[t.status]}>{t.status.replace('_', ' ')}{t.period && t.status === 'active' ? ` · ${t.period}` : ''}</Badge> : '—'}</td>
                    <td className="px-5 py-3.5 text-text-secondary">{fmtDate((t.status === 'trialing' ? t.trialEndsAt : t.currentPeriodEnd) ?? '') || '—'}</td>
                    <td className="px-5 py-3.5">{t.autopay ? <Badge tone="success">On</Badge> : <span className="text-text-disabled">Off</span>}{t.couponCode ? <span className="ml-2 font-mono text-[10px] text-gold">{t.couponCode}</span> : null}</td>
                    <td className="px-5 py-3.5 text-right tabular text-text">{inr(t.paid ?? 0)}</td>
                    <td className="px-5 py-3.5 text-right tabular text-text">{t.bills}</td>
                    <td className="px-5 py-3.5 text-right tabular text-text">{t.members}</td>
                    <td className="px-5 py-3.5"><div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => act(t.id, null, 7, `+7 days for ${t.name}.`)} disabled={set.isPending}>+7 d</Button>
                      <Button size="sm" variant="outline" onClick={() => act(t.id, null, 30, `+30 days for ${t.name}.`)} disabled={set.isPending}>+30 d</Button>
                      <Button size="sm" variant="soft" onClick={() => act(t.id, 'active', 0, `${t.name} activated.`)} disabled={set.isPending}>Activate</Button>
                      <Button size="sm" variant="danger" className={cn(t.status === 'expired' && 'opacity-50')} onClick={() => void suspend(t.id, t.name)} disabled={set.isPending}>Suspend</Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
