import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, CheckCircle2, Copy, Inbox, KeyRound, Loader2, MessageCircle, Save, Send, Trash2, UserPlus, Wand2, XCircle } from 'lucide-react';
import { ContactButtons, PhoneLink } from '@/components/Contact';
import { PHONE_ERROR, validPhone } from '@/lib/phone';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Switch, Textarea, useUi } from '@/components/ui';
import { usePlans, useSubscriptionOverview } from '@/lib/api';
import { usePlatformConfig, usePlatformExt, usePlatformLeads, usePlatformRequests } from '@/lib/apiExt';
import { PlatformSettingsTab } from '@/pages/admin/PlatformExtra';
import { InvoiceSettingsCard } from '@/pages/admin/PlatformInvoices';
import { cn, fmtDate, inr } from '@/lib/format';
import { whatsappLink } from '@/lib/settings';
import type { Lead, NewOwnerResult, PlatformConfig, PlatformRequest } from '@/lib/types';

const TYPES = ['Banquet hall', 'Party plot', 'Restaurant', 'Hotel', 'Resort', 'Event company', 'Caterer', 'Other'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number, base = new Date()) => { const x = new Date(base); x.setDate(x.getDate() + n); return x; };
const addMonths = (n: number, base = new Date()) => { const x = new Date(base); x.setMonth(x.getMonth() + n); return x; };

/** 12 characters, letters and digits, no look-alike letters (O/0, l/1). Always has at least one letter and one digit. */
export function makePassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789', all = letters + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const out = [pick(letters), pick(digits), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}
const loginUrl = () => `${window.location.origin}${window.location.pathname}#/login`;

