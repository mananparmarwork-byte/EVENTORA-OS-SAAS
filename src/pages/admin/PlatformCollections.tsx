import { useMemo, useState } from 'react';
import { ArrowUpDown, BadgeIndianRupee, CalendarClock, CheckCircle2, Copy, Download, History, Loader2, Mail, MessageCircle, RefreshCw, Search, Send, Wallet } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, useUi } from '@/components/ui';
import { useCollected, useCollectionActions, useCollections, useFollowups, usePlans } from '@/lib/api';
import { cn, fmtDate, fmtDateTime, inr, localISODate, todayISO } from '@/lib/format';
import { STATE, daysText } from './PlatformDashboard';
import type { CollectBucket, CollectedPayment, CollectionRow } from '@/lib/types';

/** Super admin -> Collections: who owes money, who pays soon, what you collected, reminders, and recording payments. */
type Seg = 'pending' | 'due_soon' | 'upcoming' | 'autopay' | 'collected' | 'all';
type SortKey = 'days' | 'amount' | 'plan' | 'name' | 'lastPaid' | 'reminders' | 'promise';
type GroupKey = 'none' | 'plan' | 'status' | 'bucket';
type RangeKey = 'month' | 'last_month' | 'last30' | 'all' | 'custom';
type LedgerSort = 'newest' | 'oldest' | 'amount' | 'name' | 'plan';

const SEGS: { id: Seg; label: string }[] = [
  { id: 'pending', label: 'Pending' }, { id: 'due_soon', label: 'Due in 7 days' }, { id: 'upcoming', label: 'Upcoming (8–30 days)' },
  { id: 'autopay', label: 'Autopay due' }, { id: 'collected', label: 'Collected' }, { id: 'all', label: 'All customers' },
];
const BUCKET_LABEL: Record<CollectBucket, string> = { overdue: 'Pending (ended / not paid)', due_soon: 'Due in 7 days', upcoming: 'Upcoming (8–30 days)', autopay: 'Autopay will charge', later: 'More than 30 days away', none: 'Free / no plan' };
const BUCKET_ORDER: CollectBucket[] = ['overdue', 'due_soon', 'upcoming', 'autopay', 'later', 'none'];
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'days', label: 'Days left' }, { id: 'amount', label: 'Amount' }, { id: 'plan', label: 'Plan' }, { id: 'name', label: 'Business name' },
  { id: 'lastPaid', label: 'Last payment date' }, { id: 'reminders', label: 'Reminders sent' }, { id: 'promise', label: 'Promised date' },
];
const METHODS = ['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Other'];

const inSeg = (r: CollectionRow, s: Seg) => s === 'all' ? true : s === 'pending' ? r.bucket === 'overdue' : r.bucket === s;
const time = (iso: string | null, fallback: number) => (iso ? new Date(iso).getTime() : fallback);
function compare(a: CollectionRow, b: CollectionRow, k: SortKey): number {
  switch (k) {
    case 'days': return (a.daysLeft == null || a.daysLeft >= 3650 ? 1e9 : a.daysLeft) - (b.daysLeft == null || b.daysLeft >= 3650 ? 1e9 : b.daysLeft);
    case 'amount': return a.amountDue - b.amountDue;
    case 'plan': return (a.planName ?? '').localeCompare(b.planName ?? '');
    case 'name': return a.name.localeCompare(b.name);
    case 'lastPaid': return time(a.lastPaymentAt, 0) - time(b.lastPaymentAt, 0);
    case 'reminders': return a.reminders - b.reminders;
    case 'promise': return time(a.promiseDate, 1e15) - time(b.promiseDate, 1e15);
  }
}

