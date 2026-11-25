import { useState, type FormEvent } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck, Eye, EyeOff, FileText, ShieldCheck, Wallet } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Field, Input } from '@/components/ui';
import { keys, signIn, signOut, useSession, verifyMfa } from '@/lib/api';
import { MfaRequiredError } from '@/lib/backend';
import { WELCOME_FLAG } from '@/components/Shell';

const MAX_TRIES = 5;
const LOCK_SECONDS = 30;

export function Login() {
  const { session, loading, isAdmin } = useSession();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  if (!loading && session) return <Redirect to={isAdmin ? '/admin' : '/admin/new'} />;

  const done = async (role: 'admin' | 'staff') => { try { window.sessionStorage.setItem(WELCOME_FLAG, '1'); } catch { /* ignore */ } qc.clear(); await qc.refetchQueries({ queryKey: keys.session }); navigate(role === 'admin' ? '/admin' : '/admin/new'); };
  const fail = (message: string) => {
    const n = fails + 1;
    setFails(n);
    if (n >= MAX_TRIES) { setLockedUntil(Date.now() + LOCK_SECONDS * 1000); setFails(0); setError(`Too many tries. Wait ${LOCK_SECONDS} seconds and try again.`); }
    else setError(message);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) { setError(`Too many tries. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)} seconds.`); return; }
    setBusy(true); setError('');
    try {
      if (factorId) { const s = await verifyMfa(factorId, code); await done(s.role); }
      else { const s = await signIn(email.trim(), password); await done(s.role); }
    } catch (err) {
      if (err instanceof MfaRequiredError) { setFactorId(err.factorId); setCode(''); }
      else fail(err instanceof Error ? err.message : 'Could not sign in.');
    } finally { setBusy(false); }
  };

  const cancelMfa = async () => { setFactorId(''); setCode(''); setPassword(''); setError(''); try { await signOut(); } catch { /* ignore */ } };

  return (
    <main className="grid min-h-dvh bg-page lg:grid-cols-[1.05fr_1fr]">
      {/* left: navy brand panel (hidden on phones) */}
      <aside className="sidebar-dark relative hidden flex-col justify-between overflow-hidden bg-brand p-12 lg:flex">
        <div className="pointer-events-none absolute -right-32 -top-32 size-[420px] rounded-full bg-gold/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[420px] rounded-full bg-gold/10 blur-3xl" />
        <div className="relative"><Brand size="lg" subtitle="Venue & event operations" onDark /></div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-text">Run every event, quote and payment from one place.</h2>
          <ul className="mt-10 space-y-5">
            {[
              [FileText, 'Professional quotations', 'Itemised bills with GST, discounts and a ready-to-share PDF.'],
              [CalendarCheck, 'No double bookings', 'A live calendar checks every hall and time slot for you.'],
              [Wallet, 'Payments under control', 'Track advances, balances and UPI collections per event.'],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof FileText;
              return (
                <li key={title as string} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-gold"><I size={19} /></span>
                  <span><span className="block text-sm font-semibold text-text">{title as string}</span><span className="block text-sm text-text-secondary">{text as string}</span></span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative text-xs text-text-disabled">© Eventora OS</p>
      </aside>

      {/* right: the form */}
      <section className="relative grid place-items-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden"><Brand size="lg" subtitle="Venue & event operations" /></div>
          <form onSubmit={submit} className="fade-up rounded-3xl border border-border bg-surface p-8 card-glow">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-text">{factorId ? 'Two-step verification' : 'Welcome back'}</h1>
              <p className="mt-1 text-sm text-text-secondary">{factorId ? 'Open your authenticator app and enter the 6-digit code.' : 'Sign in to your owner or employee workspace.'}</p>
            </div>
            {factorId ? (
              <Field label="6-digit code" required error={error}><Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoFocus required /></Field>
            ) : (
              <div className="space-y-4">
                <Field label="Email" required><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required /></Field>
                <Field label="Password" required error={error}>
                  <div className="relative">
                    <Input type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" required />
                    <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-text-secondary hover:bg-surface-hover hover:text-text">{showPw ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </div>
                </Field>
              </div>
            )}
            <Button type="submit" variant="gold" size="lg" className="mt-6 w-full" loading={busy}>{busy ? 'Please wait…' : factorId ? 'Verify and sign in' : 'Sign in'}</Button>
            {factorId && <button type="button" onClick={() => void cancelMfa()} className="mt-4 w-full text-center text-xs text-text-secondary hover:text-gold">Cancel and go back</button>}
          </form>
          <p className="mt-4 text-center text-xs text-text-disabled">New business? <Link href="/request-access" className="text-gold hover:underline">Request access</Link>. Eventora creates your owner login for you. Employees: your owner creates your login.</p>
          <Link href="/" className="mt-4 flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-gold"><ArrowLeft size={14} /> Back to home</Link>
        </div>
      </section>
    </main>
  );
}
