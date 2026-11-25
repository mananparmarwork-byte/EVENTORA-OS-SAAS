import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { AlertTriangle, BarChart3, Building2, CalendarDays, CreditCard, ChevronRight, ChevronsLeft, ChevronsRight, FileClock, FilePlus2, FileText, Layers, LayoutDashboard, LogOut, Menu, Plus, Settings, ShieldCheck, X } from 'lucide-react';
import { Brand } from '@/components/Logo';
import { BrandedLoader, CommandSearch, NotificationsMenu, ProfileMenu, WELCOME_FLAG, WelcomeSplash, friendlyName } from '@/components/Shell';
import { Button, useUi } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { signOut, usePlans, useSession, useSubscription } from '@/lib/api';
import { planName } from '@/lib/plans';
import { statusLine } from '@/pages/admin/BillingPage';
import { cn, initials } from '@/lib/format';

// `owner: true` = only the owner sees it. Employees get: New bill, Bills (take payments), Calendar.
const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true, owner: true },
  { href: '/admin/new', label: 'New bill', icon: FilePlus2, staffOnly: true },
  { href: '/admin/quotes', label: 'Quotations', staffLabel: 'Bills & payments', icon: FileText },
  { href: '/admin/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/admin/activity', label: 'Activity', icon: FileClock, owner: true },
  { href: '/admin/catalog', label: 'Catalog', icon: Layers, owner: true },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3, owner: true },
  { href: '/admin/billing', label: 'Billing', icon: CreditCard, owner: true },
  { href: '/admin/settings', label: 'Settings', icon: Settings, owner: true },
  { href: '/admin/platform', label: 'Super admin', icon: Building2, platform: true },
  { href: '/admin/account', label: 'My account', icon: ShieldCheck },
] as { href: string; label: string; group?: string; staffLabel?: string; icon: typeof Layers; exact?: boolean; owner?: boolean; staffOnly?: boolean; platform?: boolean }[];

/** Items from this point down are shown under the "Management" heading. */
const MANAGEMENT = new Set(['/admin/billing', '/admin/settings', '/admin/platform', '/admin/account']);

const TITLES: [string, string][] = [
  ['/admin/new', 'New quotation'], ['/admin/edit', 'Edit quotation'], ['/admin/quotes', 'Quotations'], ['/admin/calendar', 'Calendar'], ['/admin/activity', 'Activity'],
  ['/admin/catalog', 'Catalog'], ['/admin/billing', 'Billing'], ['/admin/account', 'My account'], ['/admin/platform', 'Super admin: businesses, plans, coupons'], ['/admin/reports', 'Reports'], ['/admin/settings', 'Settings'], ['/admin', 'Dashboard'],
];

const IDLE_MINUTES = 30;
/** Signs the person out after 30 minutes without any activity (protects a phone or counter PC left open). */
function useIdleSignOut(active: boolean, onIdle: () => void) {
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(onIdle, IDLE_MINUTES * 60_000);
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(onIdle, IDLE_MINUTES * 60_000); };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => { window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [active, onIdle]);
}

function readCollapsed() { try { return window.localStorage.getItem('eventora-sidebar') === '1'; } catch { return false; } }

