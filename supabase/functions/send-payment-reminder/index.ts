// Super admin only: e-mails renewal / payment reminders to business owners (Super admin -> Collections).
// Deploy (keep JWT verification ON):  supabase functions deploy send-payment-reminder
// Secrets (same as send-reminders): RESEND_API_KEY, REMINDER_FROM (e.g. "Eventora <billing@yourdomain.com>"), APP_URL (your website address)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Row = { id: string; name: string; ownerEmail: string | null; state: string; bucket: string; planName: string; endsAt: string | null; daysLeft: number | null; amountDue: number };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

function build(r: Row, note: string, appUrl: string) {
  const link = `${appUrl}/#/admin/billing`;
  const overdue = r.bucket === 'overdue';
  const trialEnded = overdue && r.state === 'trial_ended';
  const days = Math.max(0, r.daysLeft ?? 0);
  let subject: string, lead: string, cta: string;
  if (trialEnded) {
    subject = `Your Eventora trial has ended`;
    lead = `Your free trial for ${r.name} has ended. To keep using Eventora OS, please renew with the ${r.planName} plan (${rs(r.amountDue)}).`;
    cta = 'Pay now';
  } else if (overdue) {
    subject = `Payment pending for Eventora OS`;
    lead = `Your payment for ${r.name} is pending. Your plan ended on ${fmtDate(r.endsAt)}. Please pay ${rs(r.amountDue)} for the ${r.planName} plan to continue.`;
    cta = 'Pay now';
  } else {
    subject = `Your Eventora plan ends in ${days} day${days === 1 ? '' : 's'}`;
    lead = `Your plan for ${r.name} ends in ${days} day${days === 1 ? '' : 's'} (${fmtDate(r.endsAt)}). To renew the ${r.planName} plan, please pay ${rs(r.amountDue)}.`;
    cta = 'Renew now';
  }
  const extra = note.trim() ? `<p style="line-height:1.6;color:#333">${esc(note.trim())}</p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2 style="margin:0 0 12px;color:#101D35">${esc(subject)}</h2><p style="line-height:1.6;color:#333">${esc(lead)}</p>${extra}<p style="margin:24px 0"><a href="${esc(link)}" style="background:#3478F6;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(cta)}</a></p><p style="font-size:12px;color:#888">Sent by Eventora OS for ${esc(r.name)}.</p></div>`;
  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Not signed in.' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } } });

  // only the software owner may call this: platform_collections() refuses everybody else
  const { data: rows, error: rowsErr } = await user.rpc('platform_collections');
  if (rowsErr) return json({ error: 'Only the Super admin can send payment reminders.' }, 403);

  const resendKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('REMINDER_FROM'), appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  if (!resendKey || !from || !appUrl) return json({ error: 'E-mail is not set up. Add the secrets RESEND_API_KEY, REMINDER_FROM and APP_URL, then deploy again.' }, 500);

  let body: { tenantIds?: unknown; note?: unknown } = {};
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const ids = Array.isArray(body.tenantIds) ? body.tenantIds.filter((x): x is string => typeof x === 'string').slice(0, 100) : [];
  if (ids.length === 0) return json({ error: 'Choose at least one business.' }, 400);
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : '';

  const byId = new Map((rows as Row[]).map((r) => [r.id, r]));
  let sent = 0, failed = 0;
  const skipped: string[] = [], errors: string[] = [];

  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { skipped.push(id); continue; }
    if (!r.ownerEmail) { skipped.push(r.name); continue; }
    const m = build(r, note, appUrl);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({ from, to: [r.ownerEmail], subject: m.subject, html: m.html }),
      });
      if (!res.ok) { failed++; errors.push(`${r.name}: ${(await res.text()).slice(0, 120)}`); continue; }
      sent++;
      await user.rpc('platform_log_followup', { p_tenant: id, p_action: 'email', p_note: note.slice(0, 200), p_promise: null });
    } catch (e) { failed++; errors.push(`${r.name}: ${e instanceof Error ? e.message : 'send failed'}`); }
  }
  return json({ sent, failed, skipped, errors });
});
