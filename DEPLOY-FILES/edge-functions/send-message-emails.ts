// Eventora OS — Edge Function "send-message-emails"
// E-mails the in-app messages that were sent with the "E-mail" option (campaigns and automatic rules) to the business owners.
// Called (a) by the Super admin screen right after you send a message, using your sign-in, or (b) on a schedule with the x-cron-secret header.
// Deploy:  supabase functions deploy send-message-emails --no-verify-jwt
// Secrets (same as send-reminders): CRON_SECRET, RESEND_API_KEY, REMINDER_FROM (e.g. "Eventora <hello@yourdomain.com>"), APP_URL (your website address)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const secret = Deno.env.get('CRON_SECRET');

  // who is calling: the schedule (secret) or the signed-in software owner
  let allowed = Boolean(secret) && req.headers.get('x-cron-secret') === secret;
  if (!allowed) {
    const auth = req.headers.get('Authorization') ?? '';
    if (auth.startsWith('Bearer ')) {
      const caller = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data } = await caller.rpc('is_platform_admin');
      allowed = data === true;
    }
  }
  if (!allowed) return json({ error: 'Not allowed.' }, 403);

  const resendKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('REMINDER_FROM'), appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  if (!resendKey || !from || !appUrl) return json({ error: 'E-mail is not set up yet. Add the secrets RESEND_API_KEY, REMINDER_FROM and APP_URL to the function.' }, 500);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: queue, error } = await admin.from('notifications').select('id, tenant_id, title, body, action_url, created_at')
    .eq('email_wanted', true).is('email_sent_at', null).order('created_at').limit(100);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, failed = 0, skipped = 0;
  for (const n of queue ?? []) {
    const { data: owners } = await admin.from('members').select('email').eq('tenant_id', n.tenant_id).eq('role', 'owner').eq('active', true);
    const to = (owners ?? []).map((o: { email: string }) => o.email).filter(Boolean);
    if (!to.length) { skipped++; await admin.from('notifications').update({ email_sent_at: new Date().toISOString() }).eq('id', n.id); continue; }
    const link = `${appUrl}/#${n.action_url || '/admin/messages'}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2 style="margin:0 0 12px">${esc(n.title)}</h2><p style="line-height:1.6;color:#333;white-space:pre-line">${esc(n.body)}</p><p style="margin:24px 0"><a href="${link}" style="background:#E6B84A;color:#080B12;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Open Eventora</a></p><p style="font-size:12px;color:#888">Sent by Eventora OS</p></div>`;
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` }, body: JSON.stringify({ from, to, subject: n.title, html }) });
    if (r.ok) { sent++; await admin.from('notifications').update({ email_sent_at: new Date().toISOString() }).eq('id', n.id); } else failed++;
  }
  return json({ sent, failed, skipped });
});
