import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Inbox } from 'lucide-react';
import { Button, Card, CardHeader, useUi } from '@/components/ui';
import { useSession } from '@/lib/api';

/** The business's public customer form link, ready to copy, open, or embed in a website. */
export function EnquiryLinkTab() {
  const { toast } = useUi();
  const { session } = useSession();
  const slug = session?.slug ?? '';
  const [copied, setCopied] = useState('');

  const link = useMemo(() => {
    if (!slug) return '';
    const base = `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`;
    return `${base}#/enquiry/${encodeURIComponent(slug)}`;
  }, [slug]);
  const button = `<a href="${link}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#3478F6;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none">Get a quotation</a>`;
  const iframe = `<iframe src="${link}" title="Event enquiry" style="width:100%;max-width:680px;height:860px;border:0;border-radius:16px" loading="lazy"></iframe>`;

  const copy = async (key: string, text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); toast(msg); window.setTimeout(() => setCopied(''), 1800); }
    catch { toast('Copy is blocked in this browser. Select the text and copy it by hand.', 'error'); }
  };

  const box = (key: string, label: string, text: string, msg: string, rows = 1) => (
    <div>
      <p className="mb-1.5 text-xs font-medium text-text-secondary">{label}</p>
      <div className="flex items-start gap-2">
        <textarea readOnly rows={rows} value={text} onFocus={(e) => e.currentTarget.select()} className="min-h-11 w-full resize-none rounded-xl border border-border bg-input px-3.5 py-2.5 font-mono text-xs text-text focus:border-gold focus:outline-none" />
        <Button variant="outline" onClick={() => void copy(key, text, msg)} aria-label={`Copy ${label}`}>{copied === key ? <Check size={15} /> : <Copy size={15} />} Copy</Button>
      </div>
    </div>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader title="Customer enquiry link" subtitle="Put this link on your website. Customers fill the form; you call them back." />
        <div className="space-y-5 p-5">
          {!slug ? <p className="text-sm text-text-secondary">Your business link is not ready yet. Reload the page and try again.</p> : (
            <>
              {box('link', 'Your link', link, 'Link copied.')}
              <div className="flex flex-wrap gap-2.5">
                <a href={link} target="_blank" rel="noreferrer"><Button variant="gold"><ExternalLink size={15} /> Open the form</Button></a>
              </div>
              <div className="gold-rule" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Add it to your website</p>
              {box('button', 'Option 1 · a button that opens the form', button, 'Button code copied.', 3)}
              {box('iframe', 'Option 2 · the form shown inside your page', iframe, 'Embed code copied.', 3)}
              <p className="text-xs text-text-secondary">Paste the code into any page of your website (an “HTML / custom code” block works in Wix, WordPress, Hostinger and others). The same link works for every customer; each one is saved as a separate draft with its own bill number.</p>
            </>
          )}
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="How it works" />
        <ol className="space-y-4 p-5 text-sm text-text-secondary">
          {[
            ['A customer opens your link', 'and fills name, mobile, e-mail, event type, guests, date and time. No bill number, GST or PAN is asked.'],
            ['It lands in Quotations → Drafts', 'with its own bill number. You also get a notification. Drafts are not counted as quotations, bookings or revenue.'],
            ['You call the customer', 'then open the draft, choose the services in Step 2 and press Save. It moves into Quotations.'],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-gold/15 text-xs font-semibold text-gold">{i + 1}</span><span><strong className="block text-text">{t}</strong>{d}</span></li>
          ))}
        </ol>
        <div className="flex items-center gap-2 border-t border-border/70 px-5 py-3 text-xs text-text-secondary"><Globe size={13} /> Works for every business on Eventora: each one has its own link.<Inbox size={13} className="ml-auto shrink-0" /></div>
      </Card>
    </div>
  );
}
