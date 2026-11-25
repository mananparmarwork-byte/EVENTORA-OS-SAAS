import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download, Eye, FileUp, Loader2, Search, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Spinner, Switch, useUi } from '@/components/ui';
import { ViewClientModal } from '@/components/ViewClientModal';
import { useTenants } from '@/lib/api';
import { downloadJson, platformExportAll, platformImportAll, platformSetBackup, readBackupFile, usePlatformBackupFlags, type PlatformBackupFile, type PlatformImportReport } from '@/lib/dataTools';

/** Super admin -> "Data & clients": open any client's dashboard, switch Backup & restore on per client, export / import every client's data. */
export function DataTab() {
  const { toast, confirm } = useUi();
  const qc = useQueryClient();
  const { data: tenants = [], isLoading, error } = useTenants(true);
  const { data: flags = [], refetch: refetchFlags, error: flagsError } = usePlatformBackupFlags();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState('');
  const [importing, setImporting] = useState('');
  const [picked, setPicked] = useState<{ name: string; file: PlatformBackupFile } | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [report, setReport] = useState<PlatformImportReport | null>(null);
  const [problem, setProblem] = useState('');

  const on = useMemo(() => new Set(flags.filter((f) => f.enabled).map((f) => f.tenantId)), [flags]);
  const q = search.trim().toLowerCase();
  const list = useMemo(() => tenants.filter((t) => !q || [t.name, t.slug, t.ownerEmail ?? ''].some((v) => v.toLowerCase().includes(q))), [tenants, q]);

  const setOne = async (id: string, enabled: boolean) => {
    setBusyId(id);
    try { await platformSetBackup([id], enabled); await refetchFlags(); void qc.invalidateQueries({ queryKey: ['backup-status'] }); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not change this.', 'error'); }
    finally { setBusyId(''); }
  };
  const setAll = async (enabled: boolean) => {
    if (!(await confirm({ title: enabled ? 'Switch on for every client?' : 'Switch off for every client?', text: enabled ? 'Every owner will see Settings → Backup & restore.' : 'Owners will no longer see Backup & restore.', confirmLabel: enabled ? 'Switch on for all' : 'Switch off for all', danger: !enabled }))) return;
    setBulkBusy(true);
    try { await platformSetBackup(null, enabled); await refetchFlags(); void qc.invalidateQueries({ queryKey: ['backup-status'] }); toast(enabled ? 'Switched on for every client.' : 'Switched off for every client.'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not change this.', 'error'); }
    finally { setBulkBusy(false); }
  };

  const exportAll = async () => {
    setExporting('Starting…');
    try {
      const { file, filename } = await platformExportAll((d, t, name) => setExporting(name ? `Exporting ${name} (${d + 1} of ${t})…` : 'Finishing…'));
      downloadJson(file, filename);
      toast(`Exported ${file.tenants.length} business${file.tenants.length === 1 ? '' : 'es'}.`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not export.', 'error'); }
    finally { setExporting(''); }
  };

  const choose = async (f: File | undefined) => {
    setReport(null); setProblem(''); setPicked(null);
    if (!f) return;
    try {
      const parsed = await readBackupFile(f);
      if (parsed.scope !== 'platform') { setProblem('This file holds only one business. Use “Export all clients” to make the right file, or import a single business from that client’s own Settings.'); return; }
      setPicked({ name: f.name, file: parsed });
    } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not read the file.'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };
  const importAll = async () => {
    if (!picked) return;
    if (!(await confirm({ title: `Import ${picked.file.tenants.length} businesses?`, text: 'Each business is restored into its own account only (matched by its short name). A business that no longer exists is created again; add its owner login afterwards with “Add owner”. Plans and prices are not changed for existing businesses.', confirmLabel: 'Import all' }))) return;
    setImporting('Starting…');
    try {
      const r = await platformImportAll(picked.file, overwrite, (d, t, name) => setImporting(name ? `Importing ${name} (${d + 1} of ${t})…` : 'Finishing…'));
      setReport(r); setPicked(null);
      void qc.invalidateQueries();
      toast(r.failed.length ? `Imported ${r.done.length}, ${r.failed.length} failed.` : `Imported ${r.done.length} businesses.`, r.failed.length ? 'error' : 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not import.', 'error'); }
    finally { setImporting(''); }
  };

  if (isLoading) return <Spinner label="Loading clients" />;
  if (error) return <Card className="p-8 text-center text-sm text-error">{(error as Error).message}</Card>;
  const sqlMissing = flagsError ? (flagsError as Error).message : '';

  return (
    <div className="space-y-6">
      {view !== null && <ViewClientModal tenants={tenants} initialId={view || undefined} onClose={() => setView(null)} />}
      {sqlMissing && <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-bg p-3 text-sm text-warning"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {sqlMissing}</p>}

      <Card>
        <CardHeader title="Clients" subtitle="Open any client's full dashboard, and choose who gets Backup & restore in their Settings" action={<Eye size={16} className="text-gold" />} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
          <div className="relative w-full sm:w-72"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled" /><Input className="pl-9" placeholder="Search business or owner" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="gold" onClick={() => setView('')}><Eye size={15} /> View a client&apos;s dashboard</Button>
            <Button variant="outline" onClick={() => void setAll(true)} disabled={bulkBusy}>Backup on for all</Button>
            <Button variant="outline" onClick={() => void setAll(false)} disabled={bulkBusy}>Backup off for all</Button>
          </div>
        </div>
        {list.length === 0 ? <EmptyState icon={<DatabaseBackup />} title="No clients found" /> : (
          <ul className="divide-y divide-border/60">
            {list.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text">{t.name} {on.has(t.id) && <Badge tone="success" className="ml-1">Backup on</Badge>}</p>
                  <p className="truncate text-xs text-text-secondary">{t.ownerEmail ?? 'No owner login'} · {t.bills} bills · {t.members} login{t.members === 1 ? '' : 's'}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className={busyId === t.id ? 'pointer-events-none opacity-60' : ''}><Switch checked={on.has(t.id)} onChange={(v) => void setOne(t.id, v)} label="Backup & restore" /></div>
                  <Button size="sm" variant="outline" onClick={() => setView(t.id)}><Eye size={13} /> View dashboard</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Export all clients' data" subtitle="Every business, every branch, in one file" action={<Download size={16} className="text-gold" />} />
          <div className="space-y-4 p-5">
            <p className="text-sm text-text-secondary">Use this before a big change to the software. Each business is kept separate inside the file, with its own branches.</p>
            <Button variant="gold" onClick={() => void exportAll()} disabled={Boolean(exporting) || Boolean(importing)}>{exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {exporting || 'Export all clients'}</Button>
            <p className="text-xs text-text-disabled">The file contains your clients&apos; customer details. Keep it private. Logins (passwords) are not included.</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Import all clients' data" subtitle="Each client's data goes back into their own dashboard only" action={<Upload size={16} className="text-gold" />} />
          <div className="space-y-4 p-5">
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={Boolean(exporting) || Boolean(importing)}><FileUp size={15} /> Choose backup file</Button>
            {problem && <p role="alert" className="flex items-start gap-2 rounded-xl border border-error/30 bg-error-bg p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {problem}</p>}
            {picked && (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-text">{picked.name}</p>
                <p className="text-xs text-text-secondary">{picked.file.tenants.length} business{picked.file.tenants.length === 1 ? '' : 'es'} · saved {new Date(picked.file.exportedAt).toLocaleString()}</p>
                <Switch checked={overwrite} onChange={setOverwrite} label="Replace bills that already exist" description="Off: existing bills are kept, only missing bills are added." />
                <Button variant="gold" onClick={() => void importAll()} disabled={Boolean(importing)}>{importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {importing || 'Import all clients'}</Button>
              </div>
            )}
            {report && (
              <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
                <p className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 size={16} /> {report.done.length} imported</p>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-text-secondary">
                  {report.done.map((r, i) => <li key={i}>{r.business}{r.created ? ' (created again, add its owner login)' : ''}: {r.billsAdded} added{r.billsReplaced ? `, ${r.billsReplaced} replaced` : ''}{r.billsSkipped ? `, ${r.billsSkipped} kept` : ''}, {r.branchesAdded} branches added</li>)}
                </ul>
                {report.failed.length > 0 && <div className="text-error"><p className="font-semibold">{report.failed.length} failed</p><ul className="text-xs">{report.failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}</ul></div>}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
