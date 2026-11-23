import { useEffect, useMemo, useState } from 'react';
import { Download, IndianRupee, KeyRound, Loader2, RefreshCw, Search, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Spinner } from '@/components/ui';
import { ContactButtons, PhoneLink } from '@/components/Contact';
import { useLedger } from '@/pages/admin/platformShared';
import { usePlans } from '@/lib/api';
import { usePlatformConfig } from '@/lib/apiExt';
import { cn, fmtDate, inr } from '@/lib/format';
import { validPhone } from '@/lib/phone';
import { ManageModal } from '@/pages/admin/PlatformDashboard';
import { MarkPaidModal } from '@/pages/admin/PlatformPayments';
import { STATUS_META, STATUS_ORDER, amountDue, daysLine, downloadCsv, istDay, reminderMessage, useClients, type ClientRow, type ClientStatus } from '@/pages/admin/platformShared';

export type ClientFilter = ClientStatus | 'all' | 'no_mobile';

/** The clients list: every business with its contact details, status and money, in one place. */
export function ClientsTab({ initialFilter = 'all', initialSearch = '' }: { initialFilter?: ClientFilter; initialSearch?: string }) {
  const { rows, isLoading, error, refetch, isFetching } = useClients();
  const { ledger } = useLedger();
  const { plans } = usePlans();
  const { data: cfg } = usePlatformConfig();
  const [filter, setFilter] = useState<ClientFilter>(initialFilter);
  const [search, setSearch] = useState(initialSearch);
  const [manageId, setManageId] = useState<string | null>(null);
  const [payId, setPayId] = useState<string | null>(null);
  useEffect(() => { setFilter(initialFilter); setSearch(initialSearch); }, [initialFilter, initialSearch]);

  const q = search.trim().toLowerCase();
  const matches = (r: ClientRow, f: ClientFilter) => f === 'all' || (f === 'no_mobile' ? !validPhone(r.phone) : r.bucket === f);
  const list = useMemo(() => rows.filter((r) => matches(r, filter) && (!q || [r.name, r.ownerEmail ?? '', r.phone, r.businessType].some((v) => v.toLowerCase().includes(q)))), [rows, filter, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (f: ClientFilter) => rows.filter((r) => matches(r, f)).length;
  const missing = count('no_mobile');
  const managing = rows.find((r) => r.id === manageId) ?? null;
  const paying = rows.find((r) => r.id === payId) ?? null;

  const exportCsv = () => downloadCsv(`eventora-clients-${istDay(new Date().toISOString())}.csv`,
    ['Business', 'Type', 'Mobile', 'Owner email', 'Branches', 'Status', 'Plan', 'Ends on', 'Paid so far (INR)', 'Joined', 'Note'],
    list.map((r) => [r.name, r.businessType, r.phone, r.ownerEmail, r.branches, STATUS_META[r.bucket].label, r.planName, r.endsAt && (r.daysLeft ?? 0) < 3650 ? istDay(r.endsAt) : '', r.paid, istDay(r.createdAt), r.note]));

  if (isLoading) return <Spinner label="Loading clients" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{error.message}</Card>;

  const chips: { id: ClientFilter; label: string }[] = [{ id: 'all', label: 'All' }, ...STATUS_ORDER.map((s) => ({ id: s as ClientFilter, label: STATUS_META[s].label }))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Clients</h2><p className="mt-1 text-sm text-text-secondary">Every business using Eventora OS, with their mobile number so you can call or message anyone.</p></div>
        <Button size="sm" variant="outline" onClick={refetch} disabled={isFetching}>{isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh</Button>
      </div>

      {missing > 0 && (
        <button type="button" onClick={() => setFilter('no_mobile')} className="flex w-full items-center gap-3 rounded-2xl border border-warning/40 bg-warning-bg px-4 py-3 text-left text-sm text-warning">
          <span className="font-semibold">{missing} client{missing === 1 ? ' has' : 's have'} no mobile number.</span><span className="underline">Show them and add the number</span>
        </button>
      )}

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border/70 p-4">
          {[...chips, { id: 'no_mobile' as ClientFilter, label: 'No mobile' }].map((ch) => (
            <button key={ch.id} type="button" onClick={() => setFilter(ch.id)} className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors', filter === ch.id ? 'border-gold bg-gold/12 text-gold' : 'border-border text-text-secondary hover:text-text')}>
              {ch.label} <span className="ml-1 tabular opacity-70">{count(ch.id)}</span>
            </button>
          ))}
        </div>
        <CardHeader title="Client list" subtitle={`${list.length} shown`} action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-60"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" /><Input className="h-9 pl-9 text-xs" placeholder="Name, mobile or email" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={list.length === 0}><Download size={14} /> Export CSV</Button>
          </div>} />
        {list.length === 0 ? <EmptyState icon={<Users size={20} />} title="No clients match" text="Try another filter or search." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-text-disabled">
                <th className="px-5 py-3">Client</th><th className="px-5 py-3">Mobile</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Paid so far</th><th className="px-5 py-3">Joined</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {list.map((r) => {
                  const need = r.bucket === 'overdue' || r.bucket === 'due_soon' || r.bucket === 'trial_ended';
                  return (
                    <tr key={r.id} className="border-b border-border/50 align-top last:border-0">
                      <td className="px-5 py-3.5"><p className="font-medium text-text">{r.name}</p><p className="text-[11px] text-text-disabled">{[r.businessType, r.branches > 1 ? `${r.branches} branches` : ''].filter(Boolean).join(' · ') || '—'}</p><p className="text-[11px] text-text-disabled">{r.ownerEmail ?? 'no owner email'}</p>{r.note && <p className="mt-0.5 max-w-[220px] truncate text-[11px] italic text-gold" title={r.note}>{r.note}</p>}</td>
                      <td className="px-5 py-3.5">
                        <PhoneLink phone={r.phone} />
                        <div className="mt-1.5">{validPhone(r.phone) ? <ContactButtons phone={r.phone} message={need ? reminderMessage(r, cfg ?? {}, amountDue(r, plans, ledger)) : `Hello ${r.name},`} whatsappLabel={need ? 'Remind' : 'WhatsApp'} /> : <Button size="sm" variant="soft" onClick={() => setManageId(r.id)}>Add number</Button>}</div>
                      </td>
                      <td className="px-5 py-3.5 text-text-secondary">{r.planName ?? '—'}</td>
                      <td className="px-5 py-3.5"><Badge tone={STATUS_META[r.bucket].tone}>{STATUS_META[r.bucket].label}</Badge><p className={cn('mt-1 text-[11px]', r.daysLeft != null && r.daysLeft < 0 ? 'text-error' : r.daysLeft != null && r.daysLeft <= 7 ? 'text-warning' : 'text-text-disabled')}>{r.endsAt && (r.daysLeft ?? 0) < 3650 ? `${fmtDate(r.endsAt)} · ${daysLine(r)}` : daysLine(r)}</p></td>
                      <td className="tabular px-5 py-3.5 text-right text-text">{inr(r.paid)}<p className="text-[11px] text-text-disabled">{r.paymentsCount} payment{r.paymentsCount === 1 ? '' : 's'}</p></td>
                      <td className="px-5 py-3.5 text-text-secondary">{fmtDate(r.createdAt)}</td>
                      <td className="px-5 py-3.5 text-right"><span className="inline-flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="gold" onClick={() => setPayId(r.id)}><IndianRupee size={13} /> Mark as paid</Button>
                        <Button size="sm" variant="soft" onClick={() => setManageId(r.id)}><KeyRound size={13} /> Manage</Button>
                      </span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {managing && <ManageModal row={managing} onClose={() => setManageId(null)} onPaid={() => { setManageId(null); setPayId(managing.id); }} />}
      {paying && <MarkPaidModal client={paying} onClose={() => setPayId(null)} />}
    </div>
  );
}