/* ------------------------------------------------------------------ helpers --- */
function downloadCsv(name: string, head: string[], lines: unknown[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = '\ufeff' + [head, ...lines].map((l) => l.map(esc).join(',')).join('\n');   // BOM so Excel reads it correctly
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
const billingLink = () => `${window.location.origin}${window.location.pathname}#/admin/billing`;
function reminderText(r: CollectionRow): string {
  const amount = r.amountDue > 0 ? ` The renewal amount is ${inr(r.amountDue)}.` : '';
  if (r.bucket === 'overdue') {
    return r.state === 'trial_ended'
      ? `Hi ${r.name}, your Eventora free trial has ended and the software is locked. Your data is safe.${amount} Subscribe here to continue: ${billingLink()}`
      : `Hi ${r.name}, your Eventora ${r.planName ?? 'plan'} ended on ${r.endsAt ? fmtDate(r.endsAt) : 'the end date'} and the payment is pending.${amount} Please renew here: ${billingLink()}`;
  }
  const d = r.daysLeft ?? 0;
  return `Hi ${r.name}, your Eventora ${r.planName ?? 'plan'} ends ${d <= 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'} (${r.endsAt ? fmtDate(r.endsAt) : ''})`}.${amount} Renew here: ${billingLink()}`;
}
const waNumber = (phone: string) => { const d = phone.replace(/[^0-9]/g, ''); return d.length === 10 ? `91${d}` : d; };
const sum = (rows: CollectionRow[]) => rows.reduce((a, r) => a + r.amountDue, 0);

function Kpi({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: 'error' | 'success' | 'warning'; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular text-text', tone === 'error' && 'text-error', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-text-disabled">{sub}</p>}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="rounded-2xl border border-border bg-surface p-5 text-left transition-colors hover:border-gold/60">{body}</button>
    : <Card className="p-5">{body}</Card>;
}

/* =============================================================== main tab ===== */
export function CollectionsTab() {
  const { toast, confirm } = useUi();
  const { data = [], isLoading, error, refetch, isFetching } = useCollections();
  const act = useCollectionActions();

  const [seg, setSeg] = useState<Seg>('pending');
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('days');
  const [asc, setAsc] = useState(true);
  const [group, setGroup] = useState<GroupKey>('none');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [collectRow, setCollectRow] = useState<CollectionRow | null>(null);
  const [historyRow, setHistoryRow] = useState<CollectionRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // collected money
  const [range, setRange] = useState<RangeKey>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ledgerSort, setLedgerSort] = useState<LedgerSort>('newest');
  const month = useMemo(() => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1).toISOString(), new Date(n.getFullYear(), n.getMonth() + 1, 1).toISOString()] as const; }, []);
  const [rFrom, rTo] = useMemo<[string | null, string | null]>(() => {
    const n = new Date();
    if (range === 'month') return [month[0], month[1]];
    if (range === 'last_month') return [new Date(n.getFullYear(), n.getMonth() - 1, 1).toISOString(), month[0]];
    if (range === 'last30') return [new Date(n.getFullYear(), n.getMonth(), n.getDate() - 30).toISOString(), null];
    if (range === 'custom') return [from ? new Date(`${from}T00:00:00`).toISOString() : null, to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString() : null];
    return [null, null];
  }, [range, from, to, month]);
  const monthQ = useCollected(month[0], month[1]);
  const ledgerQ = useCollected(rFrom, rTo, seg === 'collected');

  const q = search.trim().toLowerCase();
  const plans = useMemo(() => [...new Set(data.map((r) => r.planName).filter((x): x is string => !!x))].sort(), [data]);
  const matches = (r: CollectionRow) => (!planFilter || r.planName === planFilter) && (!q || [r.name, r.ownerEmail ?? '', r.phone].some((v) => v.toLowerCase().includes(q)));

  const rows = useMemo(() => {
    const list = data.filter((r) => inSeg(r, seg) && matches(r));
    const dir = asc ? 1 : -1;
    return list.sort((a, b) => dir * compare(a, b, sortKey) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, seg, q, planFilter, sortKey, asc]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: '', rows }];
    const keyOf = (r: CollectionRow) => group === 'plan' ? (r.planName ?? 'No plan') : group === 'status' ? STATE[r.state].label : BUCKET_LABEL[r.bucket];
    const map = new Map<string, CollectionRow[]>();
    for (const r of rows) { const k = keyOf(r); map.set(k, [...(map.get(k) ?? []), r]); }
    const keys = [...map.keys()];
    if (group === 'bucket') keys.sort((a, b) => BUCKET_ORDER.findIndex((x) => BUCKET_LABEL[x] === a) - BUCKET_ORDER.findIndex((x) => BUCKET_LABEL[x] === b));
    else keys.sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ key: k, label: k, rows: map.get(k) ?? [] }));
  }, [rows, group]);

  const overdue = data.filter((r) => r.bucket === 'overdue');
  const soon = data.filter((r) => r.bucket === 'due_soon');
  const upcoming = data.filter((r) => r.bucket === 'upcoming');
  const auto = data.filter((r) => r.bucket === 'autopay');
  const collectedMonth = (monthQ.data ?? []).reduce((a, p) => a + p.amount, 0);
  const selected = data.filter((r) => picked.has(r.id));
  const allShown = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allShown ? new Set() : new Set(rows.map((r) => r.id)));
  const countOf = (s: Seg) => s === 'collected' ? null : data.filter((r) => inSeg(r, s) && matches(r)).length;

  const logOnly = (r: CollectionRow, action: 'whatsapp' | 'copy', note: string) => act.log.mutate({ tenantId: r.id, action, note, promiseDate: null });
  const sendEmail = async (r: CollectionRow) => {
    if (!r.ownerEmail) { toast(`${r.name} has no owner email. Use WhatsApp instead.`, 'error'); return; }
    if (!(await confirm({ title: `Email a reminder to ${r.name}?`, text: `It goes to ${r.ownerEmail} with a button to pay.`, confirmLabel: 'Send email' }))) return;
    act.sendEmails.mutate({ tenantIds: [r.id], note: '' }, { onSuccess: (res) => toast(res.sent ? `Reminder emailed to ${r.name}.` : (res.errors[0] ?? res.skipped[0] ?? 'Could not send.'), res.sent ? 'success' : 'error'), onError: (e) => toast(e.message, 'error') });
  };
  const whatsapp = (r: CollectionRow) => {
    const url = `https://wa.me/${r.phone ? waNumber(r.phone) : ''}?text=${encodeURIComponent(reminderText(r))}`;
    window.open(url, '_blank', 'noopener');
    logOnly(r, 'whatsapp', r.phone ? 'WhatsApp opened' : 'WhatsApp opened (no saved number)');
    if (!r.phone) toast('No number saved for this customer: pick the contact in WhatsApp. Save it under History to skip this next time.', 'info');
  };
  const copyMsg = async (r: CollectionRow) => {
    try { await navigator.clipboard.writeText(reminderText(r)); logOnly(r, 'copy', 'Message copied'); toast('Reminder text copied.'); } catch { toast(reminderText(r), 'info'); }
  };

  const exportView = () => {
    downloadCsv(`eventora-collections-${seg}`, ['Business', 'Owner email', 'Phone', 'Status', 'Plan', 'Amount due (INR)', 'Ends on', 'Days left', 'Autopay', 'Last payment', 'Last amount (INR)', 'Total paid (INR)', 'Reminders sent', 'Last reminder', 'Promised date', 'Note'],
      (selected.length ? selected : rows).map((r) => [r.name, r.ownerEmail, r.phone, STATE[r.state].label, r.planName, r.amountDue, r.endsAt && (r.daysLeft ?? 0) < 3650 ? fmtDate(r.endsAt) : '', r.daysLeft != null && r.daysLeft < 3650 ? r.daysLeft : '', r.autopay ? 'Yes' : 'No', r.lastPaymentAt ? fmtDate(r.lastPaymentAt) : '', r.lastAmount, r.paid, r.reminders, r.lastReminderAt ? fmtDate(r.lastReminderAt) : '', r.promiseDate ? fmtDate(r.promiseDate) : '', r.note]));
  };

  /* ---- collected ledger ---- */
  const ledger = useMemo(() => {
    const list = (ledgerQ.data ?? []).filter((p) => (!planFilter || p.planName === planFilter) && (!q || [p.tenant, p.ownerEmail ?? ''].some((v) => v.toLowerCase().includes(q))));
    const by: Record<LedgerSort, (a: CollectedPayment, b: CollectedPayment) => number> = {
      newest: (a, b) => +new Date(b.paidAt) - +new Date(a.paidAt), oldest: (a, b) => +new Date(a.paidAt) - +new Date(b.paidAt),
      amount: (a, b) => b.amount - a.amount, name: (a, b) => a.tenant.localeCompare(b.tenant), plan: (a, b) => (a.planName ?? '').localeCompare(b.planName ?? ''),
    };
    return [...list].sort(by[ledgerSort]);
  }, [ledgerQ.data, planFilter, q, ledgerSort]);
  const exportLedger = () => downloadCsv('eventora-collected', ['Date', 'Business', 'Owner email', 'Plan', 'Amount (INR)', 'Received via', 'Renewal', 'Note'],
    ledger.map((p) => [fmtDate(p.paidAt), p.tenant, p.ownerEmail, p.planName, p.amount, p.method, p.renewal ? 'Yes' : 'No', p.note]));

  if (isLoading) return <Spinner label="Loading collections" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Collections</h2><p className="mt-1 text-sm text-text-secondary">Money to collect, money coming up, money collected. Send reminders and record payments in one place.</p></div>
        <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>{isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Pending to collect" value={inr(Math.round(sum(overdue)))} sub={`${overdue.length} business${overdue.length === 1 ? '' : 'es'} · ended or not paid`} tone={overdue.length ? 'error' : undefined} onClick={() => setSeg('pending')} />
        <Kpi label="Due in next 7 days" value={inr(Math.round(sum(soon)))} sub={`${soon.length} paying by hand`} tone={soon.length ? 'warning' : undefined} onClick={() => setSeg('due_soon')} />
        <Kpi label="Upcoming, 8–30 days" value={inr(Math.round(sum(upcoming)))} sub={`${upcoming.length} by hand · ${inr(Math.round(sum(auto)))} on autopay (${auto.length})`} onClick={() => setSeg('upcoming')} />
        <Kpi label="Collected this month" value={monthQ.isLoading ? '…' : inr(Math.round(collectedMonth))} sub={`${(monthQ.data ?? []).length} payment${(monthQ.data ?? []).length === 1 ? '' : 's'} received`} tone="success" onClick={() => { setSeg('collected'); setRange('month'); }} />
      </div>

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border/70 p-4">
          {SEGS.map((s) => (
            <button key={s.id} type="button" onClick={() => setSeg(s.id)} className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors', seg === s.id ? 'border-gold bg-gold/12 text-gold' : 'border-border text-text-secondary hover:text-text')}>
              {s.label}{countOf(s.id) != null && <span className="ml-1 tabular opacity-70">{countOf(s.id)}</span>}
            </button>
          ))}
        </div>

        {/* sequence controls */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-4">
          <div className="relative w-56"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" /><Input className="h-9 pl-9 text-xs" placeholder="Name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Select className="h-9 w-40 text-xs" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} aria-label="Filter by plan"><option value="">All plans</option>{plans.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
          {seg === 'collected' ? (
            <Select className="h-9 w-48 text-xs" value={ledgerSort} onChange={(e) => setLedgerSort(e.target.value as LedgerSort)} aria-label="Order payments by">
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount">Highest amount first</option><option value="name">Business A–Z</option><option value="plan">By plan</option>
            </Select>
          ) : (
            <>
              <Select className="h-9 w-44 text-xs" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Order by">{SORTS.map((s) => <option key={s.id} value={s.id}>Order: {s.label}</option>)}</Select>
              <Button size="sm" variant="outline" onClick={() => setAsc((v) => !v)} title="Flip the order"><ArrowUpDown size={14} /> {asc ? 'Low → High' : 'High → Low'}</Button>
              <Select className="h-9 w-44 text-xs" value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} aria-label="Group by"><option value="none">No grouping</option><option value="plan">Group by plan</option><option value="status">Group by status</option><option value="bucket">Group by due period</option></Select>
            </>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={seg === 'collected' ? exportLedger : exportView} disabled={seg === 'collected' ? ledger.length === 0 : rows.length === 0}><Download size={14} /> Export for Excel{seg !== 'collected' && selected.length ? ` (${selected.length})` : ''}</Button>
          </div>
        </div>

        {seg === 'collected' ? (
          <LedgerView range={range} setRange={setRange} from={from} to={to} setFrom={setFrom} setTo={setTo} loading={ledgerQ.isLoading} error={ledgerQ.error as Error | null} list={ledger} />
        ) : (
          <>
            {selected.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-b border-border/70 bg-gold/8 px-5 py-3 text-sm">
                <span className="font-medium text-text">{selected.length} selected · {inr(Math.round(sum(selected)))}</span>
                <Button size="sm" variant="gold" onClick={() => setBulkOpen(true)}><Send size={14} /> Send reminders</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
              </div>
            )}
            {rows.length === 0 ? <EmptyState icon={<Wallet size={20} />} title={seg === 'pending' ? 'Nothing pending' : 'No customers here'} text="Try another tab or clear the search." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead><tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-text-disabled">
                    <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={toggleAll} /></th>
                    <th className="px-3 py-3">Business</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3">Ends</th><th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Last paid</th><th className="px-3 py-3">Reminders</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
                  <tbody>
                    {groups.map((g) => (
                      <GroupRows key={g.key} label={g.label} rows={g.rows} picked={picked} toggle={toggle}
                        onCollect={setCollectRow} onHistory={setHistoryRow} onEmail={(r) => void sendEmail(r)} onWhatsapp={whatsapp} onCopy={(r) => void copyMsg(r)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {collectRow && <CollectModal row={collectRow} onClose={() => setCollectRow(null)} />}
      {historyRow && <HistoryModal row={data.find((r) => r.id === historyRow.id) ?? historyRow} onClose={() => setHistoryRow(null)} />}
      {bulkOpen && <BulkModal rows={selected} onClose={() => setBulkOpen(false)} onDone={() => setPicked(new Set())} />}
    </div>
  );
}

/* ------------------------------------------------------------------- table rows --- */
function GroupRows({ label, rows, picked, toggle, onCollect, onHistory, onEmail, onWhatsapp, onCopy }: {
  label: string; rows: CollectionRow[]; picked: Set<string>; toggle: (id: string) => void;
  onCollect: (r: CollectionRow) => void; onHistory: (r: CollectionRow) => void; onEmail: (r: CollectionRow) => void; onWhatsapp: (r: CollectionRow) => void; onCopy: (r: CollectionRow) => void;
}) {
  const today = todayISO();
  return (
    <>
      {label && <tr className="bg-surface-hover/60"><td colSpan={9} className="px-5 py-2 text-xs font-semibold text-text">{label} <span className="ml-2 font-normal text-text-secondary">{rows.length} · {inr(Math.round(sum(rows)))}</span></td></tr>}
      {rows.map((r) => {
        const missed = r.promiseDate && r.promiseDate.slice(0, 10) < today && (r.bucket === 'overdue' || r.bucket === 'due_soon');
        return (
          <tr key={r.id} className="border-b border-border/50 last:border-0">
            <td className="px-4 py-3.5"><input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
            <td className="px-3 py-3.5">
              <p className="font-medium text-text">{r.name}</p>
              <p className="text-[11px] text-text-disabled">{r.ownerEmail ?? 'no owner email'}{r.phone ? ` · ${r.phone}` : ''}</p>
              {r.promiseDate && <p className={cn('mt-0.5 text-[11px]', missed ? 'text-error' : 'text-gold')}>{missed ? 'Promise missed: ' : 'Promised to pay: '}{fmtDate(r.promiseDate)}</p>}
              {r.note && <p className="mt-0.5 max-w-[220px] truncate text-[11px] italic text-text-secondary" title={r.note}>{r.note}</p>}
            </td>
            <td className="px-3 py-3.5 text-text-secondary">{r.planName ?? '—'}</td>
            <td className="px-3 py-3.5 text-right tabular font-medium text-text">{r.amountDue > 0 ? inr(r.amountDue) : '—'}</td>
            <td className="px-3 py-3.5"><p className="text-text">{r.endsAt && (r.daysLeft ?? 0) < 3650 ? fmtDate(r.endsAt) : '—'}</p><p className={cn('text-[11px]', r.daysLeft != null && r.daysLeft < 0 ? 'text-error' : r.daysLeft != null && r.daysLeft <= 7 ? 'text-warning' : 'text-text-disabled')}>{daysText(r)}</p></td>
            <td className="px-3 py-3.5"><Badge tone={STATE[r.state].tone}>{STATE[r.state].short}</Badge></td>
            <td className="px-3 py-3.5">{r.lastPaymentAt ? <><p className="text-text">{fmtDate(r.lastPaymentAt)}</p><p className="text-[11px] text-text-disabled">{r.lastAmount != null ? inr(r.lastAmount) : ''}</p></> : <span className="text-text-disabled">Never</span>}</td>
            <td className="px-3 py-3.5">{r.reminders > 0 ? <><p className="text-text">{r.reminders} sent</p><p className="text-[11px] text-text-disabled">last {r.lastReminderAt ? fmtDate(r.lastReminderAt) : ''}</p></> : <span className="text-text-disabled">None yet</span>}</td>
            <td className="px-3 py-3.5">
              <div className="flex items-center justify-end gap-1.5">
                <Button size="sm" variant="ghost" title="Email reminder" aria-label={`Email reminder to ${r.name}`} onClick={() => onEmail(r)}><Mail size={15} /></Button>
                <Button size="sm" variant="ghost" title="WhatsApp reminder" aria-label={`WhatsApp reminder to ${r.name}`} onClick={() => onWhatsapp(r)}><MessageCircle size={15} /></Button>
                <Button size="sm" variant="ghost" title="Copy reminder text" aria-label={`Copy reminder text for ${r.name}`} onClick={() => onCopy(r)}><Copy size={15} /></Button>
                <Button size="sm" variant="ghost" title="History, notes, phone" aria-label={`History for ${r.name}`} onClick={() => onHistory(r)}><History size={15} /></Button>
                <Button size="sm" variant="gold" onClick={() => onCollect(r)}><BadgeIndianRupee size={14} /> Collect</Button>
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------- collected ledger --- */
function LedgerView({ range, setRange, from, to, setFrom, setTo, loading, error, list }: {
  range: RangeKey; setRange: (r: RangeKey) => void; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
  loading: boolean; error: Error | null; list: CollectedPayment[];
}) {
  const total = list.reduce((a, p) => a + p.amount, 0);
  const offline = list.filter((p) => p.offline).reduce((a, p) => a + p.amount, 0);
  const RANGES: [RangeKey, string][] = [['month', 'This month'], ['last_month', 'Last month'], ['last30', 'Last 30 days'], ['all', 'All time'], ['custom', 'Custom dates']];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-3">
        {RANGES.map(([k, l]) => <button key={k} type="button" onClick={() => setRange(k)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', range === k ? 'border-gold bg-gold/12 text-gold' : 'border-border text-text-secondary hover:text-text')}>{l}</button>)}
        {range === 'custom' && (
          <span className="flex items-center gap-2 text-xs text-text-secondary">
            <Input type="date" className="h-8 w-36 text-xs" value={from} max={to || todayISO()} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /> to
            <Input type="date" className="h-8 w-36 text-xs" value={to} min={from} max={localISODate(new Date())} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </span>
        )}
      </div>
      {loading ? <Spinner label="Loading payments" /> : error ? <p className="p-8 text-center text-sm text-error">{error.message}</p> : list.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={20} />} title="No payments in this period" text="Razorpay payments and the ones you record with Collect appear here." />
      ) : (
        <>
          <div className="grid gap-4 border-b border-border/70 px-5 py-4 sm:grid-cols-3">
            <div><p className="text-xs text-text-secondary">Collected</p><p className="text-xl font-semibold tabular text-success">{inr(Math.round(total))}</p></div>
            <div><p className="text-xs text-text-secondary">Payments</p><p className="text-xl font-semibold tabular text-text">{list.length}</p></div>
            <div><p className="text-xs text-text-secondary">Razorpay · recorded by you</p><p className="text-xl font-semibold tabular text-text">{inr(Math.round(total - offline))} · {inr(Math.round(offline))}</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-text-disabled"><th className="px-5 py-3">Date</th><th className="px-3 py-3">Business</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3">Received via</th><th className="px-3 py-3">Note</th><th className="px-5 py-3 text-right">Amount</th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-3 text-text-secondary">{fmtDate(p.paidAt)}</td>
                    <td className="px-3 py-3"><p className="font-medium text-text">{p.tenant}</p><p className="text-[11px] text-text-disabled">{p.ownerEmail ?? ''}</p></td>
                    <td className="px-3 py-3 text-text-secondary">{p.planName ?? '—'}</td>
                    <td className="px-3 py-3"><span className="flex items-center gap-1.5"><Badge tone={p.offline ? 'neutral' : 'info'}>{p.method}</Badge>{p.renewal && <Badge tone="success">Renewal</Badge>}</span></td>
                    <td className="max-w-[220px] truncate px-3 py-3 text-xs text-text-secondary" title={p.note}>{p.note || '—'}</td>
                    <td className="px-5 py-3 text-right tabular font-semibold text-text">{inr(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- record a payment --- */
function CollectModal({ row, onClose }: { row: CollectionRow; onClose: () => void }) {
  const { toast } = useUi();
  const { all: plans } = usePlans();
  const { record } = useCollectionActions();
  const [period, setPeriod] = useState<string>(row.period ?? '');
  const [amount, setAmount] = useState(row.amountDue > 0 ? String(row.amountDue) : '');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState('UPI');
  const [note, setNote] = useState('');
  const plan = plans.find((p) => p.period === period);
  const months = plan?.months ?? row.planMonths;
  const running = row.endsAt && row.daysLeft != null && row.daysLeft >= 0 && row.daysLeft < 3650;
  const newEnd = useMemo(() => { const d = running ? new Date(row.endsAt as string) : new Date(); d.setMonth(d.getMonth() + months); return d; }, [running, row.endsAt, months]);

  const pickPlan = (p: string) => { setPeriod(p); const pl = plans.find((x) => x.period === p); if (pl) setAmount(String(pl.price)); };
  const save = () => {
    const rupees = Number(amount);
    if (!(rupees > 0)) { toast('Enter the amount you received.', 'error'); return; }
    if (!period) { toast('Choose the plan they paid for.', 'error'); return; }
    record.mutate({ tenantId: row.id, period, amountRupees: rupees, paidOn, method, note }, {
      onSuccess: (end) => { toast(`${inr(rupees)} recorded. ${row.name} now has access until ${fmtDate(end)}.`); onClose(); },
      onError: (e) => toast(e.message, 'error'),
    });
  };
  return (
    <Modal title={`Collect from ${row.name}`} eyebrow="Record a payment" onClose={onClose} width="max-w-lg"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="gold" onClick={save} disabled={record.isPending}>{record.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Save payment and renew</Button></div>}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">Use this when they paid you directly (UPI, cash, bank). It adds the money to your revenue and extends their plan by the plan length.</p>
        {row.autopay && <p className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">Autopay is on for this customer, so Razorpay may also charge them. Only record this if they really paid you by hand.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan paid for" required><Select value={period} onChange={(e) => pickPlan(e.target.value)}><option value="" disabled>Choose a plan</option>{plans.map((p) => <option key={p.period} value={p.period}>{p.name} · {inr(p.price)}</option>)}</Select></Field>
          <Field label="Amount received (Rs)" required><Input type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Received on"><Input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label="Received via"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        </div>
        <Field label="Note" hint="only you see it"><Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UPI ref 4821, paid to Rohit" /></Field>
        <p className="rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm text-text">New end date: <b>{fmtDate(newEnd.toISOString())}</b> <span className="text-xs text-text-secondary">({months} month{months === 1 ? '' : 's'} {running ? 'added after the current end date' : 'from today'})</span></p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------- history, notes, promise, phone --- */
function HistoryModal({ row, onClose }: { row: CollectionRow; onClose: () => void }) {
  const { toast } = useUi();
  const { data = [], isLoading } = useFollowups(row.id);
  const { log, setPhone } = useCollectionActions();
  const [action, setAction] = useState<'call' | 'note'>('call');
  const [note, setNote] = useState('');
  const [promise, setPromise] = useState('');
  const [phone, setPhoneText] = useState(row.phone);
  const add = () => {
    if (!note.trim() && !promise) { toast('Write a note or choose a promised date.', 'error'); return; }
    log.mutate({ tenantId: row.id, action, note: note.trim(), promiseDate: promise || null }, { onSuccess: () => { setNote(''); setPromise(''); toast('Saved.'); }, onError: (e) => toast(e.message, 'error') });
  };
  const savePhone = () => setPhone.mutate({ tenantId: row.id, phone }, { onSuccess: () => toast('Number saved.'), onError: (e) => toast(e.message, 'error') });
  const LABEL = { email: 'Email reminder', whatsapp: 'WhatsApp', copy: 'Text copied', call: 'Call', note: 'Note', collected: 'Payment received' } as const;
  return (
    <Modal title={row.name} eyebrow="Follow-up history" onClose={onClose} width="max-w-lg">
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="font-semibold text-text">WhatsApp number</h3>
          <div className="flex gap-2"><Input inputMode="tel" placeholder="e.g. 9876543210" value={phone} onChange={(e) => setPhoneText(e.target.value)} /><Button variant="outline" onClick={savePhone} disabled={setPhone.isPending}>Save</Button></div>
        </section>
        <section className="space-y-3">
          <h3 className="font-semibold text-text">Add a call or note</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type"><Select value={action} onChange={(e) => setAction(e.target.value as 'call' | 'note')}><option value="call">I called them</option><option value="note">Just a note</option></Select></Field>
            <Field label="They promised to pay on" hint="optional"><Input type="date" value={promise} min={todayISO()} onChange={(e) => setPromise(e.target.value)} /></Field>
          </div>
          <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Said they will pay after the weekend" />
          <Button variant="gold" onClick={add} disabled={log.isPending}>{log.isPending ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />} Save</Button>
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold text-text">Timeline</h3>
          {isLoading ? <Spinner label="Loading" /> : data.length === 0 ? <p className="text-sm text-text-secondary">Nothing yet. Reminders you send and calls you log show up here.</p> : (
            <ul className="divide-y divide-border/60 rounded-xl border border-border">
              {data.map((f) => (
                <li key={f.id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="font-medium text-text">{LABEL[f.action]}</span><span className="text-xs text-text-secondary">{fmtDateTime(f.at)}</span></div>
                  {f.note && <p className="text-xs text-text-secondary">{f.note}</p>}
                  {f.promiseDate && <p className="text-xs text-gold">Promised to pay on {fmtDate(f.promiseDate)}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- bulk reminders --- */
function BulkModal({ rows, onClose, onDone }: { rows: CollectionRow[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useUi();
  const { sendEmails, log } = useCollectionActions();
  const [note, setNote] = useState('');
  const withEmail = rows.filter((r) => r.ownerEmail);
  const noEmail = rows.filter((r) => !r.ownerEmail);
  const send = () => sendEmails.mutate({ tenantIds: withEmail.map((r) => r.id), note }, {
    onSuccess: (res) => { toast(`${res.sent} reminder${res.sent === 1 ? '' : 's'} sent${res.failed ? `, ${res.failed} failed` : ''}.`, res.failed ? 'error' : 'success'); if (res.sent) { onDone(); onClose(); } },
    onError: (e) => toast(e.message, 'error'),
  });
  const copyAll = async () => {
    const text = rows.map((r) => `${r.name}${r.phone ? ` (${r.phone})` : ''}\n${reminderText(r)}`).join('\n\n');
    try { await navigator.clipboard.writeText(text); rows.forEach((r) => log.mutate({ tenantId: r.id, action: 'copy', note: 'Message copied (bulk)', promiseDate: null })); toast(`${rows.length} messages copied.`); } catch { toast('Could not copy. Use the single copy buttons instead.', 'error'); }
  };
  return (
    <Modal title={`Remind ${rows.length} business${rows.length === 1 ? '' : 'es'}`} eyebrow="Send reminders" onClose={onClose} width="max-w-lg"
      footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void copyAll()}><Copy size={15} /> Copy all messages</Button><Button variant="gold" onClick={send} disabled={sendEmails.isPending || withEmail.length === 0}>{sendEmails.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Email {withEmail.length}</Button></div>}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">Each owner gets an email that fits their situation (ended, ending soon, or trial over) with a button to pay. The amount and dates are filled in for you.</p>
        <Field label="Extra line to add" hint="optional"><Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reply to this email if you need an invoice." /></Field>
        {noEmail.length > 0 && <p className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">No owner email for: {noEmail.map((r) => r.name).join(', ')}. They will be skipped. Use WhatsApp for them.</p>}
        <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border text-sm">
          {rows.map((r) => <li key={r.id} className="flex justify-between gap-3 px-4 py-2"><span className="truncate text-text">{r.name}</span><span className="shrink-0 tabular text-text-secondary">{r.amountDue > 0 ? inr(r.amountDue) : '—'}</span></li>)}
        </ul>
      </div>
    </Modal>
  );
}
