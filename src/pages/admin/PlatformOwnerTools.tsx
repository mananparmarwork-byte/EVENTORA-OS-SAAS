import { useEffect, useState } from 'react';
import { Building2, Copy, KeyRound, Loader2, MessageCircle, Save, Send, Trash2, Wand2 } from 'lucide-react';
import { Badge, Button, Field, Input, Select, Spinner, Textarea, useUi } from '@/components/ui';
import { usePlatformBranches, usePlatformExt, useTenantMeta } from '@/lib/apiExt';
import { makePassword } from '@/pages/admin/PlatformOwners';
import { whatsappLink } from '@/lib/settings';
import type { SubRow } from '@/lib/types';

const TYPES = ['Banquet hall', 'Party plot', 'Restaurant', 'Hotel', 'Resort', 'Event company', 'Caterer', 'Other'];

/** Software owner only: every branch of this business, with a delete button. Customers never see this. */
function BranchDelete({ tenantId }: { tenantId: string }) {
  const { toast, confirm } = useUi();
  const { data = [], isLoading, error } = usePlatformBranches(tenantId);
  const { deleteBranch } = usePlatformExt();
  const remove = async (b: { id: string; name: string; bills: number; staff: number }) => {
    const ok = await confirm({
      title: `Delete branch “${b.name}”?`,
      text: `${b.bills} bill${b.bills === 1 ? '' : 's'} and ${b.staff} employee${b.staff === 1 ? '' : 's'} of this branch will move to the Main branch. The customer cannot undo this.`,
      confirmLabel: 'Delete branch', danger: true,
    });
    if (!ok) return;
    deleteBranch.mutate({ tenantId, branchId: b.id }, { onSuccess: (r) => toast(`Branch deleted. ${r.billsMoved} bill${r.billsMoved === 1 ? '' : 's'} moved to Main.`), onError: (e) => toast(e.message, 'error') });
  };
  return (
    <section className="space-y-3">
      <div><h3 className="font-semibold text-text">Branches</h3><p className="text-xs text-text-secondary">Only you can delete a branch. The customer can add and edit branches but has no delete button.</p></div>
      {isLoading ? <Spinner label="Loading branches" /> : error ? <p className="text-sm text-error">{(error as Error).message}</p> : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border">
          {data.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0"><span className="flex items-center gap-2 font-medium text-text">{b.name}{b.isMain && <Badge tone="gold">Main</Badge>}{!b.active && <Badge tone="neutral">Off</Badge>}</span><span className="block text-xs text-text-secondary">{b.bills} bill{b.bills === 1 ? '' : 's'} · {b.staff} employee{b.staff === 1 ? '' : 's'}</span></span>
              {!b.isMain && <Button size="sm" variant="outline" className="text-error" onClick={() => void remove(b)} disabled={deleteBranch.isPending}><Trash2 size={13} /> Delete</Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Inside "Manage customer": business details, branch slots, password reset and a quick message. */
export function OwnerTools({ row }: { row: SubRow }) {
  const { toast } = useUi();
  const { data: metas } = useTenantMeta();
  const meta = metas?.find((m) => m.id === row.id);
  const { updateTenant, setBranchLimit, resetPassword, send } = usePlatformExt();
  const [name, setName] = useState(row.name);
  const [type, setType] = useState('');
  const [phone, setPhone] = useState('');
  const [limit, setLimit] = useState('1');
  const [pw, setPw] = useState('');
  const [shownPw, setShownPw] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => { if (meta) { setType(meta.businessType); setPhone(meta.phone); setLimit(String(meta.branchLimit)); } }, [meta]);

  const saveDetails = () => updateTenant.mutate({ tenantId: row.id, name, businessType: type, phone }, { onSuccess: () => toast('Details saved.'), onError: (e) => toast(e.message, 'error') });
  const saveLimit = () => setBranchLimit.mutate({ tenantId: row.id, limit: Math.round(Number(limit)) }, { onSuccess: () => toast('Branch slots updated.'), onError: (e) => toast(e.message, 'error') });
  const reset = () => resetPassword.mutate({ tenantId: row.id, password: pw }, { onSuccess: () => { setShownPw(pw); setPw(''); toast('Password changed. Send it to the owner.'); }, onError: (e) => toast(e.message, 'error') });
  const copyPw = async () => { try { await navigator.clipboard.writeText(`Eventora OS\nEmail: ${row.ownerEmail}\nNew password: ${shownPw}`); toast('Copied.'); } catch { toast('Copy is blocked in this browser.', 'error'); } };
  const quick = () => send.mutate({ title: title.trim(), body: body.trim(), kind: 'info', channels: ['app'], audience: { mode: 'selected', ids: [row.id] }, url: '/admin/messages', label: row.name },
    { onSuccess: () => { toast('Message sent to their inbox.'); setTitle(''); setBody(''); }, onError: (e) => toast(e.message, 'error') });

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div><h3 className="font-semibold text-text">Business details</h3><p className="text-xs text-text-secondary">The mobile number is used for WhatsApp reminders.</p></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Business name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{[...new Set([type, ...TYPES].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Owner mobile"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} /></Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="outline" onClick={saveDetails} disabled={updateTenant.isPending}>{updateTenant.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save details</Button>
          <span className="mx-1 hidden h-8 w-px bg-border sm:block" />
          <Field label={`Branch slots (${meta?.branches ?? 1} in use)`} className="w-40"><Input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" /></Field>
          <Button variant="outline" onClick={saveLimit} disabled={setBranchLimit.isPending}><Building2 size={14} /> Set branches</Button>
        </div>
      </section>

      <BranchDelete tenantId={row.id} />

      <section className="space-y-3">
        <div><h3 className="font-semibold text-text">Owner login</h3><p className="text-xs text-text-secondary">Forgot password? Set a new one here and send it to them.</p></div>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs font-mono" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (10+ characters)" autoComplete="off" />
          <Button variant="outline" onClick={() => setPw(makePassword())}><Wand2 size={14} /> Generate</Button>
          <Button variant="outline" onClick={reset} disabled={resetPassword.isPending || pw.length < 10}>{resetPassword.isPending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Set password</Button>
        </div>
        {shownPw && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-success-bg px-3 py-2 text-xs text-success">
            <span>New password: <span className="font-mono text-text">{shownPw}</span> (shown once)</span>
            <Button size="sm" variant="outline" onClick={() => void copyPw()}><Copy size={12} /> Copy</Button>
            {phone && <a href={whatsappLink(phone, `Eventora OS\nEmail: ${row.ownerEmail}\nNew password: ${shownPw}`)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><MessageCircle size={12} /> WhatsApp</Button></a>}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div><h3 className="font-semibold text-text">Send a message</h3><p className="text-xs text-text-secondary">Goes to this owner&apos;s inbox. For many businesses at once use the Messages tab.</p></div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={160} />
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message (you can use {business}, {end_date}, {amount}, {upi})" maxLength={1500} />
        <div className="flex flex-wrap gap-2">
          <Button variant="gold" onClick={quick} disabled={send.isPending || !title.trim() || !body.trim()}>{send.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to inbox</Button>
          {phone && body.trim() && <a href={whatsappLink(phone, `${title}\n\n${body}`.replace(/\{business\}/g, row.name))} target="_blank" rel="noreferrer"><Button variant="outline"><MessageCircle size={14} /> Open in WhatsApp</Button></a>}
        </div>
      </section>
    </div>
  );
}
