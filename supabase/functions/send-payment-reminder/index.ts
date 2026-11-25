// Super admin only: emails renewal / payment reminders to selected businesses (one or many) and logs each one.
// Deploy:  supabase functions deploy send-payment-reminder        (keep JWT verification ON - do NOT use --no-verify-jwt)
// Secrets (same ones send-reminders already uses): RESEND_API_KEY, REMINDER_FROM, APP_URL
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const rupees = (n: number) => `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;

type Row = { id: string; name: string; ownerEmail: string | null; bucket: string; state: string; planName: string | null; endsAt: string | null; daysLeft: number | null; amountDue: number; autopay: boolean };

function compose(r: Row) {
  const plan = r.planName ?? 'plan';
  const amount = r.amountDue > 0 ? ` The renewal amount is ${rupees(r.amountDue)}.` : '';
  if (r.bucket === 'overdue') {
    const never = r.state === 'trial_ended';
    return {
      subject: never ? `Your Eventora trial for ${r.name} has ended` : `Payment pending: your Eventora ${plan} for ${r.name} has ended`,
      lead: never
        ? `Your free trial for ${r.name} has ended and the software is locked. Your data is safe. Subscribe to continue.${amount}`
        : `Your Eventora ${plan} for ${r.name} ended on ${fmt(r.endsAt)} and the payment is still pending.${amount} Please renew to unlock your team. Your data is safe.`,
      cta: 'Pay now',
    };
  }
  const d = r.daysLeft ?? 0;
  const when = d <= 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'} (${fmt(r.endsAt)})`;
  return {
    subject: `Your Eventora ${plan} ends ${when}`,
    lead: `Your Eventora ${plan} for ${r.name} ends ${when}.${amount} Renew now so your team is not locked out.`,
    cta: 'Renew now',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });

    // only the software owner (platform admin) may call this: the database function refuses everyone else
    const { data: rows, error } = await asUser.rpc('platform_collections');
    if (error) return json({ error: 'Only the software owner can send payment reminders.' }, 403);

    const resendKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('REMINDER_FROM'), appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
    if (!resendKey || !from || !appUrl) return json({ error: 'Email is not set up yet (RESEND_API_KEY, REMINDER_FROM, APP_URL). See COLLECTIONS-SETUP.md.' }, 500);

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.tenantIds) ? body.tenantIds.map(String).slice(0, 100) : [];
    const extra = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (ids.length === 0) return json({ error: 'Choose at least one business.' }, 400);

    const byId = new Map((rows as Row[]).map((r) => [r.id, r]));
    let sent = 0, failed = 0;
    const skipped: string[] = [], errors: string[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      if (!r.ownerEmail) { skipped.push(`${r.name} (no email)`); continue; }
      const m = compose(r);
      const link = `${appUrl}/#/admin/billing`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2 style="margin:0 0 12px">${esc(m.subject)}</h2><p style="line-height:1.6;color:#333">${esc(m.lead)}</p>${extra ? `<p style="line-height:1.6;color:#333">${esc(extra)}</p>` : ''}<p style="margin:24px 0"><a href="${link}" style="background:#E6B84A;color:#080B12;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(m.cta)}</a></p><p style="font-size:12px;color:#888">Sent by Eventora OS. ${esc(r.name)}</p></div>`;
      const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` }, body: JSON.stringify({ from, to: [r.ownerEmail], subject: m.subject, html }) });
      if (res.ok) {
        sent++;
        await asUser.rpc('platform_log_followup', { p_tenant: id, p_action: 'email', p_note: m.subject, p_promise: null });
      } else { failed++; errors.push(`${r.name}: ${(await res.text()).slice(0, 120)}`); }
    }
    return json({ sent, failed, skipped, errors });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 500);
  }
});
