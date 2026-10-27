import { useState } from 'react';
import { LayoutDashboard, Settings, Tags, Ticket, Users } from 'lucide-react';
import { CouponsTab, PlansTab, PlatformSettingsTab } from './PlatformExtra';
import { DashboardTab, SubscriptionsTab } from './PlatformDashboard';
import { cn } from '@/lib/format';
import type { SubState } from '@/lib/types';

/** Software-owner panel (Super admin): analytics, every customer's subscription and access, plans, coupons, free trial. */
type PTab = 'dashboard' | 'subscriptions' | 'plans' | 'coupons' | 'settings';
const TABS: { id: PTab; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> }, { id: 'subscriptions', label: 'Subscriptions & access', icon: <Users size={16} /> },
  { id: 'plans', label: 'Plans & prices', icon: <Tags size={16} /> }, { id: 'coupons', label: 'Coupons', icon: <Ticket size={16} /> }, { id: 'settings', label: 'Free trial', icon: <Settings size={16} /> },
];

export function PlatformPage() {
  const [tab, setTab] = useState<PTab>('dashboard');
  const [subView, setSubView] = useState<{ filter: SubState | 'all' | 'attention'; search: string }>({ filter: 'all', search: '' });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-surface p-1.5">
        {TABS.map((t) => <button key={t.id} type="button" onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors', tab === t.id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>{t.icon}{t.label}</button>)}
      </div>
      {tab === 'dashboard' && <DashboardTab onGo={(filter, search = '') => { setSubView({ filter, search }); setTab('subscriptions'); }} />}
      {tab === 'subscriptions' && <SubscriptionsTab initialFilter={subView.filter} initialSearch={subView.search} />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'coupons' && <CouponsTab />}
      {tab === 'settings' && <PlatformSettingsTab />}
    </div>
  );
}