function SubscriptionBanner({ isAdmin }: { isAdmin: boolean }) {
  const { sub } = useSubscription();
  const { all: allPlans } = usePlans();
  if (!sub) return null;
  const line = statusLine(sub, planName(allPlans, sub.period));
  if (line.tone === 'success' || (line.tone === 'info' && sub.status === 'trialing' && sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() - Date.now() > 7 * 864e5)) return null;
  const cls = { success: '', info: 'border-info/30 bg-info/10 text-info', warning: 'border-warning/30 bg-warning-bg text-warning', error: 'border-error/30 bg-error-bg text-error' }[line.tone];
  return (
    <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm sm:px-8 ${cls}`} role="status">
      <AlertTriangle size={16} className="shrink-0" />
      <span className="min-w-0 flex-1"><strong>{line.title}.</strong> {sub.writable ? '' : 'The software is locked. '}{isAdmin ? '' : 'Please ask the owner to renew.'}</span>
      {isAdmin && <Link href="/admin/billing" className="rounded-lg bg-text/10 px-3 py-1 text-xs font-semibold hover:bg-text/20">{sub.status === 'trialing' && sub.writable ? 'Choose a plan' : 'Renew now'}</Link>}
    </div>
  );
}

/** The plan has ended: employees see this instead of the app. */
function LockScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-page px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 text-center card-glow">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-error-bg text-error"><AlertTriangle size={26} /></span>
        <h1 className="mt-5 font-display text-2xl font-semibold text-text">Subscription ended</h1>
        <p className="mt-2 text-sm text-text-secondary">Your business&apos;s plan has ended, so Eventora is switched off for now. Please ask the owner to renew it. Nothing has been lost.</p>
        <button type="button" onClick={onSignOut} className="mt-6 w-full rounded-xl border border-border px-4 py-3 text-sm font-medium text-text hover:bg-surface-hover">Sign out</button>
      </div>
    </main>
  );
}

/** Shown instead of a silent redirect when someone opens the super admin page without being the software owner. */
function PlatformDenied({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const sql = `insert into public.platform_admins (user_id)\nselect id from auth.users where lower(email) = lower('${email.replace(/'/g, "''")}')\non conflict do nothing;`;
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-8">
        <h1 className="font-display text-2xl font-semibold text-text">This login is not the super admin</h1>
        <p className="mt-2 text-sm text-text-secondary">You are signed in as <strong className="text-text">{email}</strong>, and the database does not list that login as the software owner, so the Super admin page stays closed.</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-text-secondary">
          <li>Open Supabase, then <strong>SQL Editor</strong>, and run this once:
            <pre className="mt-2 overflow-x-auto rounded-xl border border-border bg-input p-3 text-xs text-gold">{sql}</pre>
          </li>
          <li>Come back here, <strong>sign out</strong> and sign in again (the app only checks this when you sign in).</li>
          <li>If you use two-step verification, enter the 6-digit code at sign-in; without it the page stays closed.</li>
        </ol>
        <p className="mt-4 text-xs text-text-disabled">Signed in with a different email than the one you own the software with? Sign out and use that one instead.</p>
        <div className="mt-6 flex flex-wrap gap-2"><Button variant="gold" onClick={onSignOut}>Sign out</Button><a href="#/admin"><Button variant="ghost">Back to my dashboard</Button></a></div>
      </div>
    </main>
  );
}

