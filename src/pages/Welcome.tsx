import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, CalendarClock, Check, FileText, History, MailCheck, PartyPopper, Search, ShieldCheck, UtensilsCrossed, Users } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { Button, Card, Field, Input, Spinner } from '@/components/ui';
import { keys, savePurchaseProfile, signIn, signUp, usePurchaseStatus, useQuotes, useSubscription } from '@/lib/api';
import { MfaRequiredError } from '@/lib/backend';
import { PLAN_NAME, PRICES } from '@/lib/plans';
import { cn, fmtDate, inr } from '@/lib/format';
import { passwordProblem } from '@/pages/admin/AccountPage';
import type { PurchaseStatus } from '@/lib/types';

type Done = { email: string; businessName: string; reconnected: boolean };

function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-page px-4 py-10 sm:px-8">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[760px] -translate-x-1/2 rounded-full bg-gold/[0.07] blur-3xl" />
      <div className={cn('relative mx-auto', wide ? 'max-w-5xl' : 'max-w-md')}>
        <div className="mb-8 flex justify-center"><Brand subtitle="Venue & event operations" /></div>
        {children}
      </div>
    </main>
  );
}

/** The page people land on after paying. Three things happen here, in this order:
 *  1) the payment is confirmed, 2) the person creates the admin password (or signs in, on a renewal),
 *  3) the business is created automatically (or the OLD one is reconnected) and a quick-start screen opens. */
export function Welcome({ pid }: { pid?: string }) {
  const [typedEmail, setTypedEmail] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const q = usePurchaseStatus({ id: pid, email: lookupEmail }, Boolean(pid || lookupEmail));

  if (done) return <Ready done={done} />;

  if (!pid && !lookupEmail) {
    return (
      <Shell>
        <form onSubmit={(e) => { e.preventDefault(); setLookupEmail(typedEmail.trim().toLowerCase()); }} className="fade-up rounded-3xl border border-border bg-surface p-8 card-glow">
          <span className="grid size-12 place-items-center rounded-2xl bg-gold/12 text-gold"><Search size={22} /></span>
          <h1 className="mt-4 font-display text-2xl font-semibold text-text">Find your payment</h1>
          <p className="mt-2 text-sm text-text-secondary">Enter the email you paid with. We will open your account setup.</p>
          <div className="mt-5"><Field label="Admin email" required><Input type="email" autoComplete="email" value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} required autoFocus /></Field></div>
          <Button type="submit" variant="gold" size="lg" className="mt-5 w-full">Continue</Button>
          <p className="mt-4 text-center text-xs text-text-disabled">Not paid yet? <Link href="/buy" className="text-gold hover:underline">Choose a plan</Link> · Already set up? <Link href="/login" className="text-gold hover:underline">Sign in</Link></p>
        </form>
      </Shell>
    );
  }

  if (q.isLoading) return <Shell><Spinner label="Checking your payment" /></Shell>;
  if (q.error) return <Shell><Notice title="We could not check your payment" text={q.error instanceof Error ? q.error.message : 'Please try again in a moment.'} /></Shell>;
  const p = q.data;
  if (!p || !p.found) {
    return <Shell><Notice title="We could not find that payment" text="Check the email address, or the link you opened. If you paid a few minutes ago, wait a moment and try again." action={<><Link href="/buy"><Button variant="gold" className="w-full">Choose a plan</Button></Link><Link href="/login"><Button className="w-full">Sign in</Button></Link></>} /></Shell>;
  }
  if (p.status === 'pending' || p.status === 'failed') {
    return (
      <Shell>
        <div className="fade-up rounded-3xl border border-border bg-surface p-8 text-center card-glow" role="status" aria-live="polite">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gold/12 text-gold"><CalendarClock size={22} /></span>
          <h1 className="mt-4 font-display text-2xl font-semibold text-text">Waiting for your payment</h1>
          <p className="mt-2 text-sm text-text-secondary">As soon as Razorpay confirms it, this page moves on by itself. This can take a minute.</p>
          <Spinner label="Waiting" />
        </div>
      </Shell>
    );
  }
  return <Onboard p={p} pid={pid} lookupEmail={lookupEmail} onDone={setDone} />;
}