/* ------------------------------------------------------------------ Add owner --- */
export function AddOwnerModal({ onClose, prefill }: { onClose: () => void; prefill?: { name?: string; business?: string; phone?: string; email?: string; tenantId?: string } }) {
  const { toast } = useUi();
  const { addOwner } = usePlatformExt();
  const { all: plans } = usePlans();
  const { data: tenants = [] } = useSubscriptionOverview();
  const [mode, setMode] = useState<'new' | 'existing'>(prefill?.tenantId ? 'existing' : 'new');
  const [tenantId, setTenantId] = useState(prefill?.tenantId ?? '');
  const [businessName, setBusinessName] = useState(prefill?.business ?? '');
  const [businessType, setBusinessType] = useState(TYPES[0]);
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  const [password, setPassword] = useState(makePassword);
  const [access, setAccess] = useState<'trial' | 'until'>('until');
  const [period, setPeriod] = useState('');
  const [until, setUntil] = useState(ymd(addDays(30)));
  const [kind, setKind] = useState<'free' | 'paid'>('paid');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<NewOwnerResult | null>(null);

  const plan = plans.find((p) => p.period === period);
  const pickPlan = (p: string) => { setPeriod(p); const pl = plans.find((x) => x.period === p); if (pl) { setUntil(ymd(addMonths(pl.months))); setAmount(String(pl.price)); } };

  const go = () => {
    if (mode === 'existing' && !tenantId) { toast('Choose the business.', 'error'); return; }
    if (mode === 'new' && !validPhone(phone)) { toast(PHONE_ERROR, 'error'); return; }
    if (access === 'until' && mode === 'new' && !until) { toast('Choose the access end date.', 'error'); return; }
    const rupees = access === 'until' && mode === 'new' && kind === 'paid' ? Number(amount) || 0 : 0;
    addOwner.mutate({ email: email.trim(), password, businessName: businessName.trim(), businessType, phone: phone.trim(), period: mode === 'new' && access === 'until' ? period : '', until: mode === 'new' && access === 'until' ? until : '', amountRupees: rupees, note: note.trim(), tenantId: mode === 'existing' ? tenantId : undefined },
      { onSuccess: (r) => setResult(r), onError: (e) => toast(e.message, 'error') });
  };

  const details = () => `Eventora OS login\nBusiness: ${result?.name ?? businessName}\nWebsite: ${loginUrl()}\nEmail: ${email.trim().toLowerCase()}\nPassword: ${password}\n\nPlease change your password after signing in (My account).`;
  const copy = async () => { try { await navigator.clipboard.writeText(details()); toast('Login details copied.'); } catch { toast('Copy is blocked in this browser.', 'error'); } };

  if (result) {
    return (
      <Modal title="Owner added" eyebrow="Done" onClose={onClose} width="max-w-lg" footer={<Button variant="gold" onClick={onClose}>Close</Button>}>
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-bg p-3 text-sm text-success"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {result.existing ? `${email} is now an owner of ${result.name}.` : `${result.name} is ready and ${email} can sign in now.`}{result.linkedExistingLogin ? ' (This email already had a login; its password was set to the one below.)' : ''}</p>
          <pre className="whitespace-pre-wrap rounded-xl border border-border bg-input p-4 text-xs text-text">{details()}</pre>
          <p className="text-xs text-text-secondary">This is the only time the password is shown. Send it to the owner now.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void copy()}><Copy size={14} /> Copy details</Button>
            {phone.trim() && <a href={whatsappLink(phone, details())} target="_blank" rel="noreferrer"><Button variant="outline"><MessageCircle size={14} /> Send on WhatsApp</Button></a>}
            <a href={`mailto:${email.trim()}?subject=${encodeURIComponent('Your Eventora OS login')}&body=${encodeURIComponent(details())}`}><Button variant="ghost">Email it</Button></a>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add owner" eyebrow="Manual access" onClose={onClose} width="max-w-2xl" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="gold" onClick={go} disabled={addOwner.isPending}>{addOwner.isPending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Create owner</Button></>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {([['new', 'New business', 'A new party plot, restaurant or hall with its own data'], ['existing', 'Another owner for a business', 'One more owner login for a business that already exists']] as const).map(([k, t, s]) => (
            <button key={k} type="button" onClick={() => setMode(k)} className={cn('rounded-xl border p-3 text-left transition-colors', mode === k ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/50')}><p className="text-sm font-medium text-text">{t}</p><p className="text-xs text-text-secondary">{s}</p></button>
          ))}
        </div>

        {mode === 'new' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" required><Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Royal Party Plot" maxLength={80} /></Field>
            <Field label="Business type"><Select value={businessType} onChange={(e) => setBusinessType(e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          </div>
        ) : (
          <Field label="Business" required><Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}><option value="">Choose a business</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}{t.ownerEmail ? ` · ${t.ownerEmail}` : ''}</option>)}</Select></Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner email" required hint="this is their login"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" autoComplete="off" /></Field>
          <Field label="Owner mobile" required hint="you will call and WhatsApp on this"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" /></Field>
          <Field label="Password" required hint="10+ characters" className="sm:col-span-2">
            <div className="flex gap-2"><Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" autoComplete="off" /><Button variant="outline" onClick={() => setPassword(makePassword())} aria-label="Generate a password"><Wand2 size={15} /> Generate</Button></div>
          </Field>
        </div>

        {mode === 'new' && (
          <section className="space-y-4 rounded-2xl border border-border p-4">
            <div><h3 className="font-semibold text-text">Access</h3><p className="text-xs text-text-secondary">How long can they use the software?</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {([['until', 'Until a date', 'Free or paid outside the app'], ['trial', 'Free trial', 'Starts the trial length from Settings']] as const).map(([k, t, s]) => (
                <button key={k} type="button" onClick={() => setAccess(k)} className={cn('rounded-xl border p-3 text-left transition-colors', access === k ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/50')}><p className="text-sm font-medium text-text">{t}</p><p className="text-xs text-text-secondary">{s}</p></button>
              ))}
            </div>
            {access === 'until' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Plan" hint="shown to them"><Select value={period} onChange={(e) => pickPlan(e.target.value)}><option value="">No plan name</option>{plans.map((p) => <option key={p.period} value={p.period}>{p.name} · {inr(p.price)}</option>)}</Select></Field>
                  <Field label="Access until" required><Input type="date" value={until} min={ymd(addDays(1))} onChange={(e) => setUntil(e.target.value)} /></Field>
                </div>
                <div className="flex flex-wrap gap-2">{[30, 90, 180, 365].map((n) => <button key={n} type="button" onClick={() => setUntil(ymd(addDays(n)))} className="rounded-full border border-border px-3 py-1 text-xs text-text-secondary hover:text-text">+{n === 365 ? '1 year' : `${n} days`}</button>)}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([['paid', 'They paid me', 'Cash, UPI or bank transfer'], ['free', 'Free access', 'You are giving it free']] as const).map(([k, t, s]) => (
                    <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-xl border p-3 text-left transition-colors', kind === k ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/50')}><p className="text-sm font-medium text-text">{t}</p><p className="text-xs text-text-secondary">{s}</p></button>
                  ))}
                </div>
                {kind === 'paid' && <Field label="Amount received (₹)" hint={plan ? `plan price ${inr(plan.price)}` : 'counted in your revenue'}><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" /></Field>}
              </>
            )}
          </section>
        )}

        <Field label="Private note" hint="only you see it"><Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Met at the wedding expo, 2 halls" /></Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- Requests --- */
