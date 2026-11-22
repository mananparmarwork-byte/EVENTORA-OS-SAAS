import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Bell, CheckCheck } from 'lucide-react';
import { useMarkRead, useNotifications } from '@/lib/apiExt';
import { KIND_STYLE } from '@/components/noticeStyle';
import { cn, fmtDate } from '@/lib/format';

/** The owner's bell: unread count and the latest messages from Eventora (reminders, replies, approvals). */
export function NotificationBell() {
  const { feed } = useNotifications(true);
  const mark = useMarkRead();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  const latest = feed.items.slice(0, 6);
  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={`Messages${feed.unread ? `, ${feed.unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="relative grid size-10 place-items-center rounded-xl text-text-secondary transition-colors hover:bg-surface hover:text-text">
        <Bell size={19} />
        {feed.unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-[17px] place-items-center rounded-full bg-gold px-1 text-[10px] font-bold leading-[17px] text-text-on-gold">{feed.unread > 9 ? '9+' : feed.unread}</span>}
      </button>
      {open && (
        <div className="fade-up absolute right-0 top-12 z-40 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <p className="text-sm font-semibold text-text">Messages</p>
            {feed.unread > 0 && <button type="button" onClick={() => mark.mutate(undefined)} className="inline-flex items-center gap-1 text-[11px] text-gold hover:underline"><CheckCheck size={13} /> Mark all read</button>}
          </div>
          {latest.length === 0 ? <p className="px-4 py-8 text-center text-sm text-text-secondary">No messages yet.</p> : (
            <ul className="max-h-[360px] divide-y divide-border/60 overflow-y-auto">
              {latest.map((n) => {
                const Icon = KIND_STYLE[n.kind].icon;
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => { if (!n.readAt) mark.mutate([n.id]); setOpen(false); navigate(n.actionUrl || '/admin/messages'); }} className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover', !n.readAt && 'bg-gold/[0.05]')}>
                      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', KIND_STYLE[n.kind].box)}><Icon size={15} /></span>
                      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-medium text-text">{n.title}</span>{!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-gold" />}</span><span className="line-clamp-2 text-xs text-text-secondary">{n.body}</span><span className="mt-0.5 block text-[10px] text-text-disabled">{fmtDate(n.createdAt)}</span></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/admin/messages" onClick={() => setOpen(false)} className="block border-t border-border/70 px-4 py-3 text-center text-xs font-medium text-gold hover:bg-surface-hover">Open all messages</Link>
        </div>
      )}
    </div>
  );
}
