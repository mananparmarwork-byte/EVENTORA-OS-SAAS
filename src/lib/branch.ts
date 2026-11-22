import { useCallback, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBackend } from './backend';
import type { Branch, BranchInfo, Quote } from './types';

/** 'all' = every branch combined (owner only). Otherwise a branch id. Remembered on this device. */
export const ALL = 'all';
const KEY = 'eventora-branch-scope';
const listeners = new Set<() => void>();
let current = ((): string => { try { return window.localStorage.getItem(KEY) || ALL; } catch { return ALL; } })();

export function setBranchScope(v: string) {
  current = v || ALL;
  try { window.localStorage.setItem(KEY, current); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const snapshot = () => current;
const EMPTY: BranchInfo = { branches: [], limit: 1, activeCount: 0, myBranchId: null };

/** The branch list of this business (an employee only gets their own branch). */
export function useBranchInfo(enabled = true) {
  const q = useQuery<BranchInfo>({ queryKey: ['branches'], queryFn: () => getBackend().listBranches(), enabled, staleTime: 30_000, retry: false });
  return { ...q, info: q.data ?? EMPTY };
}

/**
 * Which branch the owner is looking at.
 *  - `multi`: the business has more than one branch (otherwise all branch controls stay hidden).
 *  - `scope`: 'all' or a branch id that really exists. Employees are always 'all' here because the DATABASE already limits them to their branch.
 *  - `filter(quotes)`: keeps only the bills of the chosen branch.
 */
export function useBranchScope(enabled = true) {
  const stored = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { info, isLoading } = useBranchInfo(enabled);
  const isStaff = info.myBranchId != null;
  const known = info.branches.some((b) => b.id === stored);
  const scope = isStaff || !known ? ALL : stored;
  const multi = info.branches.length > 1;
  const current: Branch | undefined = info.branches.find((b) => b.id === scope);
  const main = info.branches.find((b) => b.isMain) ?? info.branches[0];
  const filter = useCallback(<T extends { branchId?: string }>(list: T[]) => (scope === ALL ? list : list.filter((x) => x.branchId === scope)), [scope]);
  return { scope, setScope: setBranchScope, info, branches: info.branches, activeBranches: info.branches.filter((b) => b.active), multi, current, main, isStaff, isLoading, filter };
}

export const branchName = (branches: Branch[], id?: string) => branches.find((b) => b.id === id)?.name ?? '';
export type { Quote };