function Notice({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="fade-up rounded-3xl border border-border bg-surface p-8 text-center card-glow">
      <h1 className="font-display text-2xl font-semibold text-text">{title}</h1>
      <p className="mt-2 text-sm text-text-secondary">{text}</p>
      {action && <div className="mt-6 space-y-2">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ main page */

function Onboard({ p, pid, lookupEmail, onDone }: { p: PurchaseStatus; pid?: string; lookupEmail: string; onDone: (d: Done) => void }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const email = (p.email ?? lookupEmail).toLowerCase();
  const existing = Boolean(p.hasAccount);            // a login with this email already exists -> sign in instead of creating
  const renewal = Boolean(p.hasWorkspace);           // the business exists already -> it is reconnected, nothing new is created
  const [name, setName] = useState(p.businessName ?? '');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmMail, setConfirmMail] = useState(false);
  const [mfa, setMfa] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!existing) {
      const pw = passwordProblem(password);
      if (pw) { setError(pw); return; }
      if (password !== again) { setError('The two passwords are not the same.'); return; }
    } else if (!password) { setError('Enter your password.'); return; }
    setBusy(true);
    try {
      if (pid && !renewal && name.trim()) await savePurchaseProfile(pid, name.trim());
      if (!existing) {
        const { hasSession } = await signUp(email, password);
        if (!hasSession) { setConfirmMail(true); return; }   // the project asks people to confirm their email first
      }
      // Signing in is what creates the business automatically (or reconnects the old one).
      const s = await signIn(email, password);
      qc.clear();
      await qc.refetchQueries({ queryKey: keys.session });
      onDone({ email: s.email, businessName: s.tenantName ?? (name.trim() || ''), reconnected: renewal });
    } catch (err) {
      if (err instanceof MfaRequiredError) setMfa(true);
      else setError(err instanceof Error ? err.message : 'Could not finish the setup.');
    } finally { setBusy(false); }
  };

  const plan = p.period ? PRICES[p.period] : null;
  const steps = [
    { title: 'Payment received', text: plan ? `${PLAN_NAME} · ${plan.label}${p.amount ? ` · ${inr(p.amount)}` : ''}` : PLAN_NAME, state: 'done' as const },
    { title: existing ? 'Sign in as admin' : 'Create your admin login', text: existing ? 'Use your existing password.' : 'Choose a password. It is only for you.', state: 'now' as const },
    { title: renewal ? 'Your workspace is reconnected' : 'Your workspace is created', text: renewal ? 'Bills, catalog, team and settings come back exactly as you left them.' : 'Business, admin rights and your plan are set up automatically.', state: 'next' as const },
  ];

  return (
    <Shell wide>
      <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr]">
        {/* left: what just happened and what happens next */}
        <div className="fade-up rounded-3xl border border-gold/25 bg-gradient-to-br from-surface to-page p-8 card-glow">
          <span className="grid size-12 place-items-center rounded-2xl bg-success-bg text-success"><PartyPopper size={22} /></span>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">{renewal ? 'Plan renewed' : 'Payment received'}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-text sm:text-4xl">{renewal ? `Welcome back${p.workspaceName ? `, ${p.workspaceName}` : ''}.` : 'Thank you. Let’s open your workspace.'}</h1>
          <p className="mt-3 text-sm text-text-secondary">
            {renewal
              ? 'Your plan is active again. Sign in with the same admin email and everything you saved before is connected to you again.'
              : 'One last step: set your admin password. We create your business and give you owner (admin) rights automatically.'}
          </p>
          {p.periodEnd && <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-success-bg px-3 py-1 text-xs font-medium text-success"><Check size={12} /> Active until {fmtDate(p.periodEnd)}</p>}

          <ol className="mt-8 space-y-5">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold', s.state === 'done' ? 'border-success/40 bg-success-bg text-success' : s.state === 'now' ? 'border-gold bg-gold text-text-on-gold' : 'border-border text-text-disabled')}>
                  {s.state === 'done' ? <Check size={14} /> : i + 1}
                </span>
                <div><p className={cn('text-sm font-semibold', s.state === 'next' ? 'text-text-secondary' : 'text-text')}>{s.title}</p><p className="text-xs text-text-secondary">{s.text}</p></div>
              </li>
            ))}
          </ol>
        </div>

        {/* right: the form */}
        {confirmMail ? (
          <div className="fade-up rounded-3xl border border-border bg-surface p-8 text-center card-glow">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gold/12 text-gold"><MailCheck size={22} /></span>
            <h2 className="mt-4 font-display text-2xl font-semibold text-text">Confirm your email</h2>
            <p className="mt-2 text-sm text-text-secondary">We sent a link to <strong className="text-text">{email}</strong>. Open it, then sign in. Your business and admin login are created automatically at your first sign-in. Nothing else to do.</p>
            <Link href="/login"><Button variant="gold" size="lg" className="mt-6 w-full">Go to sign in</Button></Link>
          </div>
        ) : mfa ? (
          <div className="fade-up rounded-3xl border border-border bg-surface p-8 text-center card-glow">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gold/12 text-gold"><ShieldCheck size={22} /></span>
            <h2 className="mt-4 font-display text-2xl font-semibold text-text">One more check</h2>
            <p className="mt-2 text-sm text-text-secondary">Two-step verification is on for this login. Sign in on the sign-in page and enter your 6-digit code. Your workspace is reconnected right after.</p>
            <Link href="/login"><Button variant="gold" size="lg" className="mt-6 w-full">Go to sign in</Button></Link>
          </div>
        ) : (
          <form onSubmit={submit} className="fade-up rounded-3xl border border-border bg-surface p-8 card-glow">
            <h2 className="font-display text-2xl font-semibold text-text">{existing ? 'Sign in to continue' : 'Create your admin login'}</h2>
            <p className="mt-1 text-xs text-text-secondary">{existing ? 'This email already has a login.' : 'You will be the owner of this workspace.'}</p>
            <div className="mt-6 space-y-4">
              <Field label="Admin email"><Input value={email} readOnly disabled /></Field>
              {pid && !renewal && <Field label="Business name" hint="shown on your bills · you can change it later"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Royal Banquet Hall" autoComplete="organization" /></Field>}
              <Field label={existing ? 'Password' : 'Choose a password'} required hint={existing ? undefined : '10+ characters, a letter and a number'}>
                <Input type="password" autoComplete={existing ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              </Field>
              {!existing && <Field label="Repeat password" required error={error}><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>}
              {existing && error && <p role="alert" className="text-xs text-error">{error}</p>}
            </div>
            <Button type="submit" variant="gold" size="lg" className="mt-6 w-full" disabled={busy}>{busy ? 'Setting things up…' : existing ? 'Sign in and open workspace' : 'Create admin and open workspace'} {!busy && <ArrowRight size={16} />}</Button>
            <p className="mt-4 text-center text-xs text-text-disabled">{existing ? <>Different email? <button type="button" className="text-gold hover:underline" onClick={() => navigate('/welcome')}>Start again</button></> : <>Wrong email? <Link href="/buy" className="text-gold hover:underline">Buy again with the right one</Link></>}</p>
          </form>
        )}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ the quick-start screen */

function Ready({ done }: { done: Done }) {
  const { sub } = useSubscription();
  const bills = useQuotes();
  const count = bills.data?.length ?? 0;
  const tiles = done.reconnected
    ? [
        { href: '/admin', icon: Building2, title: 'Open your dashboard', text: 'Revenue, bookings and activity as you left them.' },
        { href: '/admin/quotes', icon: FileText, title: 'Your bills & payments', text: count > 0 ? `${count} bill${count === 1 ? '' : 's'} are right where you left them.` : 'All your bills and payments.' },
        { href: '/admin/settings', icon: Users, title: 'Your team', text: 'Employees and their permissions are unchanged.' },
        { href: '/admin/activity', icon: History, title: 'Activity history', text: 'The full record continues without a gap.' },
      ]
    : [
        { href: '/admin/settings', icon: Building2, title: 'Add business details', text: 'Name, address, GST number and logo for your PDF bills.' },
        { href: '/admin/catalog', icon: UtensilsCrossed, title: 'Set your menu & prices', text: 'Edit the catalog your quotations are built from.' },
        { href: '/admin/settings', icon: Users, title: 'Invite your employees', text: 'Create their logins in Settings → Team.' },
        { href: '/admin/new', icon: FileText, title: 'Make your first quotation', text: 'Pick services and see the price live.' },
      ];
  return (
    <Shell wide>
      <div className="fade-up text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success-bg text-success"><Check size={26} /></span>
        <h1 className="mt-5 font-display text-3xl font-semibold text-text sm:text-4xl">{done.reconnected ? 'Welcome back. Everything is here.' : 'Your workspace is ready.'}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-text-secondary">
          {done.reconnected ? 'Your old business is reconnected to ' : 'You are the owner (admin) of '}
          <strong className="text-text">{done.businessName || 'your business'}</strong> as <strong className="text-text">{done.email}</strong>
          {sub?.currentPeriodEnd ? <>. Plan active until <strong className="text-text">{fmtDate(sub.currentPeriodEnd)}</strong>.</> : '.'}
        </p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {tiles.map(({ href, icon: Icon, title, text }) => (
          <Link key={title} href={href} className="group block">
            <Card className="flex h-full items-start gap-4 p-5 transition-colors group-hover:border-gold/50">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-hover text-gold"><Icon size={20} /></span>
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-text">{title}</p><p className="mt-1 text-xs text-text-secondary">{text}</p></div>
              <ArrowRight size={16} className="mt-1 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-gold" />
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-8 flex justify-center"><Link href="/admin"><Button variant="gold" size="lg">Open dashboard <ArrowRight size={16} /></Button></Link></div>
    </Shell>
  );
}
