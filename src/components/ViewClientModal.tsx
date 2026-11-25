import { useState } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Modal, Select, useUi } from '@/components/ui';
import { platformViewStart } from '@/lib/dataTools';
import type { TenantRow } from '@/lib/types';

/**
 * Super admin: opens ONE client's complete dashboard (every branch), exactly as that client sees it, read-only.
 * The database checks the password, which is the same one used to sign in.
 */
export function ViewClientModal({ tenants, initialId, onClose }: { tenants: TenantRow[]; initialId?: string; onClose: () => void }) {
  const { toast } = useUi();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [tenantId, setTenantId] = useState(initialId ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = async () => {
    if (!tenantId) { setError('Choose a business first.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true); setError('');
    try {
      const problem = await platformViewStart(tenantId, password);
      if (problem) { setError(problem); setPassword(''); return; }
      qc.clear();
      onClose();
      navigate('/admin');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this dashboard.'); }
    finally { setBusy(false); }
  };
  void toast;

  return (
    <Modal title="View a client's dashboard" eyebrow="Super admin" onClose={onClose} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="gold" onClick={() => void open()} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <LockKeyhole size={15} />} Open dashboard</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">You will see everything this business sees (all branches, bills, calendar, reports, settings). It is read-only: nothing can be changed while you view.</p>
        <Field label="Business">
          <Select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setError(''); }}>
            <option value="">Choose a business…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}{t.ownerEmail ? ` · ${t.ownerEmail}` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Your password" hint="same as your login password" error={error}>
          <div className="relative">
            <Input type={show ? 'text' : 'password'} value={password} autoComplete="current-password" className="pr-11"
              onChange={(e) => { setPassword(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') void open(); }} />
            <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
