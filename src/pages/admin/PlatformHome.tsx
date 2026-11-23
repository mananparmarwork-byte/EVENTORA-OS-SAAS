import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Building2, CalendarClock, IndianRupee, Inbox, KeyRound, MessageCircle, RefreshCw, Wallet } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from '@/components/ui';
import { ContactButtons, PhoneLink } from '@/components/Contact';
import { usePlans } from '@/lib/api';
import { useInboxCounts, usePlatformConfig, usePlatformExt, usePlatformLeads, usePlatformRequests } from '@/lib/apiExt';
import { fmtDate, inr } from '@/lib/format';
import { ManageModal } from '@/pages/admin/PlatformDashboard';
import { MarkPaidModal } from '@/pages/admin/PlatformPayments';
import { STATUS_META, amountDue, daysLine, istMonth, reminderMessage, thisMonthKey, useClients, useLedger, type ClientRow } from '@/pages/admin/platformShared';

export type HomeTarget = 'requests' | 'clients' | 'payments';
const KIND: Record<string, string> = { renewal: 'Renewal', branch: 'Extra branch', support: 'Message' };

function Kpi({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: 'error' | 'success' | 'warning'; onClick?: () => void }) {
  const cls = tone === 'error' ? 'text-error' : tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-text';
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="rounded-2xl border border-border bg-surface p-5 text-left transition-colors enabled:hover:border-gold/50">
      <p className="text-xs text-text-secondary">{label}</p><p className={`tabular mt-1 font-display text-3xl font-semibold ${cls}`}>{value}</p>{sub && <p className="mt-1 text-[11px] text-text-disabled">{sub}</p>}
    </button>
  );
}

