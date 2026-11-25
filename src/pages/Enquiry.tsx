import { useState, type FormEvent, type ReactNode } from 'react';
import { CalendarCheck, CheckCircle2, Loader2, Phone, Send } from 'lucide-react';
import { Button, Field, Input, Select, Spinner } from '@/components/ui';
import { DatePicker } from '@/components/DatePicker';
import { LogoText } from '@/components/Logo';
import { useEnquiryInfo, useSubmitEnquiry } from '@/lib/api';
import { isRangeComplete, isRangeValid, normalizeRange } from '@/lib/booking';
import { formatEventDates, localISODate, parseEventDates } from '@/lib/format';
import type { EventSlots } from '@/lib/types';

const EVENT_TYPES = ['Wedding', 'Reception', 'Engagement', 'Birthday', 'Anniversary', 'Corporate', 'Other'];

type Form = { name: string; mobile: string; email: string; eventType: string; otherEventType: string; guests: string; eventDate: string; branchId: string; website: string };
const EMPTY: Form = { name: '', mobile: '', email: '', eventType: '', otherEventType: '', guests: '150', eventDate: '', branchId: '', website: '' };
type Errors = Partial<Record<keyof Form, string>>;

/**
 * The public page a business puts on its website:  https://your-site/#/enquiry/<business-slug>
 * It is the same "Event details" form as the bill form, but without bill number, GST and PAN, and without any prices.
 * Every submission becomes ONE new draft bill (its own bill number) in that business's Quotations → Drafts.
 */
