import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Banknote, CalendarClock, Check, Clock, Copy, Download, History, Mail, MessageCircle, Phone, RefreshCw, Search, Send, StickyNote, Wallet } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, useUi } from '@/components/ui';
import { useCollected, useCollectionActions, useCollections, useFollowups, usePlans } from '@/lib/api';
import { cn, fmtDate, fmtDateTime, inr, num, todayISO } from '@/lib/format';
import { daysText, STATE } from '@/pages/admin/PlatformDashboard';
import type { CollectBucket, CollectedPayment, CollectionRow, FollowUpAction } from '@/lib/types';

type Seg = 'pending' | 'due7' | 'upcoming' | 'autopay' | 'collected' | 'all';
type OrderKey = 'days' | 'amount' | 'plan' | 'name' | 'lastPaid' | 'reminders' | 'promise';
type GroupKey = 'none' | 'plan' | 'status' | 'period';
type CollOrder = 'newest' | 'oldest' | 'amount' | 'name' | 'plan';
type Chip = 'this' | 'last' | 'last30' | 'all' | 'custom';

const BUCKET_LABEL: Record<CollectBucket, string> = { overdue: 'Pending (overdue)', due_soon: 'Due in 7 days', upcoming: 'Upcoming (8–30 days)', autopay: 'Autopay due (older accounts)', later: 'Later (31+ days)', none: 'No due date' };
const BUCKET_ORDER: CollectBucket[] = ['overdue', 'due_soon', 'upcoming', 'autopay', 'later', 'none'];
const METHODS = ['UPI', 'Cash', 'Bank transfer', 'Cheque', 'Other'];
const ACTION_LABEL: Record<FollowUpAction, string> = { email: 'E-mail reminder sent', whatsapp: 'WhatsApp reminder opened', copy: 'Reminder text copied', call: 'Phone call', note: 'Note', collected: 'Payment collected' };

/* ----------------------------------------------------------------------- helpers --- */
const sum = (rows: { amountDue: number }[]) => rows.reduce((a, r) => a + (r.amountDue || 0), 0);
const stamp = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** Adds months the way the database does (31 Jan + 1 month = 28/29 Feb). */
function addMonths(d: Date, months: number) {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}

function reminderText(r: CollectionRow): string {
  const link = `${window.location.origin}${window.location.pathname}#/admin/billing`;
  const amount = `₹${num(r.amountDue)}`;
  const plan = r.planName ?? 'Eventora';
  if (r.bucket === 'overdue' && r.state === 'trial_ended') return `Hello ${r.name}, your Eventora OS free trial has ended. To continue using it, please renew the ${plan} plan (${amount}). Pay here: ${link}`;
  if (r.bucket === 'overdue') return `Hello ${r.name}, your Eventora OS payment of ${amount} for the ${plan} plan is pending (your plan ended on ${fmtDate(r.endsAt ?? '')}). Please pay to continue: ${link}`;
  const d = Math.max(0, r.daysLeft ?? 0);
  return `Hello ${r.name}, your Eventora OS plan ends in ${d} day${d === 1 ? '' : 's'} (on ${fmtDate(r.endsAt ?? '')}). To renew the ${plan} plan, please pay ${amount}. Pay here: ${link}`;
}

function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function compare(a: CollectionRow, b: CollectionRow, key: OrderKey): number {
  const big = Number.MAX_SAFE_INTEGER;
  switch (key) {
    case 'days': return (a.daysLeft ?? big) - (b.daysLeft ?? big);
    case 'amount': return a.amountDue - b.amountDue;
    case 'plan': return (a.planName ?? '').localeCompare(b.planName ?? '');
    case 'name': return a.name.localeCompare(b.name);
    case 'lastPaid': return stamp(a.lastPaymentAt) - stamp(b.lastPaymentAt);
    case 'reminders': return a.reminders - b.reminders;
    case 'promise': return (a.promiseDate ? new Date(a.promiseDate).getTime() : big) - (b.promiseDate ? new Date(b.promiseDate).getTime() : big);
  }
}

