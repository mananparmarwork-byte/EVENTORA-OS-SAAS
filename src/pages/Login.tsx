import { useState, type FormEvent } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck, Eye, EyeOff, FileText, Lock, ShieldCheck, Wallet } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Field, Input } from '@/components/ui';
import { WELCOME_FLAG } from '@/components/Shell';
import { keys, signIn, signOut, useSession, verifyMfa } from '@/lib/api';
import { MfaRequiredError } from '@/lib/backend';

const MAX_TRIES = 5;
const LOCK_SECONDS = 30;

export function Login() {
  const { session, loading, isAdmin } = useSession();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
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

  const points = [[FileText, 'Quotations and tax invoices in minutes'], [CalendarCheck, 'Bookings with clash-free dates and times'], [Wallet, 'Payments, balances and reminders in one place']] as const;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <aside className="sidebar-dark relative hidden overflow-hidden bg-sidebar p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-32 -top-32 size-[480px] rounded-full bg-[#3478F6]/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[420px] rounded-full bg-[#3478F6]/10 blur-3xl" />
        <div className="logo-in relative"><Brand size="lg" subtitle="Venue & event operations" onDark /></div>
        <div className="relative max-w-md">
          <h2 className="fade-up text-4xl font-semibold leading-tight text-white" style={{ animationDelay: '.15s' }}>Run every event, booking and payment from one calm workspace.</h2>
          <ul className="mt-8 space-y-4">
            {points.map(([Icon, text], i) => (
              <li key={text} className="fade-up flex items-center gap-3 text-sm text-text-secondary" style={{ animationDelay: `${0.3 + i * 0.12}s` }}><span className="grid size-9 place-items-center rounded-xl bg-white/10 text-gold"><Icon size={17} /></span>{text}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-text-disabled">Eventora OS</p>
      </aside>

      {/* form */}
      <section className="relative grid place-items-center bg-page px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden"><Brand size="lg" subtitle="Venue & event operations" /></div>
          <form onSubmit={submit} className="fade-up rounded-2xl border border-border bg-surface p-8 card-glow">
            <div className="mb-6 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-gold/10 text-gold">{factorId ? <ShieldCheck size={20} /> : <Lock size={20} />}</span>
              <div>
                <h1 className="text-2xl font-semibold text-text">{factorId ? 'Two-step verification' : 'Welcome back'}</h1>
                <p className="text-xs text-text-secondary">{factorId ? 'Open your authenticator app' : 'Sign in to your owner or employee workspace'}</p>
              </div>
            </div>
            {factorId ? (
              <Field label="6-digit code" required error={error}><Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoFocus required /></Field>
            ) : (
              <div className="space-y-4">
                <Field label="Email" required><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required /></Field>
                <Field label="Password" required error={error} as="div">
                  <div className="relative">
                    <Input type={show ? 'text' : 'password'} autoComplete="current-password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" required />
                    <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </div>
                </Field>
              </div>
            )}
            <Button type="submit" variant="gold" size="lg" className="mt-6 w-full" loading={busy}>{busy ? 'Signing in…' : factorId ? 'Verify and sign in' : 'Sign in'}</Button>
            {factorId && <button type="button" onClick={() => void cancelMfa()} className="mt-4 w-full text-center text-xs text-text-secondary transition-colors hover:text-gold">Cancel and go back</button>}
          </form>
        <p className="mt-4 text-center text-xs text-text-disabled">New business? <Link href="/buy" className="text-gold hover:underline">Choose a plan</Link> or <Link href="/signup" className="text-gold hover:underline">start a free trial</Link>. Already paid, no login yet? <Link href="/welcome" className="text-gold hover:underline">Set up your admin login</Link>. Employees: your owner creates your login.</p>
          <Link href="/" className="mt-4 flex items-center justify-center gap-2 text-sm text-text-secondary transition-colors hover:text-gold"><ArrowLeft size={14} /> Back to home</Link>
        </div>
      </section>
    </main>
  );
}
