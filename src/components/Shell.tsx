import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, ChevronDown, CornerDownLeft, FileText, LogOut, Search, ShieldCheck, Wallet } from 'lucide-react';
import { Brand, LogoMark } from '@/components/Logo';
import { cn, initials, inr } from '@/lib/format';
import { useQuotes, usePlans, useSubscription } from '@/lib/api';
import { quoteDates, quotePaymentState } from '@/lib/pricing';
import { upcoming } from '@/lib/stats';
import { planName } from '@/lib/plans';
import { statusLine } from '@/pages/admin/BillingPage';

/* ---- small helpers ---- */
export const WELCOME_FLAG = 'eventora-welcome';
/** "rohit.shah@x.com" -> "Rohit Shah" */
export function friendlyName(email: string) {
  return email.split('@')[0].split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') || 'there';
}
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, close, ref]);
}

/* ---- branded loading + welcome ---- */
export function BrandedLoader({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-dvh place-items-center bg-sidebar">
      <div className="text-center"><div className="breathe inline-block"><LogoMark size={60} /></div>
        <div className="mx-auto mt-6 h-[3px] w-28 overflow-hidden rounded bg-[#243759]"><div className="h-full w-2/5 rounded bg-gold" style={{ animation: 'bar-run 1.1s ease-in-out infinite' }} /></div>
        <p className="mt-3 text-xs tracking-wide text-[#A5B4CF]">{label}…</p></div>
    </div>
  );
}

