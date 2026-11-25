import { useState } from 'react';
import { Bell, DatabaseBackup, FileText, Inbox, LayoutDashboard, Settings, Tags, Ticket, UserPlus, Users, Wallet, Zap } from 'lucide-react';
import { CouponsTab, PlansTab } from './PlatformExtra';
import { AddOwnerModal, RequestsTab, SettingsTab } from './PlatformOwners';
import { AutomationTab, MessagesTab } from './PlatformMessages';
import { InvoicesTab } from './PlatformInvoices';
import { CollectionsTab } from './PlatformCollections';
import { DataTab } from './PlatformData';
import { Button } from '@/components/ui';
import { useInboxCounts } from '@/lib/apiExt';
import { DashboardTab, SubscriptionsTab } from './PlatformDashboard';
import { cn } from '@/lib/format';
import type { SubState } from '@/lib/types';

/** Software-owner panel (Super admin): analytics, every customer's subscription and access, plans, coupons, free trial. */
type PTab = 'dashboard' | 'collections' | 'subscriptions' | 'requests' | 'invoices' | 'messages' | 'automation' | 'plans' | 'coupons' | 'data' | 'settings';
const TABS: { id: PTab; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> }, { id: 'collections', label: 'Collections', icon: <Wallet size={16} /> }, { id: 'subscriptions', label: 'Subscriptions & access', icon: <Users size={16} /> },
  { id: 'requests', label: 'Requests', icon: <Inbox size={16} /> }, { id: 'invoices', label: 'Invoices', icon: <FileText size={16} /> }, { id: 'messages', label: 'Messages', icon: <Bell size={16} /> }, { id: 'automation', label: 'Automation', icon: <Zap size={16} /> },
  { id: 'plans', label: 'Plans & prices', icon: <Tags size={16} /> }, { id: 'coupons', label: 'Coupons', icon: <Ticket size={16} /> }, { id: 'data', label: 'Data & clients', icon: <DatabaseBackup size={16} /> }, { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
];

export function PlatformPage() {
  const [tab, setTab] = useState<PTab>('dashboard');
  const [subView, setSubView] = useState<{ filter: SubState | 'all' | 'attention'; search: string }>({ filter: 'all', search: '' });
  const [adding, setAdding] = useState(false);
  const { data: inbox } = useInboxCounts();
  const pending = (inbox?.requests ?? 0) + (inbox?.leads ?? 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap gap-2 rounded-2xl border border-border bg-surface p-1.5">
          {TABS.map((t) => <button key={t.id} type="button" onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors', tab === t.id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>{t.icon}{t.label}{t.id === 'requests' && pending > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-obsidian/25 px-1.5 text-[11px] font-bold">{pending}</span>}</button>)}
        </div>
        <Button variant="gold" size="lg" onClick={() => setAdding(true)}><UserPlus size={17} /> Add owner</Button>
      </div>
      {adding && <AddOwnerModal onClose={() => setAdding(false)} />}
      {tab === 'dashboard' && <DashboardTab onGo={(filter, search = '') => { setSubView({ filter, search }); setTab('subscriptions'); }} />}
      {tab === 'collections' && <CollectionsTab />}
      {tab === 'subscriptions' && <SubscriptionsTab initialFilter={subView.filter} initialSearch={subView.search} />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'automation' && <AutomationTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'coupons' && <CouponsTab />}
      {tab === 'data' && <DataTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
