import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui';
import { ALL, setBranchScope, useBranchScope } from '@/lib/branch';
import { useQuotes } from '@/lib/api';
import { inrCompact } from '@/lib/format';
import { quotePaymentState } from '@/lib/pricing';
import { totalsForPeriod } from '@/lib/stats';

/** Combined view only: every branch side by side for the chosen period. Click a branch to look at it alone. */
export function BranchCompare({ period }: { period: { from: string; to: string } }) {
  const { scope, branches, multi, isStaff } = useBranchScope();
  const { data: all = [] } = useQuotes({ all: true });
  const rows = useMemo(() => branches.map((b) => {
    const mine = all.filter((q) => q.branchId === b.id);
    const t = totalsForPeriod(mine, period);
    const due = mine.filter((q) => q.status === 'confirmed').reduce((a, q) => a + quotePaymentState(q.pricing).balance, 0);
    return { b, ...t, due };
  }), [branches, all, period]);
  if (!multi || isStaff || scope !== ALL) return null;
  const sum = rows.reduce((a, r) => ({ quotations: a.quotations + r.quotations, booked: a.booked + r.booked, revenue: a.revenue + r.revenue, due: a.due + r.due }), { quotations: 0, booked: 0, revenue: 0, due: 0 });
  const top = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <Card>
      <CardHeader title="Branch comparison" subtitle="All branches side by side for this period. Tap a branch to open only that one." action={<Building2 size={16} className="text-gold" />} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-text-disabled"><th className="px-5 py-2.5 font-medium">Branch</th><th className="px-3 py-2.5 text-right font-medium">Quotations</th><th className="px-3 py-2.5 text-right font-medium">Booked</th><th className="px-3 py-2.5 text-right font-medium">Collected</th><th className="px-5 py-2.5 text-right font-medium">Balance due</th></tr></thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.b.id} className={r.b.active ? '' : 'opacity-60'}>
                <td className="px-5 py-3"><button type="button" onClick={() => setBranchScope(r.b.id)} className="text-left font-medium text-text hover:text-gold">{r.b.name}{r.b.isMain ? <span className="ml-2 text-[10px] text-gold">MAIN</span> : null}</button><span className="mt-1.5 block h-1 rounded-full bg-surface-hover"><span className="block h-1 rounded-full bg-gold" style={{ width: `${(r.revenue / top) * 100}%` }} /></span></td>
                <td className="px-3 py-3 text-right tabular text-text">{r.quotations}</td><td className="px-3 py-3 text-right tabular text-text">{r.booked}</td>
                <td className="px-3 py-3 text-right tabular font-semibold text-text">{inrCompact(r.revenue)}</td><td className="px-5 py-3 text-right tabular text-text-secondary">{inrCompact(r.due)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-border text-text"><td className="px-5 py-3 font-semibold">All branches</td><td className="px-3 py-3 text-right tabular font-semibold">{sum.quotations}</td><td className="px-3 py-3 text-right tabular font-semibold">{sum.booked}</td><td className="px-3 py-3 text-right tabular font-semibold text-gold">{inrCompact(sum.revenue)}</td><td className="px-5 py-3 text-right tabular font-semibold">{inrCompact(sum.due)}</td></tr></tfoot>
        </table>
      </div>
    </Card>
  );
}
