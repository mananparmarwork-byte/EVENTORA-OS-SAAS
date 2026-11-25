import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'wouter';
import { Bell, CalendarDays, CheckCheck, CreditCard, FileText, LogOut, Search, User, Wallet } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { KIND_STYLE } from '@/components/noticeStyle';
import { useMarkRead, useNotifications } from '@/lib/apiExt';
import { useQuotes, useSubscription, usePlans } from '@/lib/api';
import { planName } from '@/lib/plans';
import { quoteDates, quotePaymentState } from '@/lib/pricing';
import { statusLine } from '@/pages/admin/BillingPage';
import { cn, fmtDate, inr, initials, todayISO } from '@/lib/format';
import { upcoming } from '@/lib/stats';
import type { Session } from '@/lib/types';

type ActiveSession = NonNullable<Session>;

/** Set right before navigating after a successful login: the layout shows the welcome splash once. */
export const WELCOME_FLAG = 'eventora-welcome';

/** "rohit.shah@x.com" -> "Rohit Shah" */
export function friendlyName(email: string): string {
  const local = (email.split('@')[0] ?? '').replace(/[0-9]+/g, ' ').replace(/[._+-]+/g, ' ').trim();
  if (!local) return 'there';
  return local.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/* ------------------------------------------------------------------ loading screens --- */
/** Navy full screen with a breathing logo and a running bar (session check). */
export function BrandedLoader() {
  return (
    <div role="status" aria-label="Loading Eventora OS" className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 bg-brand">
      <div className="breathe"><LogoMark size={84} /></div>
      <div className="h-[3px] w-32 overflow-hidden rounded-full bg-[#243759]"><div className="bar-run h-full w-2/5 rounded-full bg-[#6AA2FF]" /></div>
      <p className="text-[11px] font-semibold tracking-[0.22em] text-[#A5B4CF]">LOADING EVENTORA OS</p>
    </div>
  );
}

/** Shown once after sign-in. Dismisses itself after about 2 seconds; click to skip. */
export function WelcomeSplash({ name, business, onDone }: { name: string; business?: string; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, reducedMotion() ? 700 : 2000);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div role="dialog" aria-label="Welcome" onClick={onDone} className="fixed inset-0 z-[90] flex cursor-pointer flex-col items-center justify-center gap-3 bg-brand px-6 text-center">
      <div className="logo-in"><LogoMark size={88} /></div>
      <h1 className="fade-up mt-4 text-3xl font-semibold text-[#EAF0FB]">Welcome back!</h1>
      <p className="fade-up text-lg text-[#EAF0FB]">{name}</p>
      {business && <p className="fade-up-soft text-sm text-[#A5B4CF]">{business}</p>}
      <p className="mt-8 text-[11px] tracking-[0.18em] text-[#7C8CAB]">CLICK TO CONTINUE</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- dropdown helper --- */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  return { open, setOpen, box };
}

/* ------------------------------------------------------------------------ command search --- */
export type NavTarget = { href: string; label: string };

/** Header search button + Ctrl/Cmd+K palette. Searches real quotes (reference, customer, event type, phone) and every page the person can open. */
export function CommandSearch({ pages }: { pages: NavTarget[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search (Ctrl+K)" className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-text-secondary transition-colors hover:border-steel-blue hover:text-text sm:w-56 sm:justify-between">
        <span className="flex items-center gap-2"><Search size={16} /><span className="hidden sm:inline">Search…</span></span>
        <kbd className="hidden rounded-md border border-border bg-surface-hover px-1.5 py-0.5 text-[10px] font-semibold text-text-disabled sm:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && <Palette pages={pages} onClose={() => setOpen(false)} />}
    </>
  );
}

type Hit = { key: string; icon: 'quote' | 'page'; title: string; sub: string; href: string };

function Palette({ pages, onClose }: { pages: NavTarget[]; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { data: quotes = [] } = useQuotes({ all: true });
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    const pageHits: Hit[] = pages.filter((p) => !term || p.label.toLowerCase().includes(term)).map((p) => ({ key: `p-${p.href}`, icon: 'page', title: p.label, sub: 'Page', href: p.href }));
    if (!term) return pageHits;
    const quoteHits: Hit[] = quotes.filter((x) => {
      const c = x.customer;
      return x.reference.toLowerCase().includes(term) || c.name.toLowerCase().includes(term) || (c.eventType ?? '').toLowerCase().includes(term) || (digits.length >= 3 && (c.mobile ?? '').replace(/\D/g, '').includes(digits));
    }).slice(0, 8).map((x) => ({ key: `q-${x.reference}`, icon: 'quote', title: `${x.reference} · ${x.customer.name || 'Customer'}`, sub: [x.customer.eventType, quoteDates(x.customer)[0] ? fmtDate(quoteDates(x.customer)[0]) : ''].filter(Boolean).join(' · ') || 'Quotation', href: `/admin/quotes/${encodeURIComponent(x.reference)}` }));
    return [...quoteHits, ...pageHits];
  }, [q, quotes, pages]);

  useEffect(() => { setCursor(0); }, [q]);
  const go = (h: Hit) => { onClose(); navigate(h.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); go(hits[cursor]); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-obsidian/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey} className="pop-in w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={18} className="text-text-disabled" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search quotations, customers, phone numbers or pages" className="h-14 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-disabled" />
          <kbd className="rounded-md border border-border bg-surface-hover px-1.5 py-0.5 text-[10px] font-semibold text-text-disabled">Esc</kbd>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-2">
          {hits.length === 0 ? <li className="px-4 py-8 text-center text-sm text-text-secondary">Nothing found for “{q}”.</li> : hits.map((h, i) => (
            <li key={h.key}>
              <button type="button" onMouseEnter={() => setCursor(i)} onClick={() => go(h)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', i === cursor ? 'bg-gold/10' : 'hover:bg-surface-hover')}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-hover text-gold">{h.icon === 'quote' ? <FileText size={15} /> : <CalendarDays size={15} />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-text">{h.title}</span><span className="block truncate text-xs text-text-secondary">{h.sub}</span></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------------- notifications --- */
/** The bell. Only REAL items: messages from Eventora, the subscription status (when it needs attention),
 *  events in the next 7 days, and (owners) the balance still to collect on confirmed future events. */
export function NotificationsMenu({ isAdmin }: { isAdmin: boolean }) {
  const { open, setOpen, box } = useDropdown();
  const [, navigate] = useLocation();
  const { feed } = useNotifications(isAdmin);
  const mark = useMarkRead();
  const { data: quotes = [] } = useQuotes();
  const { sub } = useSubscription(isAdmin);
  const { all: plans } = usePlans();

  const subLine = useMemo(() => (sub ? statusLine(sub, planName(plans, sub.period)) : null), [sub, plans]);
  const subNeedsAttention = Boolean(subLine && subLine.tone !== 'success' && !(subLine.tone === 'info' && sub?.status === 'trialing' && sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() - Date.now() > 7 * 864e5));
  const soon = useMemo(() => {
    const limit = new Date(); limit.setDate(limit.getDate() + 7);
    const end = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}-${String(limit.getDate()).padStart(2, '0')}`;
    return upcoming(quotes.filter((q) => q.status === 'confirmed'), 50).filter((x) => x.next <= end);
  }, [quotes]);
  const balance = useMemo(() => {
    if (!isAdmin) return { total: 0, count: 0 };
    const today = todayISO();
    let total = 0, count = 0;
    quotes.filter((q) => q.status === 'confirmed' && quoteDates(q.customer).some((d) => d >= today)).forEach((q) => { const b = quotePaymentState(q.pricing).balance; if (b > 0) { total += b; count += 1; } });
    return { total, count };
  }, [quotes, isAdmin]);

  const messages = feed.items.slice(0, 4);
  const hasAny = feed.unread > 0 || subNeedsAttention || soon.length > 0 || balance.total > 0;
  const nothing = messages.length === 0 && !subNeedsAttention && soon.length === 0 && balance.total <= 0;
  const to = (href: string) => { setOpen(false); navigate(href); };

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={`Notifications${hasAny ? ' (new)' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="relative grid size-10 place-items-center rounded-xl text-text-secondary transition-colors hover:bg-surface-hover hover:text-text">
        <Bell size={19} />
        {hasAny && <span className="absolute right-2 top-2 size-2.5 rounded-full border-2 border-surface bg-error" />}
      </button>
      {open && (
        <div className="drop-in absolute right-0 top-12 z-40 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <p className="text-sm font-semibold text-text">Notifications</p>
            {feed.unread > 0 && <button type="button" onClick={() => mark.mutate(undefined)} className="inline-flex items-center gap-1 text-[11px] text-gold hover:underline"><CheckCheck size={13} /> Mark messages read</button>}
          </div>
          {nothing ? <p className="px-4 py-9 text-center text-sm text-text-secondary">You are all caught up.</p> : (
            <ul className="max-h-[420px] divide-y divide-border/60 overflow-y-auto">
              {isAdmin && subNeedsAttention && subLine && (
                <li><button type="button" onClick={() => to('/admin/billing')} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-hover">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-warning-bg text-warning"><CreditCard size={15} /></span>
                  <span className="min-w-0"><span className="block text-sm font-medium text-text">{subLine.title}</span><span className="block text-xs text-text-secondary">{subLine.text}</span></span>
                </button></li>
              )}
              {soon.length > 0 && (
                <li><button type="button" onClick={() => to('/admin/calendar')} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-hover">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-info/10 text-info"><CalendarDays size={15} /></span>
                  <span className="min-w-0"><span className="block text-sm font-medium text-text">{soon.length} event{soon.length === 1 ? '' : 's'} in the next 7 days</span>
                    <span className="block truncate text-xs text-text-secondary">{soon.slice(0, 3).map((x) => `${x.quote.customer.name || x.quote.reference} (${fmtDate(x.next)})`).join(' · ')}</span></span>
                </button></li>
              )}
              {isAdmin && balance.total > 0 && (
                <li><button type="button" onClick={() => to('/admin/quotes')} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-hover">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-success-bg text-success"><Wallet size={15} /></span>
                  <span className="min-w-0"><span className="block text-sm font-medium text-text">{inr(balance.total)} to collect</span><span className="block text-xs text-text-secondary">Balance on {balance.count} confirmed upcoming event{balance.count === 1 ? '' : 's'}.</span></span>
                </button></li>
              )}
              {messages.map((n) => {
                const Icon = KIND_STYLE[n.kind].icon;
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => { if (!n.readAt) mark.mutate([n.id]); to(n.actionUrl || '/admin/messages'); }} className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover', !n.readAt && 'bg-gold/[0.05]')}>
                      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', KIND_STYLE[n.kind].box)}><Icon size={15} /></span>
                      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-medium text-text">{n.title}</span>{!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-gold" />}</span><span className="line-clamp-2 text-xs text-text-secondary">{n.body}</span><span className="mt-0.5 block text-[10px] text-text-disabled">{fmtDate(n.createdAt)}</span></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {isAdmin && <Link href="/admin/messages" onClick={() => setOpen(false)} className="block border-t border-border/70 px-4 py-3 text-center text-xs font-medium text-gold hover:bg-surface-hover">Open all messages</Link>}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------- profile --- */
export function ProfileMenu({ session, isAdmin, onSignOut }: { session: ActiveSession; isAdmin: boolean; onSignOut: () => void }) {
  const { open, setOpen, box } = useDropdown();
  const name = friendlyName(session.email);
  const role = isAdmin ? 'Owner' : 'Employee';
  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label="Open profile menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-xl p-1 pr-2 transition-colors hover:bg-surface-hover">
        <span className="grid size-9 place-items-center rounded-full bg-gold text-xs font-bold text-text-on-gold">{initials(name)}</span>
        <span className="hidden min-w-0 text-left leading-tight md:block"><span className="block max-w-[140px] truncate text-sm font-semibold text-text">{name}</span><span className="block text-[11px] text-text-secondary">{role}</span></span>
      </button>
      {open && (
        <div className="drop-in absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <div className="border-b border-border/70 px-4 py-3">
            <p className="truncate text-sm font-semibold text-text">{name}</p>
            <p className="truncate text-xs text-text-secondary">{session.email}</p>
            <p className="mt-1 truncate text-[11px] font-medium text-gold">{session.tenantName ? `${session.tenantName} · ` : ''}{role}</p>
          </div>
          <div className="p-1.5">
            <Link href="/admin/account" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-text hover:bg-surface-hover"><User size={16} className="text-text-secondary" /> My account</Link>
            {isAdmin && <Link href="/admin/billing" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-text hover:bg-surface-hover"><CreditCard size={16} className="text-text-secondary" /> Billing</Link>}
            <button type="button" onClick={() => { setOpen(false); onSignOut(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-error hover:bg-error-bg"><LogOut size={16} /> Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}
