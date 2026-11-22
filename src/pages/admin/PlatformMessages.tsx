import { useMemo, useState } from 'react';
import { BellRing, Check, Clock, Loader2, MailCheck, MessageCircle, Pencil, Play, Plus, Save, Search, Send, Trash2, Users, Zap } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Switch, Textarea, useUi } from '@/components/ui';
import { KIND_STYLE, KINDS } from '@/components/noticeStyle';
import { useSubscriptionOverview } from '@/lib/api';
import { usePlatformCampaigns, usePlatformExt, usePlatformRules, usePlatformTemplates, usePreviewMessage } from '@/lib/apiExt';
import { cn, fmtDate } from '@/lib/format';
import { whatsappLink } from '@/lib/settings';
import type { Audience, MessageRule, MessageTemplate, NoticeKind, SendResult } from '@/lib/types';

const SEGMENTS: { id: string; label: string; help: string }[] = [
  { id: 'due', label: 'Money to collect', help: 'Plan ended or a payment failed' },
  { id: 'expiring_7', label: 'Ending in 7 days', help: 'Plan or trial ends within a week' },
  { id: 'expiring_30', label: 'Ending in 30 days', help: 'Plan or trial ends within a month' },
  { id: 'expired', label: 'Locked (expired)', help: 'Cannot use the software now' },
  { id: 'trial', label: 'On free trial', help: 'Still trying the software' },
  { id: 'paid', label: 'Active customers', help: 'Have a running plan' },
  { id: 'multi_branch', label: 'Multi-branch businesses', help: 'More than one branch' },
];
const TOKENS = ['business', 'plan', 'end_date', 'days_left', 'amount', 'upi', 'payee', 'whatsapp'];

