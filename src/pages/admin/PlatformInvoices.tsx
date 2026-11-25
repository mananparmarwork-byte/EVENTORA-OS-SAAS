import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Loader2, Pencil, Plus, Save, Search, Trash2 } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, Field, Input, Modal, Spinner, Switch, Textarea, useUi } from '@/components/ui';
import { useInvoiceSettings, usePlatformExt, usePlatformInvoices } from '@/lib/apiExt';
import { fmtDate, inr } from '@/lib/format';
import { buildInvoiceBlob, invoiceFileName, saveBlob } from '@/pdf/generate';
import type { Invoice, InvoiceSettings } from '@/lib/types';

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
/** Same split the database does: GST is "included" in the price, so the amount paid never changes. */
const split = (total: number, gst: boolean, rate: number) => { const t = Math.round(total * 100); if (!gst || rate <= 0) return { sub: t / 100, gst: 0 }; const sub = Math.round(t / (1 + rate / 100)); return { sub: sub / 100, gst: (t - sub) / 100 }; };

function EditInvoice({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const { toast } = useUi();
  const { updateInvoice } = usePlatformExt();
  const [number, setNumber] = useState(inv.number);
  const [issued, setIssued] = useState(dateOnly(inv.issuedAt));
  const [bill, setBill] = useState(inv.billTo);
  const [seller, setSeller] = useState(inv.seller);
  const [items, setItems] = useState(inv.items.map((i) => ({ description: i.description, amount: String(i.amount) })));
  const [gst, setGst] = useState(inv.gstEnabled);
  const [rate, setRate] = useState(String(inv.gstRate || 18));
  const [paid, setPaid] = useState(String(inv.paid));
  const [ref, setRef] = useState(inv.paymentRef);
  const [paidOn, setPaidOn] = useState(dateOnly(inv.paidOn));
  const [plan, setPlan] = useState(inv.planName);
  const [notes, setNotes] = useState(inv.notes);
  const [busy, setBusy] = useState(false);

  const total = items.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const parts = split(total, gst, Number(rate) || 0);
  const setItem = (idx: number, k: 'description' | 'amount', v: string) => setItems((cur) => cur.map((x, j) => (j === idx ? { ...x, [k]: v } : x)));

  const patch = () => ({ number, issuedAt: issued ? `${issued}T12:00:00+05:30` : undefined, billTo: bill, seller, items: items.map((i) => ({ description: i.description.trim(), amount: Number(i.amount) || 0 })), gstEnabled: gst, gstRate: Number(rate) || 0, paid: Number(paid) || 0, paymentRef: ref, paidOn: paidOn || undefined, planName: plan, notes });
  const save = () => updateInvoice.mutate({ id: inv.id, patch: patch() }, { onSuccess: () => { toast('Invoice saved.'); onClose(); }, onError: (e) => toast(e.message, 'error') });
  const pdf = async () => {
    setBusy(true);
    try {
      const p = patch();
      saveBlob(await buildInvoiceBlob({ ...inv, number, issuedAt: p.issuedAt ?? inv.issuedAt, billTo: bill, seller, items: p.items, gstEnabled: gst, gstRate: p.gstRate, subtotal: parts.sub, gst: parts.gst, total, paid: p.paid, paymentRef: ref, paidOn: paidOn || null, planName: plan, notes }), invoiceFileName({ ...inv, number }));
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not make the PDF.', 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Edit invoice ${inv.number}`} eyebrow={inv.business} onClose={onClose} width="max-w-3xl" footer={<><Button variant="outline" onClick={() => void pdf()} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Preview PDF</Button><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="gold" onClick={save} disabled={updateInvoice.isPending}>{updateInvoice.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save invoice</Button></>}>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Invoice number"><Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={30} /></Field>
          <Field label="Invoice date"><Input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} /></Field>
          <Field label="Plan name" hint="optional"><Input value={plan} onChange={(e) => setPlan(e.target.value)} maxLength={80} /></Field>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text">Billed to</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={bill.name ?? ''} onChange={(e) => setBill({ ...bill, name: e.target.value })} /></Field>
            <Field label="GST number" hint="optional"><Input value={bill.gstin ?? ''} onChange={(e) => setBill({ ...bill, gstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>
            <Field label="Phone"><Input value={bill.phone ?? ''} onChange={(e) => setBill({ ...bill, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={bill.email ?? ''} onChange={(e) => setBill({ ...bill, email: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={bill.address ?? ''} onChange={(e) => setBill({ ...bill, address: e.target.value })} /></Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text">Lines</h3>
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <Input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Description" maxLength={200} aria-label={`Line ${i + 1} description`} />
              <Input className="w-32 text-right" type="number" min={0} value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)} inputMode="decimal" aria-label={`Line ${i + 1} amount`} />
              <Button variant="ghost" onClick={() => setItems((c) => c.filter((_, j) => j !== i))} disabled={items.length <= 1} aria-label="Remove line"><Trash2 size={15} className="text-error" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setItems((c) => [...c, { description: '', amount: '0' }])} disabled={items.length >= 20}><Plus size={14} /> Add a line</Button>
        </section>

        <section className="space-y-3 rounded-2xl border border-border p-4">
          <Switch checked={gst} onChange={setGst} label="Show GST on this invoice" description="GST is treated as already included in the amount, so the total does not change." />
          {gst && <Field label="GST rate (%)" className="max-w-[160px]"><Input type="number" min={0} max={40} step={0.5} value={rate} onChange={(e) => setRate(e.target.value)} /></Field>}
          <dl className="space-y-1 text-sm">
            {gst && <div className="flex justify-between text-text-secondary"><dt>Taxable value</dt><dd className="tabular">{inr(parts.sub)}</dd></div>}
            {gst && <div className="flex justify-between text-text-secondary"><dt>GST @ {Number(rate) || 0}% (included)</dt><dd className="tabular">{inr(parts.gst)}</dd></div>}
            <div className="flex justify-between font-semibold text-text"><dt>Total</dt><dd className="tabular text-gold">{inr(total)}</dd></div>
          </dl>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount paid (₹)"><Input type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Transaction ID"><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} /></Field>
          <Field label="Paid on"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label="Notes on the invoice" className="sm:col-span-3"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={600} /></Field>
        </section>

        <details className="rounded-2xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-text">Your details on this invoice (seller)</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Business name"><Input value={seller.name ?? ''} onChange={(e) => setSeller({ ...seller, name: e.target.value })} /></Field>
            <Field label="GST number"><Input value={seller.gstin ?? ''} onChange={(e) => setSeller({ ...seller, gstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>
            <Field label="Phone"><Input value={seller.phone ?? ''} onChange={(e) => setSeller({ ...seller, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={seller.email ?? ''} onChange={(e) => setSeller({ ...seller, email: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={seller.address ?? ''} onChange={(e) => setSeller({ ...seller, address: e.target.value })} /></Field>
            <Field label="Terms" className="sm:col-span-2"><Textarea rows={2} value={seller.terms ?? ''} onChange={(e) => setSeller({ ...seller, terms: e.target.value })} /></Field>
            <Field label="Footer line" className="sm:col-span-2"><Input value={seller.footer ?? ''} onChange={(e) => setSeller({ ...seller, footer: e.target.value })} /></Field>
          </div>
        </details>
      </div>
    </Modal>
  );
}

export function InvoicesTab() {
  const { toast } = useUi();
  const { data = [], isLoading, error } = usePlatformInvoices();
  const [edit, setEdit] = useState<Invoice | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const q = search.trim().toLowerCase();
  const list = useMemo(() => data.filter((i) => !q || [i.number, i.business, i.paymentRef].some((v) => v.toLowerCase().includes(q))), [data, q]);
  const pdf = async (i: Invoice) => { setBusyId(i.id); try { saveBlob(await buildInvoiceBlob(i), invoiceFileName(i)); } catch (e) { toast(e instanceof Error ? e.message : 'Could not make the PDF.', 'error'); } finally { setBusyId(''); } };
  if (isLoading) return <Spinner label="Loading invoices" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;
  const sum = list.reduce((a, i) => a + i.total, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-2xl font-semibold text-text">Invoices</h2><p className="mt-1 max-w-2xl text-sm text-text-secondary">One is created automatically each time you approve a payment. Open one to edit the details, lines or GST, then download the PDF. Your own details and GST on/off are in Settings.</p></div>
        <div className="relative w-full sm:w-72"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" /><Input className="pl-9" placeholder="Search number, business or ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      <Card>
        <CardHeader title={`${list.length} invoice${list.length === 1 ? '' : 's'}`} subtitle={`Total ${inr(sum)}`} action={<FileText size={16} className="text-gold" />} />
        {list.length === 0 ? <EmptyState icon={<FileText />} title="No invoices yet" text="Approve a payment request and its invoice appears here." /> : (
          <ul className="divide-y divide-border/60">
            {list.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text">{i.number} <span className="font-normal text-text-secondary">· {i.business}</span></p><p className="truncate text-xs text-text-secondary">{fmtDate(i.issuedAt)} · {i.items.map((x) => x.description).join(', ')}{i.gstEnabled ? ` · GST ${i.gstRate}%` : ''}</p></div>
                <span className="font-semibold text-text tabular">{inr(i.total)}</span>
                <Button size="sm" variant="outline" onClick={() => void pdf(i)} disabled={busyId === i.id}>{busyId === i.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF</Button>
                <Button size="sm" variant="outline" onClick={() => setEdit(i)}><Pencil size={13} /> Edit</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <EditInvoice key={edit.id} inv={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Settings card: your details printed on every invoice, numbering, and the optional GST. */
export function InvoiceSettingsCard() {
  const { toast } = useUi();
  const { data, isLoading, error } = useInvoiceSettings();
  const { saveInvoiceSettings } = usePlatformExt();
  const [s, setS] = useState<InvoiceSettings | null>(null);
  useEffect(() => { if (data) setS(data); }, [data]);
  if (isLoading || (!s && !error)) return <Spinner label="Loading invoice settings" />;
  if (error || !s) return <Card className="p-6 text-sm text-error">{(error as Error | null)?.message ?? 'Could not load invoice settings.'} Run supabase/18-billing-qr-invoices.sql first.</Card>;
  const set = <K extends keyof InvoiceSettings>(k: K, v: InvoiceSettings[K]) => setS((c) => (c ? { ...c, [k]: v } : c));
  return (
    <Card>
      <CardHeader title="Invoice details" subtitle="Printed on every invoice. You can change any invoice later in the Invoices tab." action={<FileText size={16} className="text-gold" />} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Your business name"><Input value={s.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Eventora OS" /></Field>
        <Field label="Your GST number" hint="add later when you have it"><Input value={s.gstin ?? ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} /></Field>
        <Field label="Phone"><Input value={s.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><Input value={s.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={s.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Terms" className="sm:col-span-2"><Textarea rows={2} value={s.terms ?? ''} onChange={(e) => set('terms', e.target.value)} /></Field>
        <Field label="Footer line" className="sm:col-span-2"><Input value={s.footer ?? ''} onChange={(e) => set('footer', e.target.value)} /></Field>
        <Field label="Invoice number prefix"><Input value={s.prefix} onChange={(e) => set('prefix', e.target.value)} maxLength={10} /></Field>
        <Field label="Next invoice number"><Input type="number" min={1} value={s.next} onChange={(e) => set('next', Math.max(1, Number(e.target.value) || 1))} inputMode="numeric" /></Field>
        <div className="sm:col-span-2 rounded-2xl border border-border p-4">
          <Switch checked={s.gstEnabled} onChange={(v) => set('gstEnabled', v)} label="Show GST on new invoices" description="Off by default. When on, GST is treated as already included in the price (the amount owners pay does not change). You can still switch it per invoice." />
          {s.gstEnabled && <Field label="GST rate (%)" className="mt-4 max-w-[160px]"><Input type="number" min={0} max={40} step={0.5} value={s.gstRate} onChange={(e) => set('gstRate', Number(e.target.value) || 0)} /></Field>}
        </div>
      </div>
      <div className="flex justify-end border-t border-border/70 px-5 py-4"><Button variant="gold" disabled={saveInvoiceSettings.isPending} onClick={() => saveInvoiceSettings.mutate(s, { onSuccess: () => toast('Invoice details saved.'), onError: (e) => toast(e.message, 'error') })}>{saveInvoiceSettings.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</Button></div>
    </Card>
  );
}