/** Short, skippable greeting shown once right after signing in. */
export function WelcomeSplash({ name, business, onDone }: { name: string; business?: string; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t1 = window.setTimeout(() => setLeaving(true), reduce ? 500 : 1700);
    const t2 = window.setTimeout(onDone, reduce ? 600 : 2150);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [onDone]);
  return (
    <div role="dialog" aria-label="Welcome" onClick={() => { setLeaving(true); window.setTimeout(onDone, 250); }}
      className={cn('fixed inset-0 z-[80] grid cursor-pointer place-items-center bg-sidebar transition-opacity duration-500', leaving && 'opacity-0')}>
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-[#3478F6]/15 blur-3xl" />
      <div className="relative px-6 text-center">
        <div className="logo-in inline-block"><LogoMark size={68} /></div>
        <p className="fade-up mt-7 text-sm font-medium tracking-wide text-[#A5B4CF]" style={{ animationDelay: '.25s' }}>Welcome back!</p>
        <h1 className="fade-up mt-1 text-3xl font-semibold text-white sm:text-4xl" style={{ animationDelay: '.4s' }}>{name}</h1>
        {business && <p className="fade-up mt-2 text-sm text-[#7C8CAB]" style={{ animationDelay: '.55s' }}>{business}</p>}
      </div>
    </div>
  );
}

/* ---- search / jump palette (Ctrl+K) ---- */
export type NavLite = { href: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> };
export function CommandSearch({ items }: { items: NavLite[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [, navigate] = useLocation();
  const { data: quotes = [] } = useQuotes();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (open) { setQ(''); setActive(0); document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; } }, [open]);

  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    const pages = items.filter((i) => !needle || i.label.toLowerCase().includes(needle)).map((i) => ({ key: i.href, href: i.href, title: i.label, sub: 'Go to page', icon: i.icon }));
    const bills = needle.length < 2 ? [] : quotes.filter((x) => [x.reference, x.customer.name, x.customer.eventType, x.customer.phone ?? ''].some((v) => String(v).toLowerCase().includes(needle))).slice(0, 6)
      .map((x) => ({ key: x.reference, href: `/admin/quotes/${encodeURIComponent(x.reference)}`, title: `${x.customer.name} · ${x.customer.eventType}`, sub: `${x.reference} · ${x.status}`, icon: FileText }));
    return [...bills, ...pages];
  }, [items, quotes, needle]);
  const go = (href: string) => { setOpen(false); navigate(href); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search"
        className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-text-secondary transition-colors hover:border-steel-blue hover:text-text sm:w-64 sm:justify-start">
        <Search size={16} /><span className="hidden flex-1 text-left sm:block">Search bills, pages…</span><kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-text-disabled sm:block">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-obsidian/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Search" className="pop-in w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_60px_rgba(16,29,53,.25)]">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search size={17} className="text-text-disabled" />
              <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Find a customer, bill number or page"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  else if (e.key === 'Enter' && results[active]) go(results[active].href);
                }}
                className="h-14 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-disabled" />
            </div>
            <ul className="max-h-80 overflow-y-auto p-2">
              {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-text-secondary">Nothing found for “{q}”.</li>}
              {results.map((r, i) => { const Icon = r.icon; return (
                <li key={r.key}><button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(r.href)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors', i === active ? 'bg-gold/10' : '')}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-hover text-gold"><Icon size={16} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-text">{r.title}</span><span className="block truncate text-xs text-text-secondary">{r.sub}</span></span>
                  {i === active && <CornerDownLeft size={14} className="text-text-disabled" />}
                </button></li>); })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/* ---- notifications: only real things from your own data ---- */
export function NotificationsMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const { sub } = useSubscription();
  const { all: plans } = usePlans();
  const { data: quotes = [] } = useQuotes();

  const items = useMemo(() => {
    const out: { key: string; tone: 'error' | 'warning' | 'info'; icon: ReactNode; title: string; text: string; href?: string }[] = [];
    if (sub) {
      const line = statusLine(sub, planName(plans, sub.period));
      if (line.tone !== 'success') out.push({ key: 'sub', tone: line.tone === 'error' ? 'error' : line.tone === 'warning' ? 'warning' : 'info', icon: <AlertTriangle size={16} />, title: line.title, text: line.text, href: isAdmin ? '/admin/billing' : undefined });
    }
    const within7 = upcoming(quotes, 500).filter((x) => new Date(`${x.next}T00:00:00`).getTime() - Date.now() < 7 * 864e5);
    if (within7.length) out.push({ key: 'ev', tone: 'info', icon: <CalendarClock size={16} />, title: `${within7.length} event${within7.length === 1 ? '' : 's'} in the next 7 days`, text: 'Open the calendar to see dates and times.', href: '/admin/calendar' });
    if (isAdmin) {
      const outstanding = quotes.filter((q) => q.status === 'confirmed' && quoteDates(q.customer).some((d) => d >= new Date().toISOString().slice(0, 10))).reduce((a, q) => a + quotePaymentState(q.pricing).balance, 0);
      if (outstanding > 0) out.push({ key: 'bal', tone: 'warning', icon: <Wallet size={16} />, title: `${inr(outstanding)} balance to collect`, text: 'On booked events that have not happened yet.', href: '/admin/quotes' });
    }
    return out;
  }, [sub, plans, quotes, isAdmin]);
  const tone = { error: 'bg-error-bg text-error', warning: 'bg-warning-bg text-warning', info: 'bg-gold/10 text-gold' };

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={`Notifications${items.length ? `, ${items.length} new` : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="relative grid size-10 place-items-center rounded-xl border border-border bg-surface text-text-secondary transition-colors hover:border-steel-blue hover:text-text">
        <Bell size={18} />{items.length > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-error ring-2 ring-surface" />}
      </button>
      {open && (
        <div className="drop-in absolute right-0 z-40 mt-2 w-[min(92vw,340px)] overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_18px_44px_rgba(16,29,53,.18)]">
          <p className="border-b border-border px-4 py-3 text-sm font-semibold text-text">Notifications</p>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-secondary"><CheckCircle2 size={22} className="mx-auto mb-2 text-success" />You are all caught up.</div>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {items.map((n) => { const body = (<><span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', tone[n.tone])}>{n.icon}</span><span className="min-w-0"><span className="block text-sm font-medium text-text">{n.title}</span><span className="block text-xs text-text-secondary">{n.text}</span></span></>);
                return <li key={n.key}>{n.href ? <Link href={n.href} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">{body}</Link> : <div className="flex gap-3 px-4 py-3">{body}</div>}</li>; })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- profile menu ---- */
export function ProfileMenu({ email, role, business, isAdmin, onSignOut }: { email: string; role: string; business?: string; isAdmin: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((v) => !v)} className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface pl-1.5 pr-2 transition-colors hover:border-steel-blue">
        <span className="grid size-7 place-items-center rounded-lg bg-brand text-[11px] font-bold text-white">{initials(friendlyName(email))}</span>
        <ChevronDown size={14} className={cn('hidden text-text-secondary transition-transform sm:block', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="drop-in absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_18px_44px_rgba(16,29,53,.18)]">
          <div className="border-b border-border px-4 py-3"><p className="truncate text-sm font-semibold text-text">{friendlyName(email)}</p><p className="truncate text-xs text-text-secondary">{email}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-gold">{business ? `${business} · ` : ''}{role}</p></div>
          <div className="p-1.5 text-sm">
            <Link href="/admin/account" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-text hover:bg-surface-hover"><ShieldCheck size={15} className="text-text-secondary" /> My account & security</Link>
            {isAdmin && <Link href="/admin/billing" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-text hover:bg-surface-hover"><Wallet size={15} className="text-text-secondary" /> Subscription & billing</Link>}
            <button type="button" onClick={onSignOut} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-error hover:bg-error-bg"><LogOut size={15} /> Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

export { Brand };
