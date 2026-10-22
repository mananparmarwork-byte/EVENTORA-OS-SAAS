import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MailCheck, Rocket } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Field, Input } from '@/components/ui';
import { createTenant, keys, signIn, signUp } from '@/lib/api';
import { passwordProblem } from '@/pages/admin/AccountPage';
import { savePendingTenant } from '@/lib/backend';

const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function Signup() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmMail, setConfirmMail] = useState(false);

  const address = slugTouched ? slug : slugify(name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const pwErr = passwordProblem(password);
    if (pwErr) { setError(pwErr); return; }
    if (address.length < 3) { setError('Choose a short business name with at least 3 letters or numbers.'); return; }
    setBusy(true);
    try {
      const { hasSession } = await signUp(email.trim(), password);
      if (!hasSession) {
        // The project asks people to confirm their email first: the business is created at their first sign-in.
        savePendingTenant(name.trim(), address);
        setConfirmMail(true);
        return;
      }
      await createTenant(name.trim(), address);
      await signIn(email.trim(), password).catch(() => undefined);
      qc.clear();
      await qc.refetchQueries({ queryKey: keys.session });
      navigate('/admin');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create your account.'); }
    finally { setBusy(false); }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-page px-4 py-10">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-gold/[0.06] blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center"><Brand subtitle="Venue & event operations" /></div>
        {confirmMail ? (
          <div className="fade-up rounded-3xl border border-border bg-surface p-8 text-center card-glow">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gold/12 text-gold"><MailCheck size={22} /></span>
            <h1 className="mt-4 font-display text-2xl font-semibold text-text">Check your email</h1>
            <p className="mt-2 text-sm text-text-secondary">We sent a confirmation link to <strong className="text-text">{email}</strong>. Open it, then sign in. Your business <strong className="text-text">{name}</strong> is created automatically at your first sign-in.</p>
            <Link href="/login"><Button variant="gold" className="mt-6 w-full" size="lg">Go to sign in</Button></Link>
          </div>
        ) : (
          <form onSubmit={submit} className="fade-up rounded-3xl border border-border bg-surface p-8 card-glow">
            <div className="mb-6 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-gold/12 text-gold"><Rocket size={20} /></span>
              <div><h1 className="font-display text-2xl font-semibold text-text">Start your free trial</h1><p className="text-xs text-text-secondary">Free trial · no card needed</p></div>
            </div>
            <div className="space-y-4">
              <Field label="Business name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Royal Banquet Hall" required /></Field>
              <Field label="Short business name" required hint="a short unique ID, e.g. royal-banquet">
                <div className="flex items-center overflow-hidden rounded-xl border border-border bg-input focus-within:border-gold">
                                    <input value={address} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} className="h-11 min-w-0 flex-1 bg-transparent px-3.5 text-sm text-text outline-none" placeholder="royal-banquet" aria-label="Short business name" />
                </div>
              </Field>
              <Field label="Your email" required><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
              <Field label="Password" required error={error} hint="10+ characters, a letter and a number"><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            </div>
            <Button type="submit" variant="gold" size="lg" className="mt-6 w-full" disabled={busy}>{busy ? 'Creating your workspace…' : 'Create my account'}</Button>
            <p className="mt-4 text-center text-xs text-text-disabled">Already have an account? <Link href="/login" className="text-gold hover:underline">Sign in</Link></p>
          </form>
        )}
        <Link href="/" className="mt-6 flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-gold"><ArrowLeft size={14} /> Back to home</Link>
      </div>
    </main>
  );
}
