import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, CheckCircle2, Loader2, Mail, MessageCircle, Phone, Send } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Field, Input, Textarea } from '@/components/ui';
import { submitLead, usePublicContact } from '@/lib/apiExt';
import { whatsappLink } from '@/lib/settings';

/** Eventora accounts are added by the Eventora team. This page tells visitors how to ask for one. */
export function RequestAccess() {
  const { contact } = usePublicContact();
  const [form, setForm] = useState({ name: '', business: '', phone: '', email: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const wa = contact.whatsapp.replace(/\D/g, '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await submitLead(form); setDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not send. Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-page px-4 py-10">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-gold/[0.06] blur-3xl" />
      <div className="relative w-full max-w-lg">
        <div className="mb-8 flex justify-center"><Brand size="lg" subtitle="Venue & event operations" /></div>
        <div className="fade-up rounded-3xl border border-border bg-surface p-8 card-glow">
          {done ? (
            <div className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success-bg text-success"><CheckCircle2 size={26} /></span>
              <h1 className="mt-5 font-display text-2xl font-semibold text-text">Thank you</h1>
              <p className="mt-2 text-sm text-text-secondary">We received your details and will contact you soon to set up your workspace.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div><h1 className="font-display text-2xl font-semibold text-text">Request access</h1><p className="mt-1 text-sm text-text-secondary">Tell us about your venue. We create your owner login and switch your workspace on.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" required /></Field>
                <Field label="Business name"><Input value={form.business} onChange={(e) => set('business', e.target.value)} placeholder="Party plot, banquet, restaurant" /></Field>
                <Field label="Mobile"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" autoComplete="tel" /></Field>
                <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" /></Field>
              </div>
              <Field label="Message" hint="optional"><Textarea rows={3} value={form.message} onChange={(e) => set('message', e.target.value)} maxLength={600} /></Field>
              {error && <p className="text-sm text-error" role="alert">{error}</p>}
              <Button type="submit" variant="gold" size="lg" className="w-full" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send request</Button>
            </form>
          )}
          {(wa || contact.phone || contact.email) && (
            <div className="mt-6 flex flex-wrap justify-center gap-2 border-t border-border/70 pt-5">
              {wa && <a href={whatsappLink(wa, 'Hello, I would like to use Eventora OS for my venue.')} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><MessageCircle size={14} /> WhatsApp</Button></a>}
              {contact.phone && <a href={`tel:${contact.phone}`}><Button variant="outline" size="sm"><Phone size={14} /> {contact.phone}</Button></a>}
              {contact.email && <a href={`mailto:${contact.email}`}><Button variant="outline" size="sm"><Mail size={14} /> {contact.email}</Button></a>}
            </div>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-text-disabled">Already have a login? <Link href="/login" className="text-gold hover:underline">Sign in</Link></p>
        <Link href="/" className="mt-4 flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-gold"><ArrowLeft size={14} /> Back to home</Link>
      </div>
    </main>
  );
}
