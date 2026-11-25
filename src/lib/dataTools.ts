import { useQuery } from '@tanstack/react-query';
import { getBackend, getSupabaseClient } from './backend';
import { saveBlob } from '@/pdf/generate';

/**
 * Backup & restore (per business and for the whole platform) and the super admin's "view a client's dashboard".
 * Needs supabase/22-backup-and-view-clients.sql.
 */

const MISSING_SQL = 'Run supabase/22-backup-and-view-clients.sql in the Supabase SQL Editor first, then refresh.';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const client = getSupabaseClient();
  if (!client) throw new Error('This needs the Supabase version of Eventora.');
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    if (/schema cache|could not find the function|does not exist/i.test(error.message) && error.message.includes(fn)) throw new Error(MISSING_SQL);
    throw new Error(error.message);
  }
  return data as T;
}

/* ------------------------------------------------------------------ file formats --- */
export type TenantBlock = { tenant?: { name?: string; slug?: string }; quotes?: unknown[]; branches?: unknown[]; activity?: unknown[]; [k: string]: unknown };
export type BackupFile = { format: 'eventora-backup'; version: 1; scope: 'tenant'; exportedAt: string; data: TenantBlock };
export type PlatformBackupFile = { format: 'eventora-backup'; version: 1; scope: 'platform'; exportedAt: string; tenants: TenantBlock[] };
export type ImportResult = {
  billsAdded: number; billsReplaced: number; billsSkipped: number; branchesAdded: number; branchesMergedIntoMain: number;
  settingsRestored: number; activityAdded: number; business?: string; created?: boolean;
};
export type BackupStatus = { enabled: boolean; viewing: boolean };

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'business';

/** Saves any data as a .json file the person can keep. */
export function downloadJson(obj: unknown, filename: string) {
  saveBlob(new Blob([JSON.stringify(obj)], { type: 'application/json' }), filename);
}

/** Reads a chosen .json file and checks that it really is an Eventora backup. */
export async function readBackupFile(file: File): Promise<BackupFile | PlatformBackupFile> {
  if (file.size > 150 * 1024 * 1024) throw new Error('This file is too large to be an Eventora backup.');
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('This file could not be read. Choose the .json backup file you exported from Eventora.'); }
  const f = parsed as Partial<BackupFile & PlatformBackupFile> | null;
  if (!f || f.format !== 'eventora-backup' || f.version !== 1) throw new Error('This is not an Eventora backup file.');
  if (f.scope === 'tenant' && f.data && typeof f.data === 'object') return f as BackupFile;
  if (f.scope === 'platform' && Array.isArray(f.tenants)) return f as PlatformBackupFile;
  throw new Error('This backup file is incomplete.');
}

/** A short plain-language line describing what is inside a backup (shown before importing). */
export function describeBlock(b: TenantBlock) {
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  return `${n(b.quotes)} bill${n(b.quotes) === 1 ? '' : 's'}, ${n(b.branches)} branch${n(b.branches) === 1 ? '' : 'es'}, ${n(b.activity)} activity line${n(b.activity) === 1 ? '' : 's'}`;
}

/* --------------------------------------------------------------- one business (owner) --- */
export async function fetchBackupStatus(): Promise<BackupStatus> {
  const d = await rpc<{ enabled?: boolean; viewing?: boolean } | null>('backup_status');
  return { enabled: Boolean(d?.enabled), viewing: Boolean(d?.viewing) };
}
export function useBackupStatus(enabled = true) {
  const q = useQuery<BackupStatus>({ queryKey: ['backup-status'], queryFn: fetchBackupStatus, enabled, retry: false, staleTime: 60_000, refetchOnWindowFocus: true });
  return { ...q, status: q.data ?? { enabled: false, viewing: false } };
}

export async function exportMyData(): Promise<{ file: BackupFile; filename: string }> {
  const data = await rpc<TenantBlock>('export_my_data');
  const file: BackupFile = { format: 'eventora-backup', version: 1, scope: 'tenant', exportedAt: new Date().toISOString(), data };
  return { file, filename: `eventora-backup-${slugOf(data.tenant?.slug ?? data.tenant?.name ?? 'business')}-${stamp()}.json` };
}
export async function importMyData(file: BackupFile, overwrite: boolean): Promise<ImportResult> {
  return rpc<ImportResult>('import_my_data', { p: file.data, p_overwrite: overwrite });
}

/* ------------------------------------------------------------ super admin: every client --- */
export const platformBackupFlags = () => rpc<{ tenantId: string; enabled: boolean }[]>('platform_backup_flags');
export const platformSetBackup = (tenantIds: string[] | null, enabled: boolean) => rpc<number>('platform_set_backup', { p_tenants: tenantIds, p_enabled: enabled });
export function usePlatformBackupFlags(enabled = true) {
  return useQuery<{ tenantId: string; enabled: boolean }[]>({ queryKey: ['platform-backup-flags'], queryFn: platformBackupFlags, enabled, retry: false });
}

/** One business at a time, so a big platform never hits a database time limit. */
export async function platformExportAll(onProgress: (done: number, total: number, name: string) => void): Promise<{ file: PlatformBackupFile; filename: string }> {
  const list = await getBackend().listTenants();
  const tenants: TenantBlock[] = [];
  for (let i = 0; i < list.length; i++) {
    onProgress(i, list.length, list[i].name);
    tenants.push(await rpc<TenantBlock>('platform_export_tenant', { p_tenant: list[i].id }));
  }
  onProgress(list.length, list.length, '');
  return { file: { format: 'eventora-backup', version: 1, scope: 'platform', exportedAt: new Date().toISOString(), tenants }, filename: `eventora-ALL-clients-backup-${stamp()}.json` };
}

export type PlatformImportReport = { done: ImportResult[]; failed: { name: string; error: string }[] };
export async function platformImportAll(file: PlatformBackupFile, overwrite: boolean, onProgress: (done: number, total: number, name: string) => void): Promise<PlatformImportReport> {
  const report: PlatformImportReport = { done: [], failed: [] };
  for (let i = 0; i < file.tenants.length; i++) {
    const block = file.tenants[i];
    const name = block.tenant?.name ?? block.tenant?.slug ?? `Business ${i + 1}`;
    onProgress(i, file.tenants.length, name);
    try { report.done.push(await rpc<ImportResult>('platform_import_tenant', { p: block, p_overwrite: overwrite })); }
    catch (e) { report.failed.push({ name, error: e instanceof Error ? e.message : 'Import failed.' }); }
  }
  onProgress(file.tenants.length, file.tenants.length, '');
  return report;
}

/* ------------------------------------------------ super admin: view a client's dashboard --- */
/** The database checks the password (the same one used to sign in). Resolves to an error text, or '' when the view has started. */
export async function platformViewStart(tenantId: string, password: string): Promise<string> {
  const r = await rpc<{ ok: boolean; error?: string }>('platform_view_start', { p_tenant: tenantId, p_password: password });
  return r.ok ? '' : r.error ?? 'Could not open this dashboard.';
}
export const platformViewEnd = () => rpc<void>('platform_view_end');