/* ------------------------------------------------------------------------- main --- */
export function CollectionsTab() {
  const { data: rows = [], isLoading, error, refetch, isFetching } = useCollections();
  const { toast, confirm } = useUi();
  const actions = useCollectionActions();

  const [seg, setSeg] = useState<Seg>('pending');
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [order, setOrder] = useState<OrderKey>('days');
  const [desc, setDesc] = useState(false);
  const [group, setGroup] = useState<GroupKey>('none');
  const [collOrder, setCollOrder] = useState<CollOrder>('newest');
  const [chip, setChip] = useState<Chip>('this');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collectRow, setCollectRow] = useState<CollectionRow | null>(null);
  const [historyRow, setHistoryRow] = useState<CollectionRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // date ranges are memoized so the React Query keys stay the same between renders
  const month = useMemo(() => { const n = new Date(); return { from: new Date(n.getFullYear(), n.getMonth(), 1).toISOString(), to: new Date(n.getFullYear(), n.getMonth() + 1, 1).toISOString() }; }, []);
  const range = useMemo(() => {
    const n = new Date();
    const y = n.getFullYear(), m = n.getMonth();
    if (chip === 'this') return { from: month.from, to: month.to };
    if (chip === 'last') return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
    if (chip === 'last30') return { from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: null as string | null };
    if (chip === 'all') return { from: null as string | null, to: null as string | null };
    return {
      from: customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : null,
      to: customTo ? new Date(new Date(`${customTo}T00:00:00`).getTime() + 86_400_000).toISOString() : null,
    };
  }, [chip, customFrom, customTo, month]);

  const monthPayments = useCollected(month.from, month.to);
  const collectedQ = useCollected(range.from, range.to, seg === 'collected');

  const buckets = useMemo(() => {
    const by = (b: CollectBucket) => rows.filter((r) => r.bucket === b);
    return { overdue: by('overdue'), due_soon: by('due_soon'), upcoming: by('upcoming'), autopay: by('autopay') };
  }, [rows]);
  const monthTotal = (monthPayments.data ?? []).reduce((a, p) => a + p.amount, 0);

  const planNames = useMemo(() => Array.from(new Set(rows.map((r) => r.planName).filter((x): x is string => !!x))).sort(), [rows]);
  const q = search.trim().toLowerCase();
  const matches = (name: string, email: string | null, phone: string) => !q || name.toLowerCase().includes(q) || (email ?? '').toLowerCase().includes(q) || phone.includes(q.replace(/\s/g, ''));

  const shown = useMemo(() => {
    const base = seg === 'pending' ? buckets.overdue : seg === 'due7' ? buckets.due_soon : seg === 'upcoming' ? buckets.upcoming : seg === 'autopay' ? buckets.autopay : rows;
    const list = base.filter((r) => (!planFilter || r.planName === planFilter) && matches(r.name, r.ownerEmail, r.phone));
    return [...list].sort((a, b) => (desc ? -1 : 1) * compare(a, b, order) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg, buckets, rows, planFilter, q, order, desc]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: '', label: '', rows: shown }];
    const keyOf = (r: CollectionRow) => (group === 'plan' ? r.planName ?? 'No plan' : group === 'status' ? STATE[r.state].label : BUCKET_LABEL[r.bucket]);
    const map = new Map<string, CollectionRow[]>();
    for (const r of shown) { const k = keyOf(r); map.set(k, [...(map.get(k) ?? []), r]); }
    const out = Array.from(map, ([label, rs]) => ({ key: label, label, rows: rs }));
    if (group === 'period') out.sort((a, b) => BUCKET_ORDER.findIndex((x) => BUCKET_LABEL[x] === a.label) - BUCKET_ORDER.findIndex((x) => BUCKET_LABEL[x] === b.label));
    return out;
  }, [shown, group]);

  const collectedShown = useMemo(() => {
    const list = (collectedQ.data ?? []).filter((p) => (!planFilter || p.planName === planFilter) && matches(p.tenant, p.ownerEmail, ''));
    const sorted = [...list];
    if (collOrder === 'newest') sorted.sort((a, b) => stamp(b.paidAt) - stamp(a.paidAt));
    if (collOrder === 'oldest') sorted.sort((a, b) => stamp(a.paidAt) - stamp(b.paidAt));
    if (collOrder === 'amount') sorted.sort((a, b) => b.amount - a.amount);
    if (collOrder === 'name') sorted.sort((a, b) => a.tenant.localeCompare(b.tenant));
    if (collOrder === 'plan') sorted.sort((a, b) => (a.planName ?? '').localeCompare(b.planName ?? '') || stamp(b.paidAt) - stamp(a.paidAt));
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectedQ.data, planFilter, q, collOrder]);

  const pickedRows = shown.filter((r) => selected.has(r.id));
  const allTicked = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const go = (s: Seg) => { setSeg(s); setSelected(new Set()); setPlanFilter(''); };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /* ---- row actions ---- */
  async function emailOne(r: CollectionRow) {
    if (!r.ownerEmail) { toast('This business has no owner e-mail. Use WhatsApp or Copy instead.', 'error'); return; }
    const ok = await confirm({ title: 'Send e-mail reminder?', text: `${r.name} (${r.ownerEmail}) will get a payment reminder for ₹${num(r.amountDue)}.`, confirmLabel: 'Send e-mail' });
    if (!ok) return;
    try {
      const res = await actions.sendEmails.mutateAsync({ tenantIds: [r.id], note: '' });
      if (res.sent) toast(`Reminder e-mailed to ${r.name}.`); else toast(res.errors[0] ?? 'The e-mail could not be sent.', 'error');
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function whatsappOne(r: CollectionRow) {
    const number = whatsappNumber(r.phone);
    const url = number ? `https://wa.me/${number}?text=${encodeURIComponent(reminderText(r))}` : `https://wa.me/?text=${encodeURIComponent(reminderText(r))}`;
    window.open(url, '_blank', 'noopener');
    if (!number) toast('No WhatsApp number saved for this business. Pick a contact in WhatsApp, or open History to save the number.', 'info');
    try { await actions.log.mutateAsync({ tenantId: r.id, action: 'whatsapp' }); } catch { /* the message was still opened */ }
  }
  async function copyOne(r: CollectionRow) {
    try { await navigator.clipboard.writeText(reminderText(r)); } catch { toast('Could not copy. Your browser blocked the clipboard.', 'error'); return; }
    toast('Reminder text copied.');
    try { await actions.log.mutateAsync({ tenantId: r.id, action: 'copy' }); } catch { /* ignore */ }
  }

  /* ---- Excel export (CSV with BOM) ---- */
  function exportView() {
    if (seg === 'collected') {
      const data = collectedShown;
      if (data.length === 0) { toast('Nothing to export.', 'info'); return; }
      downloadCsv(`eventora-collected-${todayISO()}.csv`, [['Date', 'Business', 'Owner e-mail', 'Plan', 'Received via', 'Type', 'Note', 'Amount (Rs)'],
        ...data.map((p) => [fmtDate(p.paidAt), p.tenant, p.ownerEmail, p.planName, p.offline ? p.method : 'Online', p.renewal ? 'Renewal' : 'First payment', p.note, p.amount])]);
      return;
    }
    const data = pickedRows.length ? pickedRows : shown;
    if (data.length === 0) { toast('Nothing to export.', 'info'); return; }
    downloadCsv(`eventora-collections-${seg}-${todayISO()}.csv`, [['Business', 'Owner e-mail', 'Phone', 'Plan', 'Amount due (Rs)', 'Ends on', 'Days left', 'Status', 'Last paid on', 'Last paid (Rs)', 'Reminders sent', 'Promised to pay on', 'Note'],
      ...data.map((r) => [r.name, r.ownerEmail, r.phone, r.planName, r.amountDue, fmtDate(r.endsAt ?? ''), r.daysLeft, STATE[r.state].label, fmtDate(r.lastPaymentAt ?? ''), r.lastAmount, r.reminders, fmtDate(r.promiseDate ?? ''), r.note])]);
  }

  /* ---- render ---- */
  if (isLoading) return <Spinner label="Loading collections" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;

  const tabs: { id: Seg; label: string; count: number }[] = [
    { id: 'pending', label: 'Pending', count: buckets.overdue.length }, { id: 'due7', label: 'Due in 7 days', count: buckets.due_soon.length },
    { id: 'upcoming', label: 'Upcoming (8–30 days)', count: buckets.upcoming.length }, { id: 'autopay', label: 'Autopay due', count: buckets.autopay.length },
    { id: 'collected', label: 'Collected', count: (monthPayments.data ?? []).length }, { id: 'all', label: 'All customers', count: rows.length },
  ];
  const orders: [OrderKey, string][] = [['days', 'Days left'], ['amount', 'Amount'], ['plan', 'Plan'], ['name', 'Business name'], ['lastPaid', 'Last payment date'], ['reminders', 'Reminders sent'], ['promise', 'Promised date']];
  const collOrders: [CollOrder, string][] = [['newest', 'Newest'], ['oldest', 'Oldest'], ['amount', 'Highest amount'], ['name', 'Business A–Z'], ['plan', 'By plan']];
  const chips: [Chip, string][] = [['this', 'This month'], ['last', 'Last month'], ['last30', 'Last 30 days'], ['all', 'All time'], ['custom', 'Custom dates']];
  const colSpan = 9;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Collections</h1>
          <p className="text-sm text-text-secondary">Who has to pay you, when, and what you have collected. Payments you record with Collect appear here.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportView}><Download size={15} /> Export for Excel</Button>
          <Button onClick={() => { void refetch(); void monthPayments.refetch(); }} loading={isFetching}><RefreshCw size={15} /> Refresh</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Pending to collect" value={inr(sum(buckets.overdue))} sub={`${buckets.overdue.length} business${buckets.overdue.length === 1 ? '' : 'es'} overdue`} tone="error" icon={<AlertTriangle size={16} />} onClick={() => go('pending')} />
        <Kpi label="Due in next 7 days" value={inr(sum(buckets.due_soon))} sub={`${buckets.due_soon.length} business${buckets.due_soon.length === 1 ? '' : 'es'}`} tone="warning" icon={<Clock size={16} />} onClick={() => go('due7')} />
        <Kpi label="Upcoming 8–30 days" value={inr(sum(buckets.upcoming))} sub={`${buckets.upcoming.length} business${buckets.upcoming.length === 1 ? '' : 'es'} · autopay ${inr(sum(buckets.autopay))} (${buckets.autopay.length})`} icon={<CalendarClock size={16} />} onClick={() => go('upcoming')} />
        <Kpi label="Collected this month" value={inr(monthTotal)} sub={`${(monthPayments.data ?? []).length} payment${(monthPayments.data ?? []).length === 1 ? '' : 's'}`} tone="success" icon={<Wallet size={16} />} onClick={() => go('collected')} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-surface p-1.5">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => go(t.id)} className={cn('flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors', seg === t.id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>
            {t.label}<span className={cn('rounded-full px-1.5 text-[11px] font-bold', seg === t.id ? 'bg-white/25' : 'bg-surface-hover')}>{t.count}</span>
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, e-mail or phone" className="pl-9" aria-label="Search" />
          </div>
          <Select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="w-44" aria-label="Plan filter">
            <option value="">All plans</option>
            {planNames.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          {seg !== 'collected' ? (
            <>
              <label className="flex items-center gap-2 text-xs text-text-secondary">Order by
                <Select value={order} onChange={(e) => setOrder(e.target.value as OrderKey)} className="w-44">{orders.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              </label>
              <Button onClick={() => setDesc((d) => !d)} className="h-11"><ArrowDownUp size={15} /> {desc ? 'High → Low' : 'Low → High'}</Button>
              <label className="flex items-center gap-2 text-xs text-text-secondary">Group by
                <Select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="w-40">
                  <option value="none">No grouping</option><option value="plan">Plan</option><option value="status">Status</option><option value="period">Due period</option>
                </Select>
              </label>
            </>
          ) : (
            <label className="flex items-center gap-2 text-xs text-text-secondary">Order by
              <Select value={collOrder} onChange={(e) => setCollOrder(e.target.value as CollOrder)} className="w-44">{collOrders.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            </label>
          )}
        </div>
      </Card>

      {pickedRows.length > 0 && seg !== 'collected' && (
        <div className="sticky top-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-surface px-4 py-3 shadow-lg">
          <p className="text-sm font-medium text-text">{pickedRows.length} selected · total {inr(sum(pickedRows))}</p>
          <div className="flex gap-2">
            <Button variant="gold" onClick={() => setBulkOpen(true)}><Send size={15} /> Send reminders</Button>
            <Button onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {seg === 'collected' ? (
        <CollectedView chip={chip} chips={chips} setChip={setChip} customFrom={customFrom} customTo={customTo} setCustomFrom={setCustomFrom} setCustomTo={setCustomTo}
          loading={collectedQ.isLoading} error={collectedQ.error as Error | null} data={collectedShown} />
      ) : shown.length === 0 ? (
        <Card><EmptyState icon={<Check size={20} />} title="Nothing here" text={seg === 'pending' ? 'No business has a pending payment.' : 'No businesses match this view.'} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-surface-hover text-xs text-text-secondary">
                <tr>
                  <th className="w-10 px-3 py-3"><input type="checkbox" aria-label="Select all shown" checked={allTicked} onChange={() => setSelected(allTicked ? new Set() : new Set(shown.map((r) => r.id)))} className="size-4 accent-[#3478F6]" /></th>
                  <th className="px-3 py-3 font-medium">Business</th><th className="px-3 py-3 font-medium">Plan</th><th className="px-3 py-3 text-right font-medium">Amount</th>
                  <th className="px-3 py-3 font-medium">Ends</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Last paid</th>
                  <th className="px-3 py-3 font-medium">Reminders</th><th className="px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {groups.map((g) => (
                  <GroupRows key={g.key || 'all'} label={g.label} rows={g.rows} colSpan={colSpan} showHeader={group !== 'none'}>
                    {(r) => {
                      const st = STATE[r.state];
                      const missed = r.promiseDate && (r.bucket === 'overdue' || r.bucket === 'due_soon') && r.promiseDate < todayISO();
                      const late = r.bucket === 'overdue' || (r.daysLeft != null && r.daysLeft < 0);
                      return (
                        <tr key={r.id} className={cn('align-top hover:bg-surface-hover/60', selected.has(r.id) && 'bg-gold/5')}>
                          <td className="px-3 py-3"><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-[#3478F6]" /></td>
                          <td className="max-w-[260px] px-3 py-3">
                            <p className="truncate font-medium text-text">{r.name}</p>
                            <p className="truncate text-xs text-text-secondary">{r.ownerEmail ?? 'No owner e-mail'}</p>
                            {r.phone && <p className="text-xs text-text-disabled">{r.phone}</p>}
                            {r.promiseDate && <p className={cn('mt-0.5 text-xs font-medium', missed ? 'text-error' : 'text-info')}>{missed ? 'Promise missed' : 'Promised to pay'}: {fmtDate(r.promiseDate)}</p>}
                            {r.note && <p className="mt-0.5 line-clamp-2 text-xs italic text-text-disabled">{r.note}</p>}
                          </td>
                          <td className="px-3 py-3 text-text">{r.planName ?? '—'}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular text-text">{r.amountDue > 0 ? inr(r.amountDue) : '—'}</td>
                          <td className="px-3 py-3"><p className="text-text">{r.endsAt ? fmtDate(r.endsAt) : '—'}</p><p className={cn('text-xs', late ? 'font-medium text-error' : r.daysLeft != null && r.daysLeft <= 7 ? 'font-medium text-warning' : 'text-text-secondary')}>{daysText(r)}</p></td>
                          <td className="px-3 py-3"><Badge tone={st.tone}>{st.short}</Badge></td>
                          <td className="px-3 py-3">{r.lastPaymentAt ? <><p className="text-text">{fmtDate(r.lastPaymentAt)}</p><p className="text-xs text-text-secondary">{r.lastAmount != null ? inr(r.lastAmount) : ''}</p></> : <span className="text-text-disabled">Never</span>}</td>
                          <td className="px-3 py-3"><p className="tabular text-text">{r.reminders}</p>{r.lastReminderAt && <p className="text-xs text-text-secondary">{fmtDate(r.lastReminderAt)}</p>}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <IconBtn label={`E-mail reminder to ${r.name}`} onClick={() => void emailOne(r)} disabled={actions.sendEmails.isPending}><Mail size={15} /></IconBtn>
                              <IconBtn label={`WhatsApp reminder to ${r.name}`} onClick={() => void whatsappOne(r)}><MessageCircle size={15} /></IconBtn>
                              <IconBtn label={`Copy reminder text for ${r.name}`} onClick={() => void copyOne(r)}><Copy size={15} /></IconBtn>
                              <IconBtn label={`History of ${r.name}`} onClick={() => setHistoryRow(r)}><History size={15} /></IconBtn>
                              <Button variant="gold" size="sm" onClick={() => setCollectRow(r)}><Banknote size={14} /> Collect</Button>
                            </div>
                          </td>
                        </tr>
                      );
                    }}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {collectRow && <CollectModal row={collectRow} onClose={() => setCollectRow(null)} />}
      {historyRow && <HistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />}
      {bulkOpen && <BulkModal rows={pickedRows} onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); setSelected(new Set()); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ small pieces --- */
function Kpi({ label, value, sub, tone, icon, onClick }: { label: string; value: string; sub: string; tone?: 'error' | 'warning' | 'success'; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="lift rounded-2xl border border-border bg-surface p-5 text-left card-glow">
      <div className="flex items-center justify-between text-xs text-text-secondary"><span>{label}</span><span className={cn(tone === 'error' && 'text-error', tone === 'warning' && 'text-warning', tone === 'success' && 'text-success')}>{icon}</span></div>
      <p className={cn('mt-1 text-2xl font-semibold tabular text-text', tone === 'error' && 'text-error', tone === 'success' && 'text-success')}>{value}</p>
      <p className="mt-1 text-[11px] text-text-disabled">{sub}</p>
    </button>
  );
}
function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-text-secondary transition-colors hover:border-gold hover:text-gold disabled:opacity-50">{children}</button>;
}
function GroupRows({ label, rows, colSpan, showHeader, children }: { label: string; rows: CollectionRow[]; colSpan: number; showHeader: boolean; children: (r: CollectionRow) => React.ReactNode }) {
  return (
    <>
      {showHeader && <tr className="bg-surface-hover/70"><td colSpan={colSpan} className="px-3 py-2 text-xs font-semibold text-text"><span>{label}</span><span className="ml-3 font-normal text-text-secondary">{rows.length} business{rows.length === 1 ? '' : 'es'} · subtotal {inr(sum(rows))}</span></td></tr>}
      {rows.map((r) => children(r))}
    </>
  );
}

/* ---------------------------------------------------------------- collected view --- */
function CollectedView({ chip, chips, setChip, customFrom, customTo, setCustomFrom, setCustomTo, loading, error, data }: {
  chip: Chip; chips: [Chip, string][]; setChip: (c: Chip) => void; customFrom: string; customTo: string; setCustomFrom: (v: string) => void; setCustomTo: (v: string) => void;
  loading: boolean; error: Error | null; data: CollectedPayment[];
}) {
  const total = data.reduce((a, p) => a + p.amount, 0);
  const recorded = data.filter((p) => p.offline).reduce((a, p) => a + p.amount, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map(([id, label]) => <button key={id} type="button" onClick={() => setChip(id)} className={cn('rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors', chip === id ? 'border-gold bg-gold/10 text-gold' : 'border-border text-text-secondary hover:text-text')}>{label}</button>)}
        {chip === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" value={customFrom} max={customTo || todayISO()} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-40" aria-label="From date" />
            <span className="text-xs text-text-secondary">to</span>
            <Input type="date" value={customTo} min={customFrom || undefined} max={todayISO()} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-40" aria-label="To date" />
          </div>
        )}
      </div>
      {loading ? <Spinner label="Loading payments" /> : error ? <Card className="p-8 text-center text-sm text-error">{error.message}</Card> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4"><p className="text-xs text-text-secondary">Collected</p><p className="mt-1 text-xl font-semibold tabular text-success">{inr(total)}</p></Card>
            <Card className="p-4"><p className="text-xs text-text-secondary">Payments</p><p className="mt-1 text-xl font-semibold tabular text-text">{data.length}</p></Card>
            <Card className="p-4"><p className="text-xs text-text-secondary">Online {inr(total - recorded)} · Recorded by you {inr(recorded)}</p><p className="mt-1 text-xs text-text-disabled">Paid to you: Cash, UPI or bank transfer</p></Card>
          </div>
          {data.length === 0 ? <Card><EmptyState icon={<Wallet size={20} />} title="No payments in this period" text="Payments you record with Collect appear here." /></Card> : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-surface-hover text-xs text-text-secondary"><tr>
                    <th className="px-3 py-3 font-medium">Date</th><th className="px-3 py-3 font-medium">Business</th><th className="px-3 py-3 font-medium">Plan</th>
                    <th className="px-3 py-3 font-medium">Received via</th><th className="px-3 py-3 font-medium">Type</th><th className="px-3 py-3 font-medium">Note</th><th className="px-3 py-3 text-right font-medium">Amount</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/70">
                    {data.map((p) => (
                      <tr key={p.id} className="hover:bg-surface-hover/60">
                        <td className="whitespace-nowrap px-3 py-3 text-text">{fmtDate(p.paidAt)}</td>
                        <td className="px-3 py-3"><p className="font-medium text-text">{p.tenant}</p><p className="text-xs text-text-secondary">{p.ownerEmail ?? ''}</p></td>
                        <td className="px-3 py-3 text-text">{p.planName ?? '—'}</td>
                        <td className="px-3 py-3"><Badge tone={p.offline ? 'gold' : 'neutral'}>{p.offline ? p.method : 'Online'}</Badge></td>
                        <td className="px-3 py-3">{p.renewal ? <Badge tone="success">Renewal</Badge> : <span className="text-xs text-text-disabled">First payment</span>}</td>
                        <td className="max-w-[220px] px-3 py-3 text-xs text-text-secondary">{p.note}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular text-text">{inr(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- Collect --- */
function CollectModal({ row, onClose }: { row: CollectionRow; onClose: () => void }) {
  const { all: plans } = usePlans();
  const { toast } = useUi();
  const { record } = useCollectionActions();
  const choices = plans.filter((p) => p.active || p.period === row.period);
  const [period, setPeriod] = useState(row.period && choices.some((p) => p.period === row.period) ? row.period : choices[0]?.period ?? '');
  const [amount, setAmount] = useState(String(row.amountDue > 0 ? row.amountDue : choices.find((p) => p.period === period)?.price ?? ''));
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState('UPI');
  const [note, setNote] = useState('');
  const plan = plans.find((p) => p.period === period);

  const now = new Date();
  const runs = row.endsAt && new Date(row.endsAt) > now;
  const newEnd = plan ? addMonths(runs ? new Date(row.endsAt as string) : now, plan.months) : null;
  const amountNum = Number(amount);
  const problem = !plan ? 'Choose a plan.' : !(amountNum > 0) ? 'Enter the amount you received.' : paidOn > todayISO() ? 'The received date cannot be in the future.' : '';

  async function save() {
    if (problem) { toast(problem, 'error'); return; }
    try {
      const end = await record.mutateAsync({ tenantId: row.id, period, amountRupees: amountNum, paidOn, method, note: note.trim() });
      toast(`₹${num(amountNum)} recorded. ${row.name} now has access until ${fmtDate(end)}`);
      onClose();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <Modal title={`Collect payment · ${row.name}`} eyebrow="Record a payment you received" onClose={onClose} width="max-w-lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="gold" onClick={() => void save()} loading={record.isPending} disabled={!!problem}>Save payment</Button></>}>
      <div className="space-y-4">
        <Field label="Plan">
          <Select value={period} onChange={(e) => { setPeriod(e.target.value); const p = plans.find((x) => x.period === e.target.value); if (p) setAmount(String(p.price)); }}>
            {choices.map((p) => <option key={p.period} value={p.period}>{p.name} · {inr(p.price)} · {p.months} month{p.months === 1 ? '' : 's'}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount received (Rs)"><Input type="number" inputMode="decimal" min={1} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Received on"><Input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        </div>
        <Field label="Received via"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Private note" hint="Only you see this"><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. UTR number, who paid" className="min-h-20" /></Field>
        {newEnd && (
          <div className="rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm">
            <span className="text-text-secondary">New end date: </span><strong className="text-text">{fmtDate(newEnd.toISOString())}</strong>
            <span className="text-xs text-text-secondary"> ({plan?.months} month{plan?.months === 1 ? '' : 's'} added {runs ? 'after the current end date' : 'from today'})</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- History --- */
function HistoryModal({ row, onClose }: { row: CollectionRow; onClose: () => void }) {
  const { data: items = [], isLoading } = useFollowups(row.id);
  const { toast } = useUi();
  const { log, setPhone } = useCollectionActions();
  const [phone, setPhoneText] = useState(row.phone);
  const [kind, setKind] = useState<'call' | 'note'>('call');
  const [text, setText] = useState('');
  const [promise, setPromise] = useState('');

  async function savePhone() {
    try { await setPhone.mutateAsync({ tenantId: row.id, phone }); toast('WhatsApp number saved.'); } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function add() {
    if (!text.trim() && !promise) { toast('Write a note or choose a promised date.', 'error'); return; }
    try { await log.mutateAsync({ tenantId: row.id, action: kind, note: text.trim(), promiseDate: promise || null }); setText(''); setPromise(''); toast('Added to history.'); } catch (e) { toast((e as Error).message, 'error'); }
  }
  const icon = (a: FollowUpAction) => a === 'email' ? <Mail size={14} /> : a === 'whatsapp' ? <MessageCircle size={14} /> : a === 'copy' ? <Copy size={14} /> : a === 'call' ? <Phone size={14} /> : a === 'collected' ? <Banknote size={14} /> : <StickyNote size={14} />;

  return (
    <Modal title={row.name} eyebrow="Follow-up history" onClose={onClose} width="max-w-xl">
      <div className="space-y-5">
        <div className="flex items-end gap-2">
          <Field label="WhatsApp number" hint="10 digits, or with country code" className="flex-1"><Input value={phone} onChange={(e) => setPhoneText(e.target.value)} inputMode="tel" placeholder="e.g. 9876543210" /></Field>
          <Button onClick={() => void savePhone()} loading={setPhone.isPending} className="h-11">Save</Button>
        </div>
        <div className="space-y-3 rounded-2xl border border-border bg-surface-hover/50 p-4">
          <p className="text-sm font-semibold text-text">Add a call or note</p>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'call' | 'note')}><option value="call">Phone call</option><option value="note">Note</option></Select>
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="What was said?" />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Promised to pay on (optional)" className="w-52"><Input type="date" value={promise} onChange={(e) => setPromise(e.target.value)} /></Field>
            <Button variant="gold" onClick={() => void add()} loading={log.isPending} className="h-11">Add</Button>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-text">Timeline</p>
          {isLoading ? <Spinner label="Loading history" /> : items.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">Nothing yet. Reminders, calls and payments will be listed here.</p> : (
            <ol className="space-y-3">
              {items.map((f) => (
                <li key={f.id} className="flex gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-hover text-gold">{icon(f.action)}</span>
                  <div className="min-w-0 text-sm"><p className="font-medium text-text">{ACTION_LABEL[f.action]}<span className="ml-2 text-xs font-normal text-text-disabled">{fmtDateTime(f.at)}</span></p>
                    {f.note && <p className="text-text-secondary">{f.note}</p>}
                    {f.promiseDate && <p className="text-xs font-medium text-info">Promised to pay on {fmtDate(f.promiseDate)}</p>}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Bulk reminders --- */
function BulkModal({ rows, onClose, onDone }: { rows: CollectionRow[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useUi();
  const { sendEmails, log } = useCollectionActions();
  const [note, setNote] = useState('');
  const withEmail = rows.filter((r) => r.ownerEmail);
  const noEmail = rows.length - withEmail.length;

  async function send() {
    try {
      const res = await sendEmails.mutateAsync({ tenantIds: withEmail.map((r) => r.id), note });
      const parts = [`${res.sent} e-mail${res.sent === 1 ? '' : 's'} sent`];
      if (res.failed) parts.push(`${res.failed} failed`);
      if (res.skipped.length) parts.push(`${res.skipped.length} skipped`);
      toast(parts.join(' · '), res.failed ? 'error' : 'success');
      if (res.errors[0]) toast(res.errors[0], 'error');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function copyAll() {
    const text = rows.map((r) => `${r.name}\n${reminderText(r)}${note.trim() ? `\n${note.trim()}` : ''}`).join('\n\n— — —\n\n');
    try { await navigator.clipboard.writeText(text); } catch { toast('Could not copy. Your browser blocked the clipboard.', 'error'); return; }
    toast(`${rows.length} message${rows.length === 1 ? '' : 's'} copied.`);
    await Promise.allSettled(rows.map((r) => log.mutateAsync({ tenantId: r.id, action: 'copy' })));
  }

  return (
    <Modal title="Send reminders" eyebrow={`${rows.length} business${rows.length === 1 ? '' : 'es'} · ${inr(sum(rows))}`} onClose={onClose} width="max-w-xl"
      footer={<><Button onClick={onClose}>Cancel</Button><Button onClick={() => void copyAll()}><Copy size={15} /> Copy all messages</Button><Button variant="gold" onClick={() => void send()} loading={sendEmails.isPending} disabled={withEmail.length === 0}><Mail size={15} /> Email {withEmail.length}</Button></>}>
      <div className="space-y-4">
        {noEmail > 0 && <p className="flex gap-2 rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{noEmail} business{noEmail === 1 ? ' has' : 'es have'} no owner e-mail and will be skipped. Use Copy all messages or WhatsApp for them.</p>}
        <ul className="max-h-56 divide-y divide-border/70 overflow-y-auto rounded-xl border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0"><p className="truncate font-medium text-text">{r.name}</p><p className="truncate text-xs text-text-secondary">{r.ownerEmail ?? 'No owner e-mail'}</p></div>
              <span className="shrink-0 tabular text-text">{inr(r.amountDue)}</span>
            </li>
          ))}
        </ul>
        <Field label="Extra line (optional)" hint="Added to every e-mail"><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Please pay by Friday to avoid a lock." className="min-h-20" /></Field>
      </div>
    </Modal>
  );
}
