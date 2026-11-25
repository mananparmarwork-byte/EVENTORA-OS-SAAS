import { Building2, Layers } from 'lucide-react';
import { ALL, useBranchScope } from '@/lib/branch';
import { cn } from '@/lib/format';

/** Owner only, and only when the business has more than one branch: choose one branch, or "All branches" for combined numbers. */
export function BranchSwitcher({ className }: { className?: string }) {
  const { scope, setScope, activeBranches, branches, multi, isStaff } = useBranchScope();
  if (!multi || isStaff) return null;
  const list = activeBranches.length ? activeBranches : branches;
  const combined = scope === ALL;
  return (
    <label className={cn('relative flex h-10 items-center gap-2 rounded-xl border px-3 text-sm transition-colors', combined ? 'border-border bg-input text-text' : 'border-gold/60 bg-gold/10 text-gold', className)} title="Choose which branch you are looking at">
      {combined ? <Layers size={16} className="shrink-0 text-gold" /> : <Building2 size={16} className="shrink-0" />}
      <span className="sr-only">Branch</span>
      <select value={scope} onChange={(e) => setScope(e.target.value)} className="max-w-[9.5rem] cursor-pointer appearance-none truncate bg-transparent pr-1 font-medium focus:outline-none sm:max-w-[13rem]" aria-label="Branch">
        <option value={ALL} className="bg-surface text-text">All branches (combined)</option>
        {list.map((b) => <option key={b.id} value={b.id} className="bg-surface text-text">{b.name}{b.active ? '' : ' (off)'}</option>)}
      </select>
    </label>
  );
}
