import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CalendarDays } from 'lucide-react';
import { Card, CardHeader, EmptyState, Spinner } from '@/components/ui';
import { MonthGrid } from '@/components/MonthGrid';
import { StatusBadge } from '@/components/PaymentBadge';
import { useQuotes, useSession } from '@/lib/api';
import { ALL, branchName, useBranchScope } from '@/lib/branch';
import { fmtDate, inr, cn } from '@/lib/format';
import { freeWindows, occupancyEntries, rangesText, timeText, toMinutes } from '@/lib/booking';
import { quoteDates } from '@/lib/pricing';
import type { Quote, TimeRange } from '@/lib/types';

type Entry = { quote: Quote; range: TimeRange; timeKnown: boolean; booked: boolean };

/** One colour per branch, so a combined calendar shows at a glance which branch each booking belongs to. */
const BRANCH_COLORS = ['#3478F6', '#16A36A', '#E9A23B', '#8B5CF6', '#E5484D', '#0EA5A5'];
const stripeOf = (c: string) => `repeating-linear-gradient(45deg,${c}66,${c}66 3px,${c}33 3px,${c}33 6px)`;
const STRIPE = { backgroundImage: 'repeating-linear-gradient(45deg,#C3D3EE,#C3D3EE 3px,#A6BDE3 3px,#A6BDE3 6px)' } as const;

function DayBar({ list, tall = false, colorOf }: { list: Entry[]; tall?: boolean; colorOf?: (branchId?: string) => string | null }) {
  return (
    <span className={cn('relative block w-full overflow-hidden rounded-sm bg-input', tall ? 'h-3' : 'h-1.5')} aria-hidden="true">
      {list.map((e) => {
        const from = toMinutes(e.range.start) ?? 0;
        const to = toMinutes(e.range.end) ?? 1440;
        const c = colorOf?.(e.quote.branchId);
        const look = c ? (e.booked ? { backgroundColor: c } : { backgroundImage: stripeOf(c) }) : (e.booked ? {} : STRIPE);
        return <i key={`${e.quote.reference}-${e.range.start}`} className={cn('absolute inset-y-0 block', e.booked && !c && 'bg-gold')} style={{ left: `${(from / 1440) * 100}%`, width: `${Math.max(3, ((to - from) / 1440) * 100)}%`, ...look }} />;
      })}
    </span>
  );
}

