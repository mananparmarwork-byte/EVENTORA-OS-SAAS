import { useMemo } from 'react';
import { useSubscriptionOverview } from '@/lib/api';
import { usePlatformLedger, useTenantMeta } from '@/lib/apiExt';
import { fmtDate, inr } from '@/lib/format';
import type { Plan, PlatformPayment, SubRow } from '@/lib/types';

/* ---- simple client statuses (replaces the old autopay-era ones) ---- */
export type ClientStatus = 'overdue' | 'due_soon' | 'active' | 'trial' | 'trial_ended' | 'free';
type Tone = 'success' | 'gold' | 'warning' | 'error' | 'info' | 'neutral';
export const STATUS_META: Record<ClientStatus, { label: string; tone: Tone; help: string }> = {
  overdue: { label: 'Overdue', tone: 'error', help: 'They paid before, but the plan has ended. Time to collect.' },
  due_soon: { label: 'Due soon', tone: 'warning', help: 'The plan ends within 7 days.' },
  active: { label: 'Active', tone: 'success', help: 'Plan is running.' },
  trial: { label: 'On trial', tone: 'gold', help: 'Trying the software for free.' },
  trial_ended: { label: 'Trial ended', tone: 'neutral', help: 'The free trial is over and they have not paid yet.' },
  free: { label: 'Free access', tone: 'info', help: 'You gave them access without payment.' },
};
export const STATUS_ORDER: ClientStatus[] = ['overdue', 'due_soon', 'active', 'trial', 'trial_ended', 'free'];

export function clientStatus(r: SubRow): ClientStatus {
  const dl = r.daysLeft;
  if (r.state === 'free_access') return 'free';
  if (r.state === 'trial') return 'trial';
  if (r.state === 'trial_ended' || r.state === 'no_plan') return 'trial_ended';
  if (r.state === 'lapsed' || r.state === 'past_due') return 'overdue';
  if (dl != null && dl < 0) return 'overdue';
  if (dl != null && dl <= 7) return 'due_soon';
  return 'active';
}

export type ClientRow = SubRow & { phone: string; businessType: string; branches: number; branchLimit: number; bucket: ClientStatus };

/** Every business with its status and its mobile number: the one list the whole Super admin works from. */
export function useClients() {
  const subs = useSubscriptionOverview();
  const metas = useTenantMeta();
  const rows = useMemo<ClientRow[]>(() => (subs.data ?? []).map((r) => {
    const m = metas.data?.find((x) => x.id === r.id);
    return { ...r, phone: m?.phone ?? '', businessType: m?.businessType ?? '', branches: m?.branches ?? 1, branchLimit: m?.branchLimit ?? 1, bucket: clientStatus(r) };
  }), [subs.data, metas.data]);
  return { rows, isLoading: subs.isLoading, error: subs.error as Error | null, refetch: () => { void subs.refetch(); void metas.refetch(); }, isFetching: subs.isFetching };
}

export function useLedger() {
  const q = usePlatformLedger();
  return { ...q, ledger: q.data ?? [] };
}

/* ---- dates (everything is shown in Indian time) ---- */
export const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const istMonth = (iso: string) => istDay(iso).slice(0, 7);
export const thisMonthKey = () => istMonth(new Date().toISOString());
export const monthLabel = (key: string) => new Date(`${key}-15T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addMonthsTo = (n: number, base = new Date()) => { const x = new Date(base); x.setMonth(x.getMonth() + n); return x; };

/** What to ask from a client: the price of their plan, or else what they paid last time. */
export function amountDue(r: SubRow, plans: Plan[], ledger: PlatformPayment[]): number {
  const plan = plans.find((p) => p.period === r.period);
  if (plan && plan.price > 0) return plan.price;
  return ledger.find((p) => p.tenantId === r.id && p.period !== 'extra-branch')?.amount ?? 0;
}

export const daysLine = (r: { daysLeft: number | null }) =>
  r.daysLeft == null ? '—' : r.daysLeft > 3650 ? 'No expiry' : r.daysLeft >= 1 ? `${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left` : r.daysLeft === 0 ? 'Ends today' : `Ended ${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} ago`;

/* ---- ready-made WhatsApp texts ---- */
export type PayInfo = { upi?: string; payee?: string };
export function reminderMessage(r: Pick<ClientRow, 'name' | 'endsAt' | 'daysLeft' | 'bucket'>, cfg: PayInfo, amount: number) {
  const when = r.endsAt ? fmtDate(r.endsAt) : '';
  const trial = r.bucket === 'trial' || r.bucket === 'trial_ended';
  const ended = r.daysLeft != null && r.daysLeft < 0;
  return [
    `Hello ${r.name},`,
    trial ? (ended ? `Your Eventora OS free trial ended on ${when}.` : `Your Eventora OS free trial ends on ${when}.`) : (ended ? `Your Eventora OS plan ended on ${when}.` : `Your Eventora OS plan ends on ${when}.`),
    amount > 0 ? `Amount: ${inr(amount)}.` : '',
    cfg.upi ? `Pay by UPI: ${cfg.upi}${cfg.payee ? ` (${cfg.payee})` : ''}` : '',
    'After paying, open Billing in Eventora OS, press "Request renewal" and enter the payment reference. Thank you!',
  ].filter(Boolean).join('\n');
}
export function receiptText(p: { business: string; amount: number; paidAt: string; planName?: string | null; method?: string; reference?: string; until?: string | null }) {
  return [
    'Payment received - Eventora OS', `Business: ${p.business}`, `Amount: ${inr(p.amount)}`, `Date: ${fmtDate(p.paidAt)}`,
    p.planName ? `For: ${p.planName}` : '', p.method ? `Paid by: ${p.method}` : '', p.reference ? `Reference: ${p.reference}` : '', p.until ? `Access until: ${fmtDate(p.until)}` : '', 'Thank you!',
  ].filter(Boolean).join('\n');
}

export function downloadCsv(filename: string, head: string[], rows: unknown[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([[head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