export function AdminLayout({ children, ownerOnly = false, platformOnly = false }: { children: ReactNode; ownerOnly?: boolean; platformOnly?: boolean }) {
  const { session, loading, isAdmin } = useSession();
  const qc = useQueryClient();
  const { sub } = useSubscription(Boolean(session));
  const [location, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const { toast } = useUi();
  const [welcome, setWelcome] = useState(() => { try { const v = window.sessionStorage.getItem(WELCOME_FLAG) === '1'; if (v) window.sessionStorage.removeItem(WELCOME_FLAG); return v; } catch { return false; } });
  const idleOut = useCallback(() => { void signOut().finally(() => { qc.clear(); toast('You were signed out after 30 minutes without activity.', 'info'); navigate('/login'); }); }, [navigate, toast, qc]);
  useIdleSignOut(Boolean(session), idleOut);

  useEffect(() => { setDrawer(false); window.scrollTo({ top: 0 }); }, [location]);
  const toggle = () => setCollapsed((c) => { try { window.localStorage.setItem('eventora-sidebar', c ? '0' : '1'); } catch { /* ignore */ } return !c; });

  if (loading) return <BrandedLoader label="Checking your session" />;
  if (!session) return <Redirect to="/login" />;
  // Plan or trial over: the owner can only open Billing (and the software-owner panel); employees are fully locked out.
  const locked = Boolean(sub && !sub.writable);
  const canUsePlatform = Boolean(session.platform) && location === '/admin/platform';
  if (locked && !isAdmin) return <LockScreen onSignOut={async () => { await signOut(); qc.clear(); navigate('/login'); }} />;
  if (locked && isAdmin && location !== '/admin/billing' && location !== '/admin/account' && !canUsePlatform) return <Redirect to="/admin/billing" />;
  if (platformOnly && !session.platform) return <PlatformDenied email={session.email} onSignOut={async () => { await signOut(); qc.clear(); navigate('/login'); }} />;
  if (ownerOnly && !isAdmin) return <Redirect to={isAdmin ? '/admin' : '/admin/new'} />;
  const items = NAV.filter((i) => (i.platform ? Boolean(session.platform) : isAdmin ? !i.staffOnly : !i.owner)).filter((i) => !locked || i.href === '/admin/billing' || i.href === '/admin/account' || i.platform);

  const title = TITLES.find(([p]) => location.startsWith(p))?.[1] ?? 'Eventora OS';
  const doSignOut = async () => { await signOut(); qc.clear(); toast('Signed out', 'info'); navigate('/login'); };
  const isActive = (item: (typeof NAV)[number]) => (item.exact ? location === item.href : location.startsWith(item.href));

  const sidebar = (compact: boolean) => (
    <div className="sidebar-dark flex h-full flex-col bg-sidebar">
      <div className={cn('flex h-[72px] items-center border-b border-border px-5', compact && 'justify-center px-0')}><Brand collapsed={compact} onDark /></div>
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {items.map((item, idx) => {
          const active = isActive(item);
          const Icon = item.icon;
          const mgmt = MANAGEMENT.has(item.href);
          const firstMgmt = mgmt && !MANAGEMENT.has(items[idx - 1]?.href ?? '');
          return (
            <div key={item.href}>
              {firstMgmt && (compact ? <div className="my-3 h-px bg-border" /> : <p className="mb-1.5 mt-5 px-3.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-disabled">Management</p>)}
              {idx === 0 && !compact && <p className="mb-1.5 px-3.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-disabled">Workspace</p>}
              <Link href={item.href} title={compact ? (!isAdmin && item.staffLabel) || item.label : undefined}
                className={cn('group relative mb-0.5 flex h-10 items-center gap-3 rounded-xl px-3.5 text-sm font-medium transition-all duration-150', compact && 'justify-center px-0',
                  active ? 'bg-white/10 text-white' : 'text-text-secondary hover:bg-white/5 hover:text-white')}>
                {active && <span className="absolute left-0 top-2 h-6 w-[3px] rounded-r bg-gold" />}
                <Icon size={18} className={cn('shrink-0 transition-transform duration-150 group-hover:scale-110', active && 'text-gold')} />
                {!compact && <span className="truncate">{(!isAdmin && item.staffLabel) || item.label}</span>}
              </Link>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <div className={cn('flex items-center gap-3 rounded-xl p-2', compact && 'justify-center')}>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold/20 text-xs font-bold text-gold">{initials(friendlyName(session.email))}</span>
          {!compact && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-text">{session.email}</p>
              <p className="truncate text-[10px] uppercase tracking-wide text-gold">{session.tenantName ? `${session.tenantName} · ` : ''}{isAdmin ? 'Owner' : 'Employee'}</p>
              <button type="button" onClick={() => void doSignOut()} className="flex items-center gap-1 text-[11px] text-text-secondary transition-colors hover:text-white"><LogOut size={12} /> Sign out</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-page text-text">
      {welcome && <WelcomeSplash name={friendlyName(session.email)} business={session.tenantName} onDone={() => setWelcome(false)} />}
      {/* desktop sidebar: 248px open, 76px collapsed */}
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden bg-sidebar transition-[width] duration-200 lg:block', collapsed ? 'w-[76px]' : 'w-[248px]')}>{sidebar(collapsed)}</aside>
      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-obsidian/60 backdrop-blur-sm transition-opacity" onClick={() => setDrawer(false)} />
          <aside className="drawer-in absolute inset-y-0 left-0 w-[272px] bg-sidebar shadow-2xl">
            <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="absolute right-3 top-5 z-10 text-[#A5B4CF] hover:text-white"><X size={20} /></button>
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-20 flex h-[72px] items-center gap-2 border-b border-border bg-surface/85 px-4 backdrop-blur-md sm:gap-3 sm:px-8">
          <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="grid size-10 place-items-center rounded-xl text-text-secondary transition-colors hover:bg-surface-hover lg:hidden"><Menu size={20} /></button>
          <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggle} className="hidden size-10 place-items-center rounded-xl text-text-secondary transition-colors hover:bg-surface-hover hover:text-text lg:grid">
            {collapsed ? <ChevronsRight size={19} /> : <ChevronsLeft size={19} />}
          </button>
          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-[11px] text-text-disabled sm:flex"><span>{session.tenantName || 'Eventora OS'}</span><ChevronRight size={11} /><span className="text-text-secondary">{title}</span></nav>
            <h1 className="truncate text-lg font-semibold leading-tight text-text sm:text-xl">{title}</h1>
          </div>
          <CommandSearch items={items.map((i) => ({ href: i.href, label: (!isAdmin && i.staffLabel) || i.label, icon: i.icon }))} />
          <NotificationsMenu isAdmin={isAdmin} />
          <ProfileMenu email={session.email} role={isAdmin ? 'Owner' : 'Employee'} business={session.tenantName} isAdmin={isAdmin} onSignOut={() => void doSignOut()} />
          <Link href="/admin/new" className="hidden sm:block"><Button variant="gold" size="md"><Plus size={16} /> New booking</Button></Link>
        </header>
        <SubscriptionBanner isAdmin={isAdmin} />
        <main key={location} className="page-in mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
