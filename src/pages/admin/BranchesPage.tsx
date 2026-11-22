import { useMemo, useState } from 'react';
import { Building2, CheckCircle2, Loader2, MapPin, Pencil, Phone, Plus, Send, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Spinner, Switch, Textarea, useUi } from '@/components/ui';
import { useBranchInfo } from '@/lib/branch';
import { useBranchActions, useCreateRequest, useMyRequests, usePaymentInfo } from '@/lib/apiExt';
import { useQuotes } from '@/lib/api';
import { fmtDate, inr, inrCompact } from '@/lib/format';
import { quotePaymentState } from '@/lib/pricing';
import type { Branch } from '@/lib/types';

const REQ_TONE = { pending: 'warning', approved: 'success', rejected: 'error', closed: 'neutral' } as const;

function BranchForm({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const { toast } = useUi();
  const { save } = useBranchActions();
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [phone, setPhone] = useState(branch?.phone ?? '');
  const [active, setActive] = useState(branch?.active ?? true);
  const go = () => save.mutate({ id: branch?.id, name, address, phone, active }, { onSuccess: () => { toast(branch ? 'Branch saved.' : 'Branch added.'); onClose(); }, onError: (e) => toast(e.message, 'error') });
  return (
    <Modal title={branch ? 'Edit branch' : 'Add a branch'} eyebrow="Branches" onClose={onClose} width="max-w-lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="gold" onClick={go} disabled={save.isPending}>{save.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Save</Button></>}>
      <div className="space-y-4">
        <Field label="Branch name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alkapuri Banquet" maxLength={60} /></Field>
        <Field label="Address"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} /></Field>
        <Field label="Branch phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} /></Field>
        {branch && !branch.isMain && <Switch checked={active} onChange={setActive} label="Branch is in use" description="Switching it off hides it from the switcher and stops new bills. Its old bills stay in your combined numbers." />}
      </div>
    </Modal>
  );
}

function RequestForm({ onClose }: { onClose: () => void }) {
  const { toast } = useUi();
  const create = useCreateRequest();
  const { info } = usePaymentInfo(true);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const go = () => create.mutate({ kind: 'branch', message: note, payload: { name, address, phone } }, { onSuccess: () => { toast('Request sent. We will confirm soon.'); onClose(); }, onError: (e) => toast(e.message, 'error') });
  return (
    <Modal title="Request another branch" eyebrow="Needs approval" onClose={onClose} width="max-w-lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="gold" onClick={go} disabled={create.isPending}>{create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send request</Button></>}>
      <div className="space-y-4">
        <p className="rounded-xl border border-border bg-input p-3 text-xs text-text-secondary">An extra branch is a paid add-on{info.branchPrice ? ` (${inr(info.branchPrice)})` : ''}. Send the request, pay as shown on the Billing page, and we approve it. The new branch has its own bills, calendar and employees, and you can see everything together.</p>
        <Field label="Branch name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Restaurant, Race Course" maxLength={60} /></Field>
        <Field label="Address"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} /></Field>
        <Field label="Branch phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} /></Field>
        <Field label="Anything to tell us?" hint="optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Payment made by UPI, ref 1234" /></Field>
      </div>
    </Modal>
  );
}

export function BranchesPage() {
  const { info, isLoading, error } = useBranchInfo();
  const { data: quotes = [] } = useQuotes({ all: true });
  const { data: requests = [] } = useMyRequests(true);
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [asking, setAsking] = useState(false);

  const stats = useMemo(() => {
    const m = new Map<string, { bills: number; booked: number; received: number }>();
    quotes.forEach((q) => {
      const s = m.get(q.branchId ?? '') ?? { bills: 0, booked: 0, received: 0 };
      s.bills += 1; if (q.status === 'confirmed') s.booked += 1; s.received += quotePaymentState(q.pricing).received;
      m.set(q.branchId ?? '', s);
    });
    return m;
  }, [quotes]);

  if (isLoading) return <Spinner label="Loading branches" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;
  const full = info.activeCount >= info.limit;
  const branchRequests = requests.filter((r) => r.kind === 'branch');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-text">Branches</h2>
          <p className="mt-1 text-sm text-text-secondary">{info.activeCount} of {info.limit} branch{info.limit === 1 ? '' : 'es'} in use. Each branch has its own bills, calendar and employees. You see them one by one or all together.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!full && <Button variant="gold" onClick={() => setEditing('new')}><Plus size={16} /> Add branch</Button>}
          <Button variant={full ? 'gold' : 'outline'} onClick={() => setAsking(true)}><Send size={15} /> Request another branch</Button>
        </div>
      </div>

      {full && <p className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">All your branch slots are in use. Send a request for another branch and we will approve it.</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {info.branches.map((b) => {
          const s = stats.get(b.id) ?? { bills: 0, booked: 0, received: 0 };
          return (
            <Card key={b.id} className={`p-5 ${b.active ? '' : 'opacity-70'}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-surface-hover text-gold"><Building2 size={20} /></span>
                <div className="flex flex-wrap justify-end gap-1.5">{b.isMain && <Badge tone="gold">Main</Badge>}{!b.active && <Badge tone="neutral">Off</Badge>}</div>
              </div>
              <h3 className="mt-3 text-base font-semibold text-text">{b.name}</h3>
              <p className="mt-1 flex items-start gap-1.5 text-xs text-text-secondary"><MapPin size={13} className="mt-0.5 shrink-0" />{b.address || 'No address added'}</p>
              {b.phone && <p className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary"><Phone size={13} />{b.phone}</p>}
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[['Bills', String(s.bills)], ['Booked', String(s.booked)], ['Collected', inrCompact(s.received)]].map(([k, v]) => <div key={k} className="rounded-lg bg-input px-2 py-2"><dt className="text-[10px] uppercase tracking-wide text-text-disabled">{k}</dt><dd className="mt-0.5 text-sm font-semibold text-text tabular">{v}</dd></div>)}
              </dl>
              <div className="mt-4 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary"><Users size={13} /> {b.staff} employee{b.staff === 1 ? '' : 's'}</span>
                <Button size="sm" variant="outline" onClick={() => setEditing(b)}><Pencil size={13} /> Edit</Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader title="Your branch requests" subtitle="Requests go to the Eventora team for approval" />
        {branchRequests.length === 0 ? <EmptyState icon={<Building2 />} title="No requests yet" text="When you ask for an extra branch it shows here with our answer." /> : (
          <ul className="divide-y divide-border/60">
            {branchRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0"><span className="block font-medium text-text">{r.payload.name || r.subject}</span><span className="block text-xs text-text-secondary">Sent {fmtDate(r.createdAt)}{r.note ? ` · ${r.note}` : ''}</span></span>
                <Badge tone={REQ_TONE[r.status]}>{r.status === 'pending' ? 'Waiting for approval' : r.status === 'approved' ? <><CheckCircle2 size={12} /> Approved</> : r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <BranchForm branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {asking && <RequestForm onClose={() => setAsking(false)} />}
    </div>
  );
}
