// Emails owners before their trial / plan ends (7, 3 and 1 day before, and the day it ends). Run daily by pg_cron (see 09-reminder-cron.sql).
// Deploy:  supabase functions deploy send-reminders --no-verify-jwt
// Secrets: CRON_SECRET (any long random text), RESEND_API_KEY (from resend.com), REMINDER_FROM (e.g. "Eventora <billing@yourdomain.com>"), APP_URL (your website address)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Due = { tenantId: string; tenantName: string; email: string; status: string; autopay: boolean; endAt: string; days: number; kind: string; ref: string };

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

function message(d: Due, appUrl: string) {
  const isTrial = d.kind.startsWith('trial');
  const ended = d.kind.endsWith('_ended');
  const what = isTrial ? 'free trial' : 'plan';
  const link = `${appUrl}/#/admin/billing`;
  if (ended) return { subject: `Your Eventora ${what} has ended`, lead: `Your ${what} for ${d.tenantName} ended on ${fmt(d.endAt)}. The software is locked until you subscribe. Your data is safe.`, cta: 'Subscribe now' };
  if (isTrial && d.autopay) return { subject: `Your Eventora trial ends in ${d.days} day${d.days === 1 ? '' : 's'}`, lead: `Your free trial for ${d.tenantName} ends on ${fmt(d.endAt)}. You set up autopay, so your first payment is taken automatically then. Nothing to do.`, cta: 'View billing' };
  return { subject: `Your Eventora ${what} ends in ${d.days} day${d.days === 1 ? '' : 's'}`, lead: `Your ${what} for ${d.tenantName} ends on ${fmt(d.endAt)}. Choose a plan now (set up autopay once and you never have to remember) so your team is not locked out.`, cta: 'Choose a plan' };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 });
  const resendKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('REMINDER_FROM'), appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  if (!resendKey || !from || !appUrl) return new Response('email is not configured (RESEND_API_KEY, REMINDER_FROM, APP_URL)', { status: 500 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin.rpc('due_reminders');
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, failed = 0;
  for (const d of (data ?? []) as Due[]) {
    const m = message(d, appUrl);
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2 style="margin:0 0 12px">${m.subject}</h2><p style="line-height:1.6;color:#333">${m.lead}</p><p style="margin:24px 0"><a href="${appUrl}/#/admin/billing" style="background:#E6B84A;color:#080B12;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${m.cta}</a></p><p style="font-size:12px;color:#888">Sent by Eventora OS. ${d.tenantName}</p></div>`;
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` }, body: JSON.stringify({ from, to: [d.email], subject: m.subject, html }) });
    if (r.ok) { await admin.rpc('mark_reminder_sent', { p_tenant: d.tenantId, p_kind: d.kind, p_ref: d.ref }); sent++; } else failed++;
  }
  return new Response(JSON.stringify({ sent, failed }), { headers: { 'Content-Type': 'application/json' } });
});
