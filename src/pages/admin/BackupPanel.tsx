import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download, FileUp, Loader2, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHeader, Switch, useUi } from '@/components/ui';
import { useSession } from '@/lib/api';
import { describeBlock, downloadJson, exportMyData, importMyData, readBackupFile, type BackupFile, type ImportResult } from '@/lib/dataTools';

/**
 * Settings -> Backup & restore. Only shown when the Eventora team switched it on for this business.
 * Export = one file with everything of THIS business (all branches). Import = put that file back after a big change.
 */
export function BackupPanel({ viewing = false }: { viewing?: boolean }) {
  const { toast, confirm } = useUi();
  const qc = useQueryClient();
  const { session } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [picked, setPicked] = useState<{ name: string; file: BackupFile } | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [problem, setProblem] = useState('');

  const doExport = async () => {
    setBusy('export');
    try {
      const { file, filename } = await exportMyData();
      downloadJson(file, filename);
      toast('Your backup file was downloaded. Keep it safe.');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not export.', 'error'); }
    finally { setBusy(null); }
  };

  const choose = async (f: File | undefined) => {
    setResult(null); setProblem(''); setPicked(null);
    if (!f) return;
    try {
      const parsed = await readBackupFile(f);
      if (parsed.scope !== 'tenant') { setProblem('This file holds many businesses. Use the single-business backup you exported from here.'); return; }
      if (session?.slug && parsed.data.tenant?.slug && parsed.data.tenant.slug !== session.slug) { setProblem('This backup belongs to a different business, so it cannot be imported here.'); return; }
      setPicked({ name: f.name, file: parsed });
    } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not read the file.'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const doImport = async () => {
    if (!picked) return;
    const ok = await confirm({
      title: 'Import this backup?',
      text: `${describeBlock(picked.file.data)}. Your business details, payment details, catalog and settings will be replaced by the ones in the file. ${overwrite ? 'Bills with the same bill number will be replaced.' : 'Bills that already exist are kept as they are; only missing bills are added.'}`,
      confirmLabel: 'Import now',
    });
    if (!ok) return;
    setBusy('import');
    try {
      const r = await importMyData(picked.file, overwrite);
      setResult(r); setPicked(null);
      void qc.invalidateQueries();
      toast('Your data was imported.');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not import.', 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Export all my data" subtitle="One file with everything: bills, payments, branches, catalog, settings, activity" action={<DatabaseBackup size={16} className="text-gold" />} />
        <div className="space-y-4 p-5">
          <p className="text-sm text-text-secondary">Do this before any big change (for example a new plan). The file is saved on your device. It contains your customers&apos; details, so keep it private.</p>
          <Button variant="gold" onClick={() => void doExport()} disabled={busy !== null}>{busy === 'export' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Export my data</Button>
          <p className="text-xs text-text-disabled">Employee logins are not part of the file (they are accounts, not data). Your employees keep working as before.</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Import my data" subtitle="Put a backup file back after the change is done" action={<Upload size={16} className="text-gold" />} />
        <div className="space-y-4 p-5">
          {viewing ? <p className="text-sm text-text-secondary">Import is switched off while you are only viewing this business.</p> : (
            <>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}><FileUp size={15} /> Choose backup file</Button>
              {problem && <p role="alert" className="flex items-start gap-2 rounded-xl border border-error/30 bg-error-bg p-3 text-sm text-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {problem}</p>}
              {picked && (
                <div className="space-y-3 rounded-xl border border-border p-4">
                  <p className="text-sm font-medium text-text">{picked.name}</p>
                  <p className="text-xs text-text-secondary">{describeBlock(picked.file.data)} · saved {new Date(picked.file.exportedAt).toLocaleString()}</p>
                  <Switch checked={overwrite} onChange={setOverwrite} label="Replace bills that already exist" description="Off: existing bills are kept and only missing bills are added. On: a bill with the same number is replaced by the one in the file." />
                  <Button variant="gold" onClick={() => void doImport()} disabled={busy !== null}>{busy === 'import' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Import this file</Button>
                </div>
              )}
              {result && (
                <div className="rounded-xl border border-success/30 bg-success-bg p-4 text-sm text-success">
                  <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} /> Import finished</p>
                  <p className="mt-1 text-xs">{result.billsAdded} bill{result.billsAdded === 1 ? '' : 's'} added{result.billsReplaced ? `, ${result.billsReplaced} replaced` : ''}{result.billsSkipped ? `, ${result.billsSkipped} already there (kept)` : ''} · {result.branchesAdded} branch{result.branchesAdded === 1 ? '' : 'es'} added{result.branchesMergedIntoMain ? ` (${result.branchesMergedIntoMain} moved into Main because of your branch limit)` : ''} · {result.settingsRestored} settings restored · {result.activityAdded} activity lines</p>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
