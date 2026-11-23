import { useState } from 'react';
import { Bell, CheckCheck, Loader2, MessageCircle, Send } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Spinner, Textarea, useUi } from '@/components/ui';
import { KIND_STYLE } from '@/components/noticeStyle';
import { useCreateRequest, useMarkRead, useMyRequests, useNotifications, usePaymentInfo } from '@/lib/apiExt';
import { cn, fmtDate } from '@/lib/format';
import { whatsappLink } from '@/lib/settings';
import { MobileField, useMobile } from '@/components/MobileField';
import { PHONE_ERROR, validPhone } from '@/lib/phone';
import { useLocation } from 'wouter';

const REQ_TONE = { pending: 'warning', approved: 'success', rejected: 'error', closed: 'neutral' } as const;
const KIND_LABEL = { branch: 'Branch request', renewal: 'Renewal request', support: 'Message' } as const;

/** The owner's inbox: messages and reminders from Eventora, and a way to write back. */
export function MessagesPage() {
  const { toast } = useUi();
  const [, navigate] = useLocation();
  const { feed, isLoading } = useNotifications(true);
  const mark = useMarkRead();
  const { data: requests = [] } = useMyRequests(true);
  const { info } = usePaymentInfo(true);
  const create = useCreateRequest();
  const [tab, setTab] = useState<'inbox' | 'contact'>('inbox');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [mobile, setMobile] = useMobile();
  const wa = (info.whatsapp ?? '').replace(/\D/g, '');

  const send = () => {
    if (!validPhone(mobile)) { toast(PHONE_ERROR, 'error'); return; }
    create.mutate({ kind: 'support', subject, message, payload: { contact: mobile.trim() } }, { onSuccess: () => { toast('Message sent.'); setSubject(''); setMessage(''); }, onError: (e) => toast(e.message, 'error') });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 rounded-2xl border border-border bg-surface p-1.5">
          {([['inbox', 'Inbox', feed.unread], ['contact', 'Contact Eventora', 0]] as const).map(([id, label, n]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={cn('flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors', tab === id ? 'bg-gold text-text-on-gold' : 'text-text-secondary hover:text-text')}>{label}{n > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-obsidian/20 px-1.5 text-[11px] font-bold">{n}</span>}</button>
          ))}
        </div>
        {tab === 'inbox' && feed.unread > 0 && <Button variant="outline" onClick={() => mark.mutate(undefined)}><CheckCheck size={15} /> Mark all read</Button>}
      </div>

      {tab === 'inbox' && (
        <Card>
          {isLoading ? <Spinner label="Loading messages" /> : feed.items.length === 0 ? <EmptyState icon={<Bell />} title="No messages yet" text="Reminders, replies and news from Eventora show up here." /> : (
            <ul className="divide-y divide-border/60">
              {feed.items.map((n) => {
                const Icon = KIND_STYLE[n.kind].icon;
                return (
                  <li key={n.id} className={cn('flex gap-4 px-5 py-4', !n.readAt && 'bg-gold/[0.05]')}>
                    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', KIND_STYLE[n.kind].box)}><Icon size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-text">{n.title}</p>{!n.readAt && <Badge tone="gold">New</Badge>}<span className="text-[11px] text-text-disabled">{fmtDate(n.createdAt)}</span></div>
                      <p className="mt-1 whitespace-pre-line text-sm text-text-secondary">{n.body}</p>
                      <div className="mt-2 flex gap-3 text-xs">
                        {n.actionUrl && <button type="button" className="font-medium text-gold hover:underline" onClick={() => { if (!n.readAt) mark.mutate([n.id]); navigate(n.actionUrl as string); }}>Open</button>}
                        {!n.readAt && <button type="button" className="text-text-secondary hover:text-gold" onClick={() => mark.mutate([n.id])}>Mark as read</button>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === 'contact' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader title="Write to us" subtitle="Questions, problems or ideas. You get an instant reply and then our answer." />
            <div className="space-y-4 p-5">
              <MobileField value={mobile} onChange={setMobile} />
              <Field label="Subject" required><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="e.g. Need help with GST on bills" /></Field>
              <Field label="Message" required><Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500} /></Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="gold" onClick={send} disabled={create.isPending}>{create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send message</Button>
                {wa && <a href={whatsappLink(wa, 'Hello, I use Eventora OS and need help.')} target="_blank" rel="noreferrer"><Button variant="outline"><MessageCircle size={15} /> WhatsApp</Button></a>}
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Your requests and messages" />
            {requests.length === 0 ? <EmptyState icon={<MessageCircle />} title="Nothing sent yet" text="Renewal requests, branch requests and messages show here with our reply." /> : (
              <ul className="max-h-[520px] divide-y divide-border/60 overflow-y-auto">
                {requests.map((r) => (
                  <li key={r.id} className="space-y-1 px-5 py-3.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-text">{r.subject || KIND_LABEL[r.kind]}</span><Badge tone={REQ_TONE[r.status]}>{r.status === 'pending' ? 'Waiting' : r.status}</Badge></div>
                    <p className="text-[11px] text-text-disabled">{KIND_LABEL[r.kind]} · {fmtDate(r.createdAt)}</p>
                    {r.message && <p className="whitespace-pre-line text-xs text-text-secondary">{r.message}</p>}
                    {r.note && <p className="rounded-lg bg-input px-3 py-2 text-xs text-text"><span className="text-gold">Reply:</span> {r.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