/* --------------------------------------------------------------------------- Messages --- */
function SentModal({ result, onClose }: { result: SendResult; onClose: () => void }) {
  return (
    <Modal title={`Sent to ${result.count} business${result.count === 1 ? '' : 'es'}`} eyebrow="Done" onClose={onClose} width="max-w-2xl" footer={<Button variant="gold" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-bg p-3 text-sm text-success"><Check size={16} className="mt-0.5 shrink-0" /> It is in each owner&apos;s inbox now (they see the bell light up).{result.email ? ' E-mail was also requested.' : ''}</p>
        <div>
          <p className="text-sm font-semibold text-text">Also send on WhatsApp</p>
          <p className="text-xs text-text-secondary">WhatsApp opens with the message ready for each person. You press Send.</p>
        </div>
        <ul className="max-h-[320px] divide-y divide-border/60 overflow-y-auto rounded-xl border border-border">
          {result.recipients.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0"><span className="block truncate text-text">{r.business}</span><span className="block truncate text-[11px] text-text-disabled">{r.phone || 'no mobile saved'}</span></span>
              {r.phone ? <a href={whatsappLink(r.phone, `${r.title}\n\n${r.body}`)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><MessageCircle size={13} /> WhatsApp</Button></a> : <span className="text-[11px] text-text-disabled">add a mobile in Manage</span>}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function Compose({ initial }: { initial?: { tenantId: string } }) {
  const { toast } = useUi();
  const { send, saveTemplate, sendEmails } = usePlatformExt();
  const { data: subs = [] } = useSubscriptionOverview();
  const { data: templates = [] } = usePlatformTemplates();
  const [mode, setMode] = useState<'all' | 'segment' | 'selected'>(initial ? 'selected' : 'segment');
  const [segment, setSegment] = useState('due');
  const [ids, setIds] = useState<string[]>(initial ? [initial.tenantId] : []);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<NoticeKind>('payment');
  const [whatsapp, setWhatsapp] = useState(true);
  const [email, setEmail] = useState(false);
  const [sent, setSent] = useState<SendResult | null>(null);

  const audience: Audience = mode === 'all' ? { mode: 'all' } : mode === 'segment' ? { mode: 'segment', segment } : { mode: 'selected', ids };
  const label = mode === 'all' ? 'All businesses' : mode === 'segment' ? SEGMENTS.find((s) => s.id === segment)?.label ?? segment : `${ids.length} selected`;
  const ready = title.trim() !== '' && body.trim() !== '' && (mode !== 'selected' || ids.length > 0);
  const preview = usePreviewMessage({ title, body, audience }, ready);
  const q = search.trim().toLowerCase();
  const list = useMemo(() => subs.filter((s) => !q || [s.name, s.ownerEmail ?? ''].some((v) => v.toLowerCase().includes(q))), [subs, q]);

  const useTemplate = (id: string) => { const t = templates.find((x) => x.id === id); if (t) { setTitle(t.title); setBody(t.body); setKind(t.kind); } };
  const addToken = (t: string) => {
    const el = document.getElementById('compose-body') as HTMLTextAreaElement | null; const ins = `{${t}}`;
    if (!el) { setBody((b) => b + ins); return; }
    const s = el.selectionStart ?? body.length, e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + ins + body.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + ins.length, s + ins.length); });
  };
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const go = () => {
    if (!ready) { toast('Write a title and a message, and choose who receives it.', 'error'); return; }
    send.mutate({ title: title.trim(), body: body.trim(), kind, channels: ['app', ...(whatsapp ? ['whatsapp'] : []), ...(email ? ['email'] : [])], audience, url: kind === 'payment' || kind === 'plan' || kind === 'reminder' ? '/admin/billing' : '/admin/messages', label },
      {
        onSuccess: (r) => {
          if (r.count === 0) { toast('Nobody matched this audience, so nothing was sent.', 'info'); return; }
          if (email) sendEmails.mutate(undefined, { onSuccess: (m) => toast(`E-mail: ${m.sent} sent${m.failed ? `, ${m.failed} failed` : ''}.`, m.failed ? 'error' : 'success'), onError: (e) => toast(`Message saved, but e-mail was not sent: ${e.message}`, 'error') });
          setSent(r);
        },
        onError: (e) => toast(e.message, 'error'),
      });
  };
  const saveAsTemplate = () => {
    const name = window.prompt('Name this template');
    if (!name || !title.trim() || !body.trim()) return;
    saveTemplate.mutate({ name, title: title.trim(), body: body.trim(), kind }, { onSuccess: () => toast('Template saved.'), onError: (e) => toast(e.message, 'error') });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader title="New message" subtitle="Sent to the owner's inbox. Words in {curly brackets} are filled in for each business." />
        <div className="space-y-5 p-5">
          <Field label="Start from a template" hint="optional"><Select value="" onChange={(e) => useTemplate(e.target.value)}><option value="">Choose a template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>

          <div>
            <p className="mb-2 text-xs font-medium text-text-secondary">Who gets it</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {([['all', 'Everyone'], ['segment', 'A group'], ['selected', 'Choose businesses']] as const).map(([k, t]) => <button key={k} type="button" onClick={() => setMode(k)} className={cn('rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors', mode === k ? 'border-gold bg-gold/10 text-gold' : 'border-border text-text-secondary hover:text-text')}>{t}</button>)}
            </div>
            {mode === 'segment' && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SEGMENTS.map((s) => <button key={s.id} type="button" onClick={() => setSegment(s.id)} className={cn('rounded-xl border p-3 text-left transition-colors', segment === s.id ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/50')}><p className="text-sm font-medium text-text">{s.label}</p><p className="text-[11px] text-text-secondary">{s.help}</p></button>)}
              </div>
            )}
            {mode === 'selected' && (
              <div className="mt-3 rounded-xl border border-border">
                <div className="relative border-b border-border/70"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" /><Input className="h-10 rounded-none border-0 pl-9 text-xs" placeholder="Search business or email" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
                <ul className="max-h-56 divide-y divide-border/50 overflow-y-auto">
                  {list.map((s) => (
                    <li key={s.id}><label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"><input type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} className="size-4 accent-[#E6B84A]" /><span className="min-w-0 flex-1"><span className="block truncate text-sm text-text">{s.name}</span><span className="block truncate text-[11px] text-text-disabled">{s.ownerEmail ?? 'no email'} · {s.planName ?? 'no plan'}</span></span></label></li>
                  ))}
                  {list.length === 0 && <li className="px-4 py-6 text-center text-xs text-text-secondary">No business found.</li>}
                </ul>
                <div className="flex items-center justify-between border-t border-border/70 px-4 py-2 text-[11px] text-text-secondary"><span>{ids.length} selected</span><span className="flex gap-3"><button type="button" className="hover:text-gold" onClick={() => setIds(list.map((s) => s.id))}>Select shown</button><button type="button" className="hover:text-gold" onClick={() => setIds([])}>Clear</button></span></div>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_190px]">
            <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="e.g. Payment reminder" /></Field>
            <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value as NoticeKind)}>{KINDS.map((k) => <option key={k} value={k}>{KIND_STYLE[k].label}</option>)}</Select></Field>
          </div>
          <Field label="Message" required>
            <Textarea id="compose-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1500} placeholder="Hello {business}, your plan ends on {end_date}. Please pay ₹{amount} to UPI {upi}." />
          </Field>
          <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[11px] text-text-disabled">Insert:</span>{TOKENS.map((t) => <button key={t} type="button" onClick={() => addToken(t)} className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-text-secondary hover:border-gold hover:text-gold">{`{${t}}`}</button>)}</div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5"><p className="flex items-center gap-2 text-sm font-medium text-text"><BellRing size={14} className="text-gold" /> In-app</p><p className="text-[11px] text-text-secondary">Always on</p></div>
            <button type="button" onClick={() => setWhatsapp((v) => !v)} className={cn('rounded-xl border px-3 py-2.5 text-left transition-colors', whatsapp ? 'border-gold bg-gold/10' : 'border-border')}><p className="flex items-center gap-2 text-sm font-medium text-text"><MessageCircle size={14} className="text-gold" /> WhatsApp</p><p className="text-[11px] text-text-secondary">Buttons after sending</p></button>
            <button type="button" onClick={() => setEmail((v) => !v)} className={cn('rounded-xl border px-3 py-2.5 text-left transition-colors', email ? 'border-gold bg-gold/10' : 'border-border')}><p className="flex items-center gap-2 text-sm font-medium text-text"><MailCheck size={14} className="text-gold" /> E-mail</p><p className="text-[11px] text-text-secondary">Needs e-mail set-up</p></button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="gold" size="lg" onClick={go} disabled={send.isPending || !ready}>{send.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send to {ready && preview.data ? `${preview.data.length} business${preview.data.length === 1 ? '' : 'es'}` : label}</Button>
            <Button variant="outline" size="lg" onClick={saveAsTemplate} disabled={!title.trim() || !body.trim()}><Save size={15} /> Save as template</Button>
          </div>
        </div>
      </Card>

      <Card className="h-fit xl:sticky xl:top-24">
        <CardHeader title="Preview" subtitle={ready ? (preview.isLoading ? 'Checking…' : `${preview.data?.length ?? 0} recipient${preview.data?.length === 1 ? '' : 's'} · ${label}`) : 'Write a message to see it here'} />
        <div className="p-5">
          {!ready ? <EmptyState icon={<Users />} title="Nothing to preview" text="Choose who receives it and write the message." /> : preview.isLoading ? <Spinner label="Preparing preview" /> : preview.error ? <p className="text-sm text-error">{(preview.error as Error).message}</p> : (preview.data ?? []).length === 0 ? <p className="text-sm text-text-secondary">Nobody matches this audience right now.</p> : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-input p-4">
                <p className="text-[10px] uppercase tracking-wide text-text-disabled">As {preview.data?.[0].business} will see it</p>
                <p className="mt-2 font-semibold text-text">{preview.data?.[0].title}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-text-secondary">{preview.data?.[0].body}</p>
              </div>
              <ul className="max-h-48 divide-y divide-border/50 overflow-y-auto text-sm">{preview.data?.map((r) => <li key={r.id} className="flex justify-between gap-3 py-1.5"><span className="truncate text-text">{r.business}</span><span className="shrink-0 text-[11px] text-text-disabled">{r.endDate || '—'}</span></li>)}</ul>
            </div>
          )}
        </div>
      </Card>
      {sent && <SentModal result={sent} onClose={() => setSent(null)} />}
    </div>
  );
}

function History() {
  const { data = [], isLoading, error } = usePlatformCampaigns();
  if (isLoading) return <Spinner label="Loading history" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;
  return (
    <Card>
      <CardHeader title="Sent messages" subtitle="What you sent, to whom, and how many have read it" />
      {data.length === 0 ? <EmptyState icon={<Send />} title="Nothing sent yet" text="Messages you send show up here." /> : (
        <ul className="divide-y divide-border/60">
          {data.map((c) => {
            const Icon = KIND_STYLE[c.kind]?.icon ?? BellRing;
            return (
              <li key={c.id} className="flex gap-4 px-5 py-4">
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', KIND_STYLE[c.kind]?.box)}><Icon size={18} /></span>
                <div className="min-w-0 flex-1"><p className="font-medium text-text">{c.title}</p><p className="line-clamp-2 text-xs text-text-secondary">{c.body}</p><p className="mt-1 text-[11px] text-text-disabled">{fmtDate(c.createdAt)} · {c.audienceLabel || 'Selected'} · {c.channels.join(', ')}</p></div>
                <div className="shrink-0 text-right"><p className="text-sm font-semibold text-text tabular">{c.count}</p><p className="text-[11px] text-text-secondary">sent</p><p className="mt-1 text-[11px] text-success">{c.read} read</p></div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Templates() {
  const { toast, confirm } = useUi();
  const { data = [], isLoading } = usePlatformTemplates();
  const { saveTemplate, deleteTemplate } = usePlatformExt();
  const [edit, setEdit] = useState<(Partial<MessageTemplate> & { name: string; title: string; body: string; kind: NoticeKind }) | null>(null);
  if (isLoading) return <Spinner label="Loading templates" />;
  const save = () => { if (!edit) return; saveTemplate.mutate({ id: edit.id, name: edit.name, title: edit.title, body: edit.body, kind: edit.kind }, { onSuccess: () => { toast('Template saved.'); setEdit(null); }, onError: (e) => toast(e.message, 'error') }); };
  return (
    <Card>
      <CardHeader title="Templates" subtitle="Ready-made messages you can reuse" action={<Button size="sm" variant="gold" onClick={() => setEdit({ name: '', title: '', body: '', kind: 'info' })}><Plus size={14} /> New template</Button>} />
      <ul className="divide-y divide-border/60">
        {data.map((t) => (
          <li key={t.id} className="flex items-start gap-3 px-5 py-4">
            <div className="min-w-0 flex-1"><p className="flex items-center gap-2 text-sm font-medium text-text">{t.name}{t.builtin && <Badge>built-in</Badge>}</p><p className="mt-0.5 text-xs font-medium text-text-secondary">{t.title}</p><p className="mt-0.5 line-clamp-2 text-xs text-text-disabled">{t.body}</p></div>
            <Button size="sm" variant="outline" onClick={() => setEdit({ ...t })}><Pencil size={13} /></Button>
            {!t.builtin && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Delete “${t.name}”?`, confirmLabel: 'Delete', danger: true })) deleteTemplate.mutate(t.id, { onError: (e) => toast(e.message, 'error') }); }}><Trash2 size={13} /></Button>}
          </li>
        ))}
      </ul>
      {edit && (
        <Modal title={edit.id ? 'Edit template' : 'New template'} eyebrow="Templates" onClose={() => setEdit(null)} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="gold" onClick={save} disabled={saveTemplate.isPending}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Template name" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} /></Field>
            <Field label="Title" required><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={160} /></Field>
            <Field label="Message" required hint={TOKENS.map((t) => `{${t}}`).join(' ')}><Textarea rows={5} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} maxLength={1500} /></Field>
            <Field label="Type"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as NoticeKind })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_STYLE[k].label}</option>)}</Select></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

export function MessagesTab({ initialTenant }: { initialTenant?: string }) {
  const [sub, setSub] = useState<'compose' | 'history' | 'templates'>('compose');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Messages</h2><p className="mt-1 text-sm text-text-secondary">Send reminders and news to all owners, a group, or a few selected businesses.</p></div>
        <div className="flex gap-1 rounded-2xl border border-border bg-surface p-1">
          {([['compose', 'Compose'], ['history', 'Sent'], ['templates', 'Templates']] as const).map(([id, l]) => <button key={id} type="button" onClick={() => setSub(id)} className={cn('rounded-xl px-3.5 py-2 text-sm font-medium transition-colors', sub === id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>{l}</button>)}
        </div>
      </div>
      {sub === 'compose' && <Compose initial={initialTenant ? { tenantId: initialTenant } : undefined} />}
      {sub === 'history' && <History />}
      {sub === 'templates' && <Templates />}
    </div>
  );
}

/* -------------------------------------------------------------------------- Automation --- */
function RuleEditor({ rule, onClose }: { rule: MessageRule; onClose: () => void }) {
  const { toast } = useUi();
  const { saveRule } = usePlatformExt();
  const [r, setR] = useState(rule);
  const save = () => saveRule.mutate({ key: r.key, enabled: r.enabled, days: r.days, title: r.title, body: r.body, kind: r.kind, channels: r.channels }, { onSuccess: () => { toast('Saved.'); onClose(); }, onError: (e) => toast(e.message, 'error') });
  const hasEmail = r.channels.includes('email');
  return (
    <Modal title={r.label} eyebrow="Automatic message" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="gold" onClick={save} disabled={saveRule.isPending}>{saveRule.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</Button></>}>
      <div className="space-y-4">
        <p className="text-xs text-text-secondary">{r.description}</p>
        <Switch checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} label="Send this automatically" />
        {r.trigger !== 'event' && <Field label={r.trigger === 'before_end' ? 'Days before the end' : 'Days after the end'} hint={r.trigger === 'before_end' ? '0 = on the last day' : ''} className="max-w-[200px]"><Input type="number" min={0} max={365} value={r.days} onChange={(e) => setR({ ...r, days: Math.max(0, Number(e.target.value) || 0) })} inputMode="numeric" /></Field>}
        <Field label="Title" required><Input value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} maxLength={160} /></Field>
        <Field label="Message" required hint={`${TOKENS.map((t) => `{${t}}`).join(' ')} {branch} {until} {note}`}><Textarea rows={5} value={r.body} onChange={(e) => setR({ ...r, body: e.target.value })} maxLength={1500} /></Field>
        <Field label="Type"><Select value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value as NoticeKind })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_STYLE[k].label}</option>)}</Select></Field>
        <Switch checked={hasEmail} onChange={(v) => setR({ ...r, channels: v ? ['app', 'email'] : ['app'] })} label="Also e-mail it" description="Needs the e-mail set-up (send-message-emails function)." />
      </div>
    </Modal>
  );
}

export function AutomationTab() {
  const { toast } = useUi();
  const { data = [], isLoading, error } = usePlatformRules();
  const { saveRule, runAuto } = usePlatformExt();
  const [edit, setEdit] = useState<MessageRule | null>(null);
  if (isLoading) return <Spinner label="Loading automation" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;
  const groups: { id: MessageRule['trigger']; title: string; text: string; icon: typeof Clock }[] = [
    { id: 'before_end', title: 'Before a plan or trial ends', text: 'Sent once per plan end date. The closest rule that applies is used.', icon: Clock },
    { id: 'after_end', title: 'After a plan or trial ended', text: 'Reminders to collect payment from locked accounts.', icon: BellRing },
    { id: 'event', title: 'Automatic replies and notices', text: 'Sent instantly when something happens: a new owner is added, a request arrives, you approve or decline.', icon: Zap },
  ];
  const toggle = (r: MessageRule, enabled: boolean) => saveRule.mutate({ key: r.key, enabled, days: r.days, title: r.title, body: r.body, kind: r.kind, channels: r.channels }, { onError: (e) => toast(e.message, 'error') });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Automation</h2><p className="mt-1 max-w-2xl text-sm text-text-secondary">Messages that go out by themselves: plan reminders, payment follow-ups and instant replies. Switch each one on or off and rewrite the words.</p></div>
        <Button variant="outline" onClick={() => runAuto.mutate(undefined, { onSuccess: (n) => toast(n ? `${n} reminder${n === 1 ? '' : 's'} created.` : 'Nothing new to send right now.', n ? 'success' : 'info'), onError: (e) => toast(e.message, 'error') })} disabled={runAuto.isPending}>{runAuto.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Check and send now</Button>
      </div>
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-text-secondary">Reminders are created whenever an owner opens the app, and for everyone when you press the button above. To create them every morning even if nobody opens the app, run <code className="text-gold">supabase/17-auto-messages-cron.sql</code> once.</p>
      {groups.map((g) => (
        <Card key={g.id}>
          <CardHeader title={g.title} subtitle={g.text} action={<g.icon size={16} className="text-gold" />} />
          <ul className="divide-y divide-border/60">
            {data.filter((r) => r.trigger === g.id).map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">{r.label}{g.id !== 'event' && <Badge tone="gold">{g.id === 'before_end' ? (r.days === 0 ? 'last day' : `${r.days} day${r.days === 1 ? '' : 's'} before`) : `${r.days} day${r.days === 1 ? '' : 's'} after`}</Badge>}{r.appliesTo !== 'any' && <Badge>{r.appliesTo === 'trial' ? 'trials' : 'paid plans'}</Badge>}{r.channels.includes('email') && <Badge tone="info">e-mail</Badge>}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-text-secondary">{r.title}</p>
                  <p className="mt-0.5 text-[11px] text-text-disabled">Sent {r.sent} time{r.sent === 1 ? '' : 's'}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEdit(r)}><Pencil size={13} /> Edit</Button>
                <Switch checked={r.enabled} onChange={(v) => toggle(r, v)} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {edit && <RuleEditor key={edit.key} rule={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