const KIND_LABEL = { branch: 'Extra branch', renewal: 'Payment', support: 'Message' } as const;
const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'error', closed: 'neutral' } as const;

function DecideModal({ req, onClose }: { req: PlatformRequest; onClose: () => void }) {
  const { toast } = useUi();
  const { decide } = usePlatformExt();
  const { all: plans } = usePlans();
  const quote = req.payload.quote as { total?: number; lines?: { label: string; amount: number }[]; newEnd?: string; extras?: number; keep?: number } | undefined;
  const renewing = req.kind === 'renewal' && req.payload.renew !== false && req.payload.renew !== 'false';
  const newBranches = (Array.isArray(req.payload.newBranches) ? req.payload.newBranches : []) as { name: string }[];
  const startPeriod = req.payload.period && plans.some((p) => p.period === req.payload.period) ? String(req.payload.period) : '';
  const startPlan = plans.find((p) => p.period === startPeriod);
  /* new access date: counted from the current end date if the plan is still running, else from today */
  const runningEnd = req.periodEnd && new Date(req.periodEnd).getTime() > Date.now() ? new Date(req.periodEnd) : new Date();
  const [period, setPeriod] = useState(startPeriod);
  const [until, setUntil] = useState(ymd(addMonths(startPlan?.months ?? 1, runningEnd)));
  const [amount, setAmount] = useState(quote?.total && Number(quote.total) > 0 ? String(quote.total) : req.payload.amount && Number(req.payload.amount) > 0 ? String(req.payload.amount) : '');
  const [note, setNote] = useState('');

  const run = (status: 'approved' | 'rejected' | 'closed') => {
    if (status === 'closed' && !note.trim()) { toast('Write your reply first.', 'error'); return; }
    if (renewing && status === 'approved' && !until) { toast('Choose the date until which access should run.', 'error'); return; }
    decide.mutate({ id: req.id, status, note: note.trim(), amountRupees: status === 'approved' ? Number(amount) || 0 : 0, until: renewing && status === 'approved' ? new Date(`${until}T23:59:59+05:30`).toISOString() : null, period: period || null },
      { onSuccess: () => { toast(status === 'approved' ? 'Approved. The owner was notified.' : status === 'rejected' ? 'Declined. The owner was notified.' : 'Reply sent.'); onClose(); }, onError: (e) => toast(e.message, 'error') });
  };

  return (
    <Modal title={req.business} eyebrow={KIND_LABEL[req.kind]} onClose={onClose} width="max-w-xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-input p-4 text-sm">
          <p className="font-medium text-text">{req.subject}</p>
          {req.kind === 'branch' && <dl className="mt-2 grid gap-1 text-xs text-text-secondary"><div>Branch: <span className="text-text">{req.payload.name}</span></div>{req.payload.address && <div>Address: <span className="text-text">{req.payload.address}</span></div>}<div>Plan allows <span className="text-text">{req.branchLimit}</span> branch(es); <span className="text-text">{req.branchesUsed}</span> in use. Approving adds one more slot and creates this branch.</div></dl>}
          {req.kind === 'renewal' && (
            <div className="mt-2 space-y-2 text-xs text-text-secondary">
              {quote?.lines && quote.lines.length > 0 && <ul className="divide-y divide-border/60 rounded-lg border border-border">{quote.lines.map((l) => <li key={l.label} className="flex justify-between gap-3 px-3 py-1.5"><span>{l.label}</span><span className="shrink-0 text-text">{inr(l.amount)}</span></li>)}<li className="flex justify-between gap-3 px-3 py-1.5 font-semibold text-text"><span>Expected total</span><span>{inr(Number(quote.total) || 0)}</span></li></ul>}
              {newBranches.length > 0 && <p>New branch{newBranches.length === 1 ? '' : 'es'}: <span className="text-text">{newBranches.map((b) => b.name).join(', ')}</span></p>}
              {renewing && Number(quote?.extras) > 0 && <p>Existing extra branches: <span className="text-text">{quote?.extras}</span>, they want to keep <span className="text-text">{quote?.keep}</span>{Number(quote?.keep) < Number(quote?.extras) ? ' (the rest will be switched off, data kept)' : ''}.</p>}
              <p>Transaction ID: <span className="font-mono text-text">{req.payload.reference || '—'}</span> · they say they paid <span className="text-text">{req.payload.amount ? inr(Number(req.payload.amount)) : '—'}</span> {req.payload.paidOn ? `on ${fmtDate(String(req.payload.paidOn))}` : ''}</p>
              <p>Check this in your bank / UPI app before approving. Current plan ends: <span className="text-text">{req.periodEnd ? fmtDate(req.periodEnd) : '—'}</span></p>
            </div>
          )}
          {req.message && <p className="mt-2 whitespace-pre-line text-xs text-text-secondary">{req.message}</p>}
          <p className="mt-2 text-[11px] text-text-disabled">{req.ownerEmail} · {fmtDate(req.createdAt)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2"><PhoneLink phone={req.phone || req.payload.contact} /><ContactButtons phone={req.phone || req.payload.contact} message={`Hello ${req.business},`} /></div>
        </div>

        {renewing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan"><Select value={period} onChange={(e) => { setPeriod(e.target.value); const p = plans.find((x) => x.period === e.target.value); if (p) { setUntil(ymd(addMonths(p.months, runningEnd))); if (!amount) setAmount(String(p.price)); } }}><option value="">Keep current plan</option>{plans.map((p) => <option key={p.period} value={p.period}>{p.name} · {inr(p.price)}</option>)}</Select></Field>
            <Field label="Access until" required><Input type="date" value={until} min={ymd(addDays(1))} onChange={(e) => setUntil(e.target.value)} /></Field>
          </div>
        )}
        {req.kind !== 'support' && <Field label="Amount you received (₹)" hint="used on the invoice and in your revenue"><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" /></Field>}
        <Field label={req.kind === 'support' ? 'Your reply' : 'Note to the owner'} hint={req.kind === 'support' ? 'required' : 'optional'}><Textarea rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} /></Field>

        {req.kind === 'renewal' && <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-gold">When you approve, the plan / branches are updated and an invoice is created automatically (edit it later in the Invoices tab).</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {req.kind === 'support'
            ? <Button variant="gold" onClick={() => run('closed')} disabled={decide.isPending}><Send size={15} /> Send reply and close</Button>
            : <><Button variant="danger" onClick={() => run('rejected')} disabled={decide.isPending}><XCircle size={15} /> Decline</Button><Button variant="gold" onClick={() => run('approved')} disabled={decide.isPending}>{decide.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Approve</Button></>}
        </div>
      </div>
    </Modal>
  );
}

function LeadRow({ l, onMake }: { l: Lead; onMake: (l: Lead) => void }) {
  const { toast } = useUi();
  const { setLead } = usePlatformExt();
  const set = (status: 'new' | 'contacted' | 'done' | 'delete') => setLead.mutate({ id: l.id, status }, { onError: (e) => toast(e.message, 'error') });
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">{l.name}{l.business && <span className="text-text-secondary">· {l.business}</span>}<Badge tone={l.status === 'new' ? 'gold' : l.status === 'contacted' ? 'info' : 'neutral'}>{l.status}</Badge></p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-secondary"><PhoneLink phone={l.phone} className="text-xs" />{l.email && <span>· {l.email}</span>}<span>· {fmtDate(l.createdAt)}</span></p>
        {l.message && <p className="mt-1 text-xs text-text-secondary">{l.message}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <ContactButtons phone={l.phone} message={`Hello ${l.name}, thank you for your interest in Eventora OS.`} onWhatsapp={() => l.status === 'new' && set('contacted')} />
        <Button size="sm" variant="gold" onClick={() => onMake(l)}><UserPlus size={13} /> Create owner</Button>
        {l.status !== 'done' && <Button size="sm" variant="ghost" onClick={() => set('done')}>Done</Button>}
        <Button size="sm" variant="ghost" onClick={() => set('delete')}>Delete</Button>
      </div>
    </li>
  );
}

export function RequestsTab({ initial = 'pending' }: { initial?: 'pending' | 'all' | 'leads' }) {
  const { toast, confirm } = useUi();
  const { deleteRequest, clearAnswered, purge } = usePlatformExt();
  const [filter, setFilter] = useState<'pending' | 'all' | 'leads'>(initial);
  useEffect(() => { setFilter(initial); }, [initial]);
  // answered requests older than your auto-delete setting (Settings) are cleared whenever this tab opens
  useEffect(() => { purge.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (r: PlatformRequest) => {
    if (!(await confirm({ title: `Delete this ${KIND_LABEL[r.kind].toLowerCase()} request?`, text: `${r.business} · ${r.subject}. Payments you recorded are not affected.`, confirmLabel: 'Delete', danger: true }))) return;
    deleteRequest.mutate(r.id, { onSuccess: () => toast('Deleted.'), onError: (e) => toast(e.message, 'error') });
  };
  const clearAll = async () => {
    if (!(await confirm({ title: 'Delete all answered requests?', text: 'Removes every approved, declined or replied request and every finished access lead. Requests still waiting stay. Payments are not affected.', confirmLabel: 'Delete answered', danger: true }))) return;
    clearAnswered.mutate(undefined, { onSuccess: (n) => toast(n ? `${n} deleted.` : 'Nothing to delete.'), onError: (e) => toast(e.message, 'error') });
  };
  const reqs = usePlatformRequests(filter === 'pending' ? 'pending' : undefined);
  const leads = usePlatformLeads();
  const [open, setOpen] = useState<PlatformRequest | null>(null);
  const [makeFrom, setMakeFrom] = useState<Lead | null>(null);
  const newLeads = (leads.data ?? []).filter((l) => l.status === 'new').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Requests</h2><p className="mt-1 text-sm text-text-secondary">Renewal and branch requests, owner messages and people asking for access. Answered ones are cleared automatically (see Settings), or delete them yourself.</p></div>
        <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void clearAll()} disabled={clearAnswered.isPending}><Trash2 size={13} /> Clear answered</Button>
        <div className="flex flex-wrap gap-1 rounded-2xl border border-border bg-surface p-1">
          {([['pending', 'Waiting', 0], ['all', 'All requests', 0], ['leads', 'Access leads', newLeads]] as const).map(([id, label, n]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} className={cn('flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors', filter === id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>{label}{n > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-obsidian/20 px-1.5 text-[11px] font-bold">{n}</span>}</button>
          ))}
        </div>
        </div>
      </div>

      <Card>
        {filter === 'leads' ? (
          leads.isLoading ? <Spinner label="Loading leads" /> : leads.error ? <p className="p-5 text-sm text-error">{(leads.error as Error).message}</p> : (leads.data ?? []).length === 0
            ? <EmptyState icon={<Inbox />} title="No access leads yet" text="People who press “Request access” on your website appear here." />
            : <ul className="divide-y divide-border/60">{(leads.data ?? []).map((l) => <LeadRow key={l.id} l={l} onMake={setMakeFrom} />)}</ul>
        ) : reqs.isLoading ? <Spinner label="Loading requests" /> : reqs.error ? <p className="p-5 text-sm text-error">{(reqs.error as Error).message}</p> : (reqs.data ?? []).length === 0
          ? <EmptyState icon={<Inbox />} title={filter === 'pending' ? 'Nothing is waiting' : 'No requests yet'} text="Owners send these from Billing, Branches and Messages." />
          : (
            <ul className="divide-y divide-border/60">
              {(reqs.data ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-hover text-gold">{r.kind === 'branch' ? <Building2 size={18} /> : r.kind === 'renewal' ? <KeyRound size={18} /> : <MessageCircle size={18} />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">{r.business}<Badge tone={STATUS_TONE[r.status]}>{r.status === 'pending' ? 'Waiting' : r.status}</Badge><Badge>{KIND_LABEL[r.kind]}</Badge></p>
                    <p className="mt-0.5 truncate text-xs text-text-secondary">{r.subject}{r.kind === 'renewal' && r.payload.reference ? ` · ref ${r.payload.reference}` : ''}{r.kind === 'renewal' && r.payload.quote?.total ? ` · ${inr(Number(r.payload.quote.total))}` : ''} · {fmtDate(r.createdAt)}</p>
                    <p className="mt-1"><PhoneLink phone={r.phone || r.payload.contact} className="text-xs" /></p>
                    {r.status !== 'pending' && r.note && <p className="mt-0.5 truncate text-[11px] italic text-gold">Your note: {r.note}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ContactButtons phone={r.phone || r.payload.contact} message={`Hello ${r.business},`} />
                    {r.status === 'pending' ? <Button size="sm" variant="gold" onClick={() => setOpen(r)}>{r.kind === 'support' ? 'Reply' : 'Review'}</Button> : <span className="text-[11px] text-text-disabled">{r.decidedAt ? fmtDate(r.decidedAt) : ''}</span>}
                    <Button size="sm" variant="ghost" title="Delete" onClick={() => void remove(r)} disabled={deleteRequest.isPending}><Trash2 size={14} /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>
      {open && <DecideModal req={open} onClose={() => setOpen(null)} />}
      {makeFrom && <AddOwnerModal prefill={{ name: makeFrom.name, business: makeFrom.business, phone: makeFrom.phone, email: makeFrom.email }} onClose={() => setMakeFrom(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- Settings --- */
export function SettingsTab() {
  const { toast } = useUi();
  const { data, isLoading, error } = usePlatformConfig();
  const { saveConfig } = usePlatformExt();
  const [c, setC] = useState<PlatformConfig | null>(null);
  useEffect(() => { if (data) setC(data); }, [data]);
  const set = useMemo(() => <K extends keyof PlatformConfig>(k: K, v: PlatformConfig[K]) => setC((cur) => (cur ? { ...cur, [k]: v } : cur)), []);
  if (isLoading || (!c && !error)) return <Spinner label="Loading settings" />;
  if (error || !c) return <Card className="p-8 text-center text-sm text-error">{(error as Error | null)?.message ?? 'Could not load settings.'}</Card>;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader title="How owners pay you and reach you" subtitle="Shown on their Billing page, in reminders ({upi}, {whatsapp}) and on the public Request access page" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="WhatsApp number" hint="with country code, e.g. 919876543210"><Input value={c.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} inputMode="tel" /></Field>
          <Field label="Phone"><Input value={c.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" /></Field>
          <Field label="Support email"><Input type="email" value={c.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Extra branch fee (₹ per MONTH)" hint="per branch, every month"><Input type="number" min={0} value={c.branchPrice} onChange={(e) => set('branchPrice', Number(e.target.value) || 0)} inputMode="numeric" /></Field>
          <Field label="Your UPI ID"><Input value={c.upi} onChange={(e) => set('upi', e.target.value)} placeholder="name@bank" /></Field>
          <Field label="Name on the UPI / account"><Input value={c.payee} onChange={(e) => set('payee', e.target.value)} /></Field>
          <Field label="Bank details" hint="optional" className="sm:col-span-2"><Textarea rows={3} value={c.bankText} onChange={(e) => set('bankText', e.target.value)} placeholder={'Account name\nAccount number\nIFSC'} /></Field>
          <Field label="Payment instructions" className="sm:col-span-2"><Textarea rows={2} value={c.instructions} onChange={(e) => set('instructions', e.target.value)} /></Field>
          <Field label="Auto-delete answered requests" hint="removed from the Requests list; your payments stay in Payments" className="sm:col-span-2">
            <Select value={String(c.requestKeepDays)} onChange={(e) => set('requestKeepDays', Number(e.target.value))}>
              <option value="-1">Never (I delete them myself)</option><option value="0">Right after I answer them</option><option value="7">7 days after I answer</option><option value="30">30 days after I answer</option><option value="90">90 days after I answer</option>
            </Select>
          </Field>
          <div className="sm:col-span-2"><Switch checked={c.allowSelfSignup} onChange={(v) => set('allowSelfSignup', v)} label="Allow people to create a business by themselves" description="Keep this OFF for manual access. Also turn off “Allow new users to sign up” in Supabase → Authentication." /></div>
        </div>
        <div className="flex justify-end border-t border-border/70 px-5 py-4"><Button variant="gold" disabled={saveConfig.isPending} onClick={() => saveConfig.mutate(c, { onSuccess: () => toast('Settings saved.'), onError: (e) => toast(e.message, 'error') })}>{saveConfig.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</Button></div>
      </Card>
      <div className="xl:col-span-2"><InvoiceSettingsCard /></div>
      <div className="xl:col-span-2"><PlatformSettingsTab /></div>
    </div>
  );
}

