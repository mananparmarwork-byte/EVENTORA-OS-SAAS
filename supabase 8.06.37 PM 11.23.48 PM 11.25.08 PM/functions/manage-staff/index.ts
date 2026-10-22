// Eventora OS — Edge Function "manage-staff"
// Lets a business OWNER add, delete and reset the password of THEIR OWN employees from inside the app (no SQL, no dashboard).
// It runs on Supabase's servers, where the service-role key lives (injected automatically, NEVER sent to the browser).
// Every call is checked with the caller's own token: they must be a signed-in owner of a business (my_context(), which also
// enforces two-step verification when the owner has turned it on), and they can only touch employees of THAT business.
//
// Deploy once:  supabase functions deploy manage-staff     (or Dashboard -> Edge Functions -> Deploy a new function -> name: manage-staff)

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*', // the call is protected by the signed-in owner's token, not by the origin
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EMPLOYEES = 20; // simple plan limit; change here (or read it from the business's plan) when you introduce tiers

/** At least 10 characters, with a letter and a digit. */
function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'The password must be at least 10 characters.';
  if (pw.length > 72) return 'The password is too long (72 characters at most).';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'The password must contain at least one letter and one number.';
  return null;
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

  // 1) Who is calling? Use the caller's own token, so the database decides (RLS + two-step verification).
  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Your session has expired. Please sign in again.' }, 401);
  const { data: ctx, error: ctxErr } = await caller.rpc('my_context');
  if (ctxErr || !ctx || ctx.role !== 'admin' || !ctx.tenantId) return json({ error: 'Only the owner can manage employees.' }, 403);
  const tenantId: string = ctx.tenantId;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const action = String(body.action ?? '');

  // 2) From here on we use the service-role client (server only).
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!EMAIL.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
      const pwErr = passwordProblem(body.password);
      if (pwErr) return json({ error: pwErr }, 400);

      const { count } = await admin.from('members').select('user_id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'staff');
      if ((count ?? 0) >= MAX_EMPLOYEES) return json({ error: `Your plan allows up to ${MAX_EMPLOYEES} employees.` }, 400);

      // The email is marked verified because the owner vouches for it; the employee never signs up on their own.
      const { data, error } = await admin.auth.admin.createUser({ email, password: String(body.password), email_confirm: true });
      if (error || !data.user) {
        const msg = error?.message ?? 'Could not create the login.';
        return json({ error: /already|registered|exists/i.test(msg) ? 'That email already has a login.' : msg }, 400);
      }
      const { error: insErr } = await admin.from('members').insert({ user_id: data.user.id, tenant_id: tenantId, role: 'staff', email, active: true });
      if (insErr) {
        await admin.auth.admin.deleteUser(data.user.id); // do not leave a login without a role
        return json({ error: 'Could not save the employee: ' + insErr.message }, 400);
      }
      return json({ ok: true, id: data.user.id, email });
    }

    const id = String(body.id ?? '');
    if (!UUID.test(id)) return json({ error: 'Unknown employee.' }, 400);
    if (id === userData.user.id) return json({ error: 'You cannot do this to your own account.' }, 400);
    // the target must be an EMPLOYEE of THIS business (never an owner, never someone from another business)
    const { data: target } = await admin.from('members').select('user_id,role,tenant_id').eq('user_id', id).maybeSingle();
    if (!target || target.tenant_id !== tenantId) return json({ error: 'That person is not an employee of your business.' }, 404);
    if (target.role !== 'staff') return json({ error: 'That account is an owner. Owners cannot be changed here.' }, 403);

    if (action === 'delete') {
      // Deleting the login also removes their member row. Bills they created stay (created_by_email keeps the name).
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'resetPassword') {
      const pwErr = passwordProblem(body.password);
      if (pwErr) return json({ error: pwErr }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password: String(body.password) });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 500);
  }
});