export function CalendarPage() {
  const { data: quotes = [], isLoading } = useQuotes();
  const { isAdmin } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const { scope, branches, multi } = useBranchScope();
  // branch colours and labels only appear when the owner looks at several branches together
  const combined = multi && scope === ALL;
  const colorOf = (id?: string) => (combined ? BRANCH_COLORS[Math.max(0, branches.findIndex((b) => b.id === id)) % BRANCH_COLORS.length] : null);
  const nameOf = (id?: string) => branchName(branches, id) || 'Branch';
  const toggleBranch = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  const byDate = useMemo(() => {
    const map: Record<string, Entry[]> = {};
    quotes.filter((q) => q.status !== 'archived' && !(combined && hidden.includes(q.branchId ?? ''))).forEach((q) => {
      occupancyEntries(quoteDates(q.customer), q.customer.eventSlots).forEach((e) => {
        map[e.date] = [...(map[e.date] ?? []), { quote: q, range: e.range, timeKnown: e.timeKnown, booked: q.status === 'confirmed' }];
      });
    });
    return map;
  }, [quotes, combined, hidden]);

  if (isLoading) return <Spinner label="Loading calendar" />;
  const list = selected ? byDate[selected] ?? [] : [];
  const bookedRanges = list.filter((e) => e.booked).map((e) => e.range);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Venue calendar" subtitle={combined ? 'Each colour is a branch. Solid bars are confirmed bookings, striped bars are open enquiries.' : 'Blue bars are confirmed bookings, striped bars are open enquiries.'} />
        {combined && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-3">
            <span className="text-xs font-medium text-text-secondary">Branches:</span>
            {branches.filter((b) => b.active).map((b) => {
              const off = hidden.includes(b.id);
              const count = quotes.filter((q) => q.branchId === b.id && q.status !== 'archived').length;
              return (
                <button key={b.id} type="button" onClick={() => toggleBranch(b.id)} aria-pressed={!off} className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors', off ? 'border-border text-text-disabled line-through' : 'border-border bg-surface text-text hover:border-steel-blue')}>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: colorOf(b.id) ?? undefined, opacity: off ? 0.3 : 1 }} />{b.name}<span className="text-text-disabled">{count}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="p-4 sm:p-6">
          <MonthGrid renderDay={(iso, today) => {
            const entries = byDate[iso] ?? [];
            const booked = entries.filter((e) => e.booked);
            const active = selected === iso;
            return (
              <button type="button" onClick={() => setSelected(iso)} aria-label={`${fmtDate(iso)}: ${entries.length} entries`}
                className={cn('flex h-[74px] w-full flex-col justify-between rounded-xl border p-2 text-left transition-colors sm:h-[92px]',
                  active ? 'border-gold bg-gold/10' : 'border-border/70 bg-input/40 hover:border-steel-blue hover:bg-surface-hover')}>
                <span className="flex items-center justify-between">
                  <span className={cn('grid size-6 place-items-center rounded-full text-xs font-semibold', today ? 'bg-gold text-text-on-gold' : 'text-text')}>{Number(iso.slice(8))}</span>
                  {entries.length > 0 && <span className="text-[10px] font-semibold text-text-secondary">{booked.length > 0 ? `${booked.length} booked` : `${entries.length} enq.`}</span>}
                </span>
                {entries.length > 0 ? (
                  <span className="block space-y-1">
                    {combined && <span className="hidden flex-wrap gap-0.5 sm:flex">{Array.from(new Set(entries.map((e) => e.quote.branchId))).slice(0, 3).map((id) => <span key={id} className="max-w-full truncate rounded px-1 text-[9px] font-semibold text-white" style={{ backgroundColor: colorOf(id) ?? undefined }}>{nameOf(id).slice(0, 8)}</span>)}</span>}
                    <DayBar list={entries} colorOf={colorOf} />
                  </span>
                ) : <span />}
              </button>
            );
          }} />
        </div>
      </Card>

      <Card className="h-fit xl:sticky xl:top-24">
        <CardHeader title={selected ? fmtDate(selected, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Pick a date'} subtitle={selected ? `${list.length} entr${list.length === 1 ? 'y' : 'ies'}` : 'Select a day to see its bookings'} />
        {!selected ? <EmptyState icon={<CalendarDays />} title="No date selected" text="Click any day in the calendar." /> : (
          <div className="space-y-4 p-5">
            <div><DayBar list={list} tall colorOf={colorOf} /><div className="mt-1 flex justify-between text-[10px] text-text-disabled"><span>12 AM</span><span>12 PM</span><span>12 AM</span></div></div>
            {combined ? (
              <div className="space-y-1.5 rounded-xl bg-input px-3 py-2.5 text-xs text-text-secondary">
                <p className="font-medium text-text">Free time in each branch</p>
                {branches.filter((b) => b.active && !hidden.includes(b.id)).map((b) => {
                  const r = list.filter((e) => e.booked && e.quote.branchId === b.id).map((e) => e.range);
                  return <p key={b.id} className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(b.id) ?? undefined }} /><span className="font-medium text-text">{b.name}:</span>{r.length === 0 ? <span className="text-success">whole day free</span> : <span className="text-success">{rangesText(freeWindows(r), true) || 'fully booked'}</span>}</p>;
                })}
              </div>
            ) : (
              <p className="rounded-xl bg-input px-3 py-2.5 text-xs text-text-secondary">
                {bookedRanges.length === 0 ? 'Whole day is free for new bookings.' : <>Free: <span className="font-medium text-success">{rangesText(freeWindows(bookedRanges), true) || 'fully booked'}</span></>}
              </p>
            )}
            {list.length === 0 ? <p className="text-sm text-text-secondary">No bookings or enquiries on this day.</p> : (
              <ul className="space-y-2.5">
                {list.map((e) => (
                  <li key={`${e.quote.reference}-${e.range.start}`}>
                    <Link href={`/admin/quotes/${encodeURIComponent(e.quote.reference)}`} className="block rounded-xl border border-border border-l-4 bg-input/50 p-3.5 transition-colors hover:border-gold/60" style={combined ? { borderLeftColor: colorOf(e.quote.branchId) ?? undefined } : undefined}>
                      {combined && <p className="mb-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: colorOf(e.quote.branchId) ?? undefined }}>{nameOf(e.quote.branchId)}</p>}
                      <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-text">{e.quote.customer.name}</p><StatusBadge status={e.quote.status} /></div>
                      <p className="mt-1 text-xs text-text-secondary">{e.quote.customer.eventType} · {e.timeKnown ? timeText(e.range) : 'Time not set (whole day held)'}</p>
                      <p className="mt-1 text-xs text-text-disabled">{e.quote.reference} · {e.quote.customer.guests} guests{isAdmin ? ` · ${inr(e.quote.pricing.grandTotal)}` : ''}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