/** Home: today's list of things to do. What is waiting for you, who to collect from, what came in. */
export function HomeTab({ onGo }: { onGo: (target: HomeTarget, filter?: string) => void }) {
  const { rows, isLoading, error, refetch, isFetching } = useClients();
  const { ledger } = useLedger();
  const { plans } = usePlans();
  const { data: cfg } = usePlatformConfig();
  const { data: counts } = useInboxCounts();
  const reqs = usePlatformRequests('pending');
  const leads = usePlatformLeads();
  const { purge } = usePlatformExt();
  const [payId, setPayId] = useState<string | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  // answered requests older than your auto-delete setting are cleared whenever you open Home
  useEffect(() => { purge.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const collect = useMemo(() => rows.filter((r) => r.bucket === 'overdue' || r.bucket === 'due_soon').sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)), [rows]);
  const trials = useMemo(() => rows.filter((r) => r.bucket === 'trial_ended' || (r.bucket === 'trial' && (r.daysLeft ?? 99) <= 3)).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)), [rows]);
  const toCollect = collect.reduce((a, r) => a + amountDue(r, plans, ledger), 0);
  const overdue = rows.filter((r) => r.bucket === 'overdue').length;
  const monthTotal = ledger.filter((p) => istMonth(p.paidAt) === thisMonthKey()).reduce((a, p) => a + p.amount, 0);
  const newLeads = (leads.data ?? []).filter((l) => l.status === 'new');
  const waiting = (counts?.requests ?? 0) + (counts?.leads ?? 0);
  const paying = rows.find((r) => r.id === payId) ?? null;
  const managing = rows.find((r) => r.id === manageId) ?? null;
  const noMobile = rows.filter((r) => !r.phone || r.phone.replace(/\D/g, '').length < 10).length;

  if (isLoading) return <Spinner label="Loading" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{error.message}</Card>;

  const row = (r: ClientRow, kind: 'collect' | 'trial') => {
    const amt = amountDue(r, plans, ledger);
    return (
      <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">{r.name}<Badge tone={STATUS_META[r.bucket].tone}>{STATUS_META[r.bucket].label}</Badge></p>
          <p className="mt-0.5 text-xs text-text-secondary">{r.planName ?? 'No plan'} · {r.endsAt && (r.daysLeft ?? 0) < 3650 ? fmtDate(r.endsAt) : '—'} · <span className={r.daysLeft != null && r.daysLeft < 0 ? 'text-error' : 'text-warning'}>{daysLine(r)}</span>{amt > 0 && kind === 'collect' ? <> · <span className="font-medium text-text">{inr(amt)}</span></> : null}</p>
          <p className="mt-1"><PhoneLink phone={r.phone} className="text-xs" /></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {r.phone && r.phone.replace(/\D/g, '').length >= 10 ? <ContactButtons phone={r.phone} message={reminderMessage(r, cfg ?? {}, amt)} whatsappLabel="Remind" /> : <Button size="sm" variant="soft" onClick={() => setManageId(r.id)}>Add number</Button>}
          <Button size="sm" variant="gold" onClick={() => setPayId(r.id)}><IndianRupee size={13} /> Mark as paid</Button>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Home</h2><p className="mt-1 text-sm text-text-secondary">What needs you today: replies, money to collect, and what came in.</p></div>
        <Button size="sm" variant="outline" onClick={() => { refetch(); void reqs.refetch(); void leads.refetch(); }} disabled={isFetching}><RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Received this month" value={inr(monthTotal)} sub="see all in Payments" tone="success" onClick={() => onGo('payments')} />
        <Kpi label="Still to collect" value={inr(toCollect)} sub={`${collect.length} client${collect.length === 1 ? '' : 's'} overdue or due in 7 days`} tone={collect.length ? 'warning' : undefined} />
        <Kpi label="Overdue" value={String(overdue)} sub="plan ended, not renewed" tone={overdue ? 'error' : undefined} onClick={() => onGo('clients', 'overdue')} />
        <Kpi label="Waiting for your reply" value={String(waiting)} sub="requests and new leads" tone={waiting ? 'warning' : undefined} onClick={() => onGo('requests')} />
      </div>

      {noMobile > 0 && (
        <button type="button" onClick={() => onGo('clients', 'no_mobile')} className="flex w-full items-center gap-3 rounded-2xl border border-warning/40 bg-warning-bg px-4 py-3 text-left text-sm text-warning">
          <span className="font-semibold">{noMobile} client{noMobile === 1 ? ' has' : 's have'} no mobile number.</span><span className="underline">Add them so you can call anytime</span>
        </button>
      )}

      <Card>
        <CardHeader title="Waiting for you" subtitle="Renewal and branch requests, messages, and people asking for access" action={<Button size="sm" variant="ghost" onClick={() => onGo('requests')}>Open all <ArrowRight size={13} /></Button>} />
        {(reqs.data ?? []).length === 0 && newLeads.length === 0 ? <EmptyState icon={<Inbox size={20} />} title="Nothing is waiting" text="New requests from owners and from your website show up here." /> : (
          <ul className="divide-y divide-border/60">
            {(reqs.data ?? []).slice(0, 5).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-hover text-gold">{r.kind === 'branch' ? <Building2 size={16} /> : r.kind === 'renewal' ? <KeyRound size={16} /> : <MessageCircle size={16} />}</span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text">{r.business} <Badge>{KIND[r.kind]}</Badge></p><p className="truncate text-xs text-text-secondary">{r.subject}{r.kind === 'renewal' && r.payload.reference ? ` · ref ${r.payload.reference}` : ''} · {fmtDate(r.createdAt)}</p><PhoneLink phone={r.phone || r.payload.contact} className="text-xs" /></div>
                <div className="flex items-center gap-2"><ContactButtons phone={r.phone || r.payload.contact} message={`Hello ${r.business},`} /><Button size="sm" variant="gold" onClick={() => onGo('requests')}>{r.kind === 'support' ? 'Reply' : 'Review'}</Button></div>
              </li>
            ))}
            {newLeads.slice(0, 4).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold"><Inbox size={16} /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text">{l.name}{l.business ? ` · ${l.business}` : ''} <Badge tone="gold">New lead</Badge></p><PhoneLink phone={l.phone} className="text-xs" /></div>
                <div className="flex items-center gap-2"><ContactButtons phone={l.phone} message={`Hello ${l.name}, thank you for your interest in Eventora OS.`} /><Button size="sm" variant="gold" onClick={() => onGo('requests', 'leads')}>Open</Button></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Money to collect" subtitle="Plans that ended or end within 7 days. Remind them, then mark as paid when the money arrives." action={<CalendarClock size={18} className="text-gold" />} />
        {collect.length === 0 ? <EmptyState icon={<Wallet size={20} />} title="Nobody owes you right now" text="Clients whose plan ends soon or has ended appear here." /> : <ul className="divide-y divide-border/60">{collect.map((r) => row(r, 'collect'))}</ul>}
      </Card>

      {trials.length > 0 && (
        <Card>
          <CardHeader title="Trials to follow up" subtitle="Trial ended without payment, or ending in 3 days" />
          <ul className="divide-y divide-border/60">{trials.slice(0, 8).map((r) => row(r, 'trial'))}</ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Latest payments" action={<Button size="sm" variant="ghost" onClick={() => onGo('payments')}>All payments <ArrowRight size={13} /></Button>} />
        {ledger.length === 0 ? <EmptyState icon={<Wallet size={20} />} title="No payments yet" text="Use “Mark as paid” when a client pays you." /> : (
          <ul className="divide-y divide-border/60">
            {ledger.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-text">{p.business}</span><span className="block text-xs text-text-secondary">{p.planName ?? '—'} · {p.method} · {fmtDate(p.paidAt)}</span></span>
                <span className="tabular font-semibold text-text">{inr(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {paying && <MarkPaidModal client={paying} onClose={() => setPayId(null)} />}
      {managing && <ManageModal row={managing} onClose={() => setManageId(null)} onPaid={() => { setManageId(null); setPayId(managing.id); }} />}
    </div>
  );
}