export function Enquiry({ slug }: { slug: string }) {
  const info = useEnquiryInfo(slug);
  const submit = useSubmitEnquiry(slug);
  const [form, setForm] = useState<Form>(EMPTY);
  const [slots, setSlots] = useState<EventSlots>({});
  const [errors, setErrors] = useState<Errors>({});
  const [sent, setSent] = useState<{ reference: string; name: string } | null>(null);
  const [problem, setProblem] = useState('');

  const set = (k: keyof Form, v: string) => { setForm((f) => ({ ...f, [k]: v })); if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined })); };

  const data = info.data;
  const branches = data?.branches ?? [];
  const multi = branches.length > 1;
  const dates = parseEventDates(form.eventDate);
  const slotsForDates: EventSlots = Object.fromEntries(dates.map((d) => [d, normalizeRange(slots[d])]));

  const validate = () => {
    const e: Errors = {};
    if (form.name.trim().length < 2) e.name = 'Please enter your name.';
    if (!/^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, '').slice(-10))) e.mobile = 'Enter a valid 10-digit mobile number.';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid e-mail address.';
    if (!form.eventType) e.eventType = 'Choose an event type.';
    if (form.eventType === 'Other' && !form.otherEventType.trim()) e.otherEventType = 'Tell us the occasion.';
    const g = Number(form.guests);
    if (!Number.isInteger(g) || g <= 0) e.guests = 'Enter the number of guests.';
    if (!dates.length) e.eventDate = 'Choose at least one event date.';
    else if (dates.some((d) => d < localISODate(new Date()))) e.eventDate = 'Choose dates from today onwards.';
    else {
      // times are optional here, but a half-filled time is not
      const half = dates.find((d) => { const r = slotsForDates[d]; return (r?.start || r?.end) && !isRangeComplete(r); });
      const bad = dates.find((d) => isRangeComplete(slotsForDates[d]) && !isRangeValid(slotsForDates[d]));
      if (half) e.eventDate = `Enter both the start and end time for ${formatEventDates([half])}, or leave the time empty.`;
      else if (bad) e.eventDate = `End time must be after the start time on ${formatEventDates([bad])}.`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    if (submit.isPending || !validate()) return;
    setProblem('');
    const slotOut: EventSlots = {};
    dates.forEach((d) => { if (isRangeComplete(slotsForDates[d]) && isRangeValid(slotsForDates[d])) slotOut[d] = slotsForDates[d]; });
    submit.mutate(
      {
        name: form.name.trim(), mobile: form.mobile.trim(), email: form.email.trim(),
        eventType: form.eventType === 'Other' ? form.otherEventType.trim() : form.eventType,
        guests: Number(form.guests), dates, slots: slotOut,
        branchId: multi ? form.branchId || branches[0]?.id : undefined, website: form.website,
      },
      { onSuccess: (r) => setSent({ reference: r.reference, name: form.name.trim() }), onError: (err) => setProblem(err.message) },
    );
  };

  const again = () => { setSent(null); setForm(EMPTY); setSlots({}); setErrors({}); setProblem(''); };

  /* ---- shell ---- */
  const frame = (children: ReactNode) => (
    <main className="min-h-dvh bg-page px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        {children}
        <p className="mt-8 flex items-center justify-center gap-2 text-[11px] text-text-disabled">Powered by <LogoText height={11} /></p>
      </div>
    </main>
  );

  if (info.isLoading) return frame(<Spinner label="Opening the form" />);
  if (info.error) return frame(<div className="rounded-3xl border border-border bg-surface p-8 text-center"><h1 className="font-display text-xl font-semibold text-text">This form is not available</h1><p className="mt-2 text-sm text-text-secondary">{(info.error as Error).message}</p></div>);
  if (!data?.found) return frame(<div className="rounded-3xl border border-border bg-surface p-8 text-center"><h1 className="font-display text-xl font-semibold text-text">Link not found</h1><p className="mt-2 text-sm text-text-secondary">This enquiry link is not valid. Please ask the business for the correct link.</p></div>);

  const header = (
    <div className="mb-6 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gold/15 text-xl font-semibold text-gold">{(data.name || '?').trim().charAt(0).toUpperCase()}</span>
      <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-text">{data.name}</h1>
      <p className="mt-1.5 text-sm text-text-secondary">Tell us about your event and we will call you back with a quotation.</p>
    </div>
  );

  if (!data.open) {
    return frame(<>{header}<div className="rounded-3xl border border-border bg-surface p-8 text-center"><p className="text-sm text-text-secondary">We are not taking online enquiries right now.{data.phone ? ' Please call us:' : ''}</p>{data.phone && <a href={`tel:${data.phone}`} className="mt-4 inline-block"><Button variant="gold"><Phone size={15} /> {data.phone}</Button></a>}</div></>);
  }

  if (sent) {
    return frame(
      <div className="fade-up rounded-3xl border border-border bg-surface p-8 text-center card-glow">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success-bg text-success"><CheckCircle2 size={26} /></span>
        <h1 className="mt-5 font-display text-2xl font-semibold text-text">Thank you, {sent.name.split(' ')[0]}!</h1>
        <p className="mt-2 text-sm text-text-secondary">We received your details. The {data.name} team will call you soon to discuss your event and share your quotation.</p>
        {sent.reference && <p className="mt-4 inline-block rounded-lg bg-input px-3 py-1.5 text-xs text-text-secondary">Your enquiry number: <span className="font-mono font-semibold text-gold">{sent.reference}</span></p>}
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          {data.phone && <a href={`tel:${data.phone}`}><Button variant="outline"><Phone size={15} /> Call us</Button></a>}
          <Button variant="soft" onClick={again}>Send another enquiry</Button>
        </div>
      </div>,
    );
  }

  return frame(
    <>
      {header}
      <form onSubmit={onSubmit} noValidate className="fade-up overflow-hidden rounded-3xl border border-border bg-surface card-glow">
        <div className="border-b border-border/70 px-6 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">Your enquiry</p><h2 className="text-base font-semibold text-text">Event details</h2></div>
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label="Your name" required error={errors.name}><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" autoComplete="name" maxLength={80} /></Field>
          <Field label="Mobile number" required error={errors.mobile} hint="10 digits"><Input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} inputMode="tel" placeholder="98765 43210" autoComplete="tel" maxLength={16} /></Field>
          <Field label="E-mail" error={errors.email} hint="Optional"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value.trim())} inputMode="email" placeholder="name@example.com" autoComplete="email" maxLength={120} /></Field>
          <Field label="Event type" required error={errors.eventType}>
            <Select value={form.eventType} onChange={(e) => set('eventType', e.target.value)}><option value="">Choose event type</option>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          </Field>
          {form.eventType === 'Other' ? <Field label="Occasion" required error={errors.otherEventType}><Input value={form.otherEventType} onChange={(e) => set('otherEventType', e.target.value)} placeholder="e.g. Baby shower" maxLength={50} /></Field> : <div className="hidden sm:block" />}
          <Field label="Number of guests" required error={errors.guests}><Input type="number" min={1} value={form.guests} onChange={(e) => set('guests', e.target.value)} inputMode="numeric" /></Field>
          {multi && (
            <Field label="Branch" hint="Where is your event?">
              <Select value={form.branchId || branches[0]?.id} onChange={(e) => set('branchId', e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            </Field>
          )}
          <Field as="div" label="Event date & time" required hint="Time is optional" className="sm:col-span-2">
            <DatePicker value={form.eventDate} slots={slots} booked={{}} error={errors.eventDate} onChange={(v) => set('eventDate', v)} onSlotsChange={setSlots} />
          </Field>
          {/* honeypot: invisible to people, bots fill it and are ignored */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} /></label></div>
        </div>
        <div className="space-y-3 border-t border-border/70 bg-input/40 px-6 py-5">
          {problem && <p role="alert" className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error">{problem}</p>}
          <Button type="submit" variant="gold" size="lg" className="w-full" disabled={submit.isPending}>{submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send my enquiry</Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-text-disabled"><CalendarCheck size={12} /> No payment needed. We will call you to confirm the details and prepare your quotation.</p>
        </div>
      </form>
    </>,
  );
}
