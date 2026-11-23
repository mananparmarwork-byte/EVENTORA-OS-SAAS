import { useState } from 'react';
import { Bell, CreditCard, Home, Inbox, Settings, UserPlus, Users } from 'lucide-react';
import { CouponsTab, PlansTab } from './PlatformExtra';
import { AddOwnerModal, RequestsTab, SettingsTab } from './PlatformOwners';
import { AutomationTab, MessagesTab } from './PlatformMessages';
import { Button } from '@/components/ui';
import { useInboxCounts } from '@/lib/apiExt';
import { cn } from '@/lib/format';
import { ClientsTab, type ClientFilter } from './PlatformClients';
import { HomeTab, type HomeTarget } from './PlatformHome';
import { PaymentsTab } from './PlatformPayments';
import { InvoicesTab } from './PlatformInvoices';

/** Software-owner panel (Super admin): what to do today, requests, your clients, the money you received, messages, settings. */
type PTab = 'home' | 'requests' | 'clients' | 'payments' | 'messages' | 'settings';

export function PlatformPage() {
  const [tab, setTab] = useState<PTab>('home');
  const [clientView, setClientView] = useState<{ filter: ClientFilter; search: string }>({ filter: 'all', search: '' });
  const [reqView, setReqView] = useState<'pending' | 'all' | 'leads'>('pending');
  const [msgView, setMsgView] = useState<'send' | 'auto'>('send');
  const [payView, setPayView] = useState<'payments' | 'invoices'>('payments');
  const [adding, setAdding] = useState(false);
  const { data: inbox } = useInboxCounts();
  const pending = (inbox?.requests ?? 0) + (inbox?.leads ?? 0);

  const tabs: { id: PTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'home', label: 'Home', icon: <Home size={16} /> },
    { id: 'requests', label: 'Requests', icon: <Inbox size={16} />, badge: pending },
    { id: 'clients', label: 'Clients', icon: <Users size={16} /> },
    { id: 'payments', label: 'Payments', icon: <CreditCard size={16} /> },
    { id: 'messages', label: 'Messages', icon: <Bell size={16} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
  ];
  const go = (target: HomeTarget, filter?: string) => {
    if (target === 'clients') setClientView({ filter: (filter as ClientFilter) ?? 'all', search: '' });
    if (target === 'requests') setReqView(filter === 'leads' ? 'leads' : 'pending');
    setTab(target);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap gap-2 rounded-2xl border border-border bg-surface p-1.5">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors', tab === t.id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>
              {t.icon}{t.label}{!!t.badge && <span className={cn('grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold', tab === t.id ? 'bg-text-on-gold/20' : 'bg-gold text-text-on-gold')}>{t.badge}</span>}
            </button>
          ))}
        </div>
        <Button variant="gold" size="lg" onClick={() => setAdding(true)}><UserPlus size={17} /> Add owner</Button>
      </div>
      {adding && <AddOwnerModal onClose={() => setAdding(false)} />}

      {tab === 'home' && <HomeTab onGo={go} />}
      {tab === 'requests' && <RequestsTab initial={reqView} />}
      {tab === 'clients' && <ClientsTab initialFilter={clientView.filter} initialSearch={clientView.search} />}
      {tab === 'payments' && (
        <div className="space-y-6">
          <div className="flex gap-2 rounded-2xl border border-border bg-surface p-1.5 sm:w-fit">
            {([['payments', 'Payments received'], ['invoices', 'Invoices']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setPayView(id)} className={cn('rounded-xl px-4 py-2 text-sm font-medium transition-colors', payView === id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>{label}</button>
            ))}
          </div>
          {payView === 'payments' ? <PaymentsTab /> : <InvoicesTab />}
        </div>
      )}
      {tab === 'messages' && (
        <div className="space-y-6">
          <div className="flex gap-2 rounded-2xl border border-border bg-surface p-1.5 sm:w-fit">
            {([['send', 'Send messages'], ['auto', 'Automatic reminders']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMsgView(id)} className={cn('rounded-xl px-4 py-2 text-sm font-medium transition-colors', msgView === id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>{label}</button>
            ))}
          </div>
          {msgView === 'send' ? <MessagesTab /> : <AutomationTab />}
        </div>
      )}
      {tab === 'settings' && (
        <div className="space-y-6">
          <SettingsTab />
          <details className="group rounded-2xl border border-border bg-surface"><summary className="cursor-pointer select-none px-5 py-4 text-sm font-semibold text-text">Plans &amp; prices <span className="font-normal text-text-secondary">(the plans you sell)</span></summary><div className="border-t border-border/70 p-5"><PlansTab /></div></details>
          <details className="group rounded-2xl border border-border bg-surface"><summary className="cursor-pointer select-none px-5 py-4 text-sm font-semibold text-text">Coupons <span className="font-normal text-text-secondary">(optional discounts)</span></summary><div className="border-t border-border/70 p-5"><CouponsTab /></div></details>
        </div>
      )}
    </div>
  );
}
