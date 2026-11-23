// Eventora OS — Edge Function "platform-owners"
// For the SOFTWARE OWNER only (Super admin): add a new owner (login + business + access), add another owner login to an existing business,
// and reset an owner's password. It runs on Supabase's servers, where the service-role key lives (injected automatically, NEVER sent to the browser).
// Every call is checked with the caller's own token: is_platform_admin() must be true (and two-step verification is enforced by the database).
//
// Deploy once:  supabase functions deploy platform-owners
//
// Actions (JSON body):
//   { action: 'create', email, password, businessName, businessType, phone, period, until, amountRupees, note, tenantId? }
//        until = 'YYYY-MM-DD' or ISO date: access until that date. Empty = free trial (length is set in Super admin -> Settings).
//        tenantId = add this login as one more owner of an EXISTING business instead of making a new business.
//   { action: 'resetPassword', tenantId, password }

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*', // protected by the signed-in software owner's token, not by the origin
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At least 10 characters, with a letter and a digit (same rule as the rest of the app). */
function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'The password must be at least 10 characters.';
  if (pw.length > 72) return 'The password is too long (72 characters at most).';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'The password must contain at least one letter and one number.';
  return null;
}

/** 'YYYY-MM-DD' means the END of that day in India (so "until 30 Nov" includes 30 Nov). */
function untilIso(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T23:59:59+05:30`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'The function is not configured on the server.' }, 500);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Please sign in.' }, 401);

  // 1) Who is calling? The database decides (is_platform_admin also checks two-step verification).
  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Your session has expired. Please sign in again.' }, 401);
  const { data: isPlatform, error: platErr } = await caller.rpc('is_platform_admin');
  if (platErr || isPlatform !== true) return json({ error: 'Only the software owner can do this.' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const action = String(body.action ?? '');

  // 2) From here on we may use the service-role client (server only).
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!EMAIL.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
      const pwErr = passwordProblem(body.password);
      if (pwErr) return json({ error: pwErr }, 400);
      const tenantId = String(body.tenantId ?? '');
      if (tenantId && !UUID.test(tenantId)) return json({ error: 'Unknown business.' }, 400);
      if (!tenantId && String(body.businessName ?? '').trim().length < 2) return json({ error: 'Enter the business name.' }, 400);
      if (!tenantId && String(body.phone ?? '').replace(/\D/g, '').length < 10) return json({ error: 'Enter the owner mobile number (at least 10 digits).' }, 400);
      const until = untilIso(body.until);
      if (body.until && !until) return json({ error: 'The access date is not valid.' }, 400);
      if (until && new Date(until).getTime() <= Date.now()) return json({ error: 'Choose an access date in the future.' }, 400);
      const amount = Math.max(0, Math.round(Number(body.amountRupees ?? 0) * 100)) || 0;

      // Is there already a login with this email? (e.g. somebody who tried to sign up earlier)
      const found = await caller.rpc('platform_find_user', { p_email: email });
      if (found.error) return json({ error: found.error.message }, 400);
      const f = found.data as { found: boolean; id?: string; hasBusiness?: boolean; businessName?: string } | null;
      let userId = '';
      let createdLogin = false;
      if (f?.found && f.id) {
        if (f.hasBusiness) return json({ error: `That email already belongs to the business "${f.businessName ?? 'another business'}". Use a different email.` }, 400);
        userId = f.id;
        const upd = await admin.auth.admin.updateUserById(userId, { password: String(body.password), email_confirm: true });
        if (upd.error) return json({ error: upd.error.message }, 400);
      } else {
        // The email is marked verified because you (the software owner) vouch for it; the owner never signs up on their own.
        const { data, error } = await admin.auth.admin.createUser({ email, password: String(body.password), email_confirm: true });
        if (error || !data.user) {
          const msg = error?.message ?? 'Could not create the login.';
          return json({ error: /already|registered|exists/i.test(msg) ? 'That email already has a login.' : msg }, 400);
        }
        userId = data.user.id;
        createdLogin = true;
      }

      const made = await caller.rpc('platform_create_owner', {
        p_user: userId, p_email: email, p_name: String(body.businessName ?? ''), p_type: String(body.businessType ?? ''), p_phone: String(body.phone ?? ''),
        p_period: String(body.period ?? '') || null, p_until: until, p_amount_paise: amount, p_note: String(body.note ?? ''), p_tenant: tenantId || null,
      });
      if (made.error) {
        if (createdLogin) await admin.auth.admin.deleteUser(userId); // do not leave a login without a business
        return json({ error: made.error.message }, 400);
      }
      return json({ ok: true, email, userId, linkedExistingLogin: !createdLogin, ...(made.data as Record<string, unknown>) });
    }

    if (action === 'resetPassword') {
      const tenantId = String(body.tenantId ?? '');
      if (!UUID.test(tenantId)) return json({ error: 'Unknown business.' }, 400);
      const pwErr = passwordProblem(body.password);
      if (pwErr) return json({ error: pwErr }, 400);
      const owner = await caller.rpc('platform_tenant_owner', { p_tenant: tenantId });
      if (owner.error) return json({ error: owner.error.message }, 400);
      const o = owner.data as { found: boolean; userId?: string; email?: string } | null;
      if (!o?.found || !o.userId) return json({ error: 'This business has no owner login yet.' }, 404);
      const { error } = await admin.auth.admin.updateUserById(o.userId, { password: String(body.password) });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, email: o.email });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 500);
  }
});
