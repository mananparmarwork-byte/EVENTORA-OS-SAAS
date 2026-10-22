// BUY FIRST: a visitor with no account picks a plan, enters the admin email and pays.
// The payment is remembered against that email; the admin login + business are created automatically at the first sign-in
// (database function claim_purchase). If the email already has a business, the same business is reconnected (renewal).
// Deploy:  supabase functions deploy create-purchase --no-verify-jwt
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   (same ones as create-checkout)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const INTERVAL: Record<string, { period: 'monthly' | 'yearly'; interval: number }> = {
  monthly: { period: 'monthly', interval: 1 }, quarterly: { period: 'monthly', interval: 3 }, yearly: { period: 'yearly', interval: 1 },
};
const CYCLES: Record<string, number> = { monthly: 120, quarterly: 40, yearly: 10 };

// deno-lint-ignore no-explicit-any
async function ensureRazorpayPlan(admin: any, auth: string, period: string, amount: number): Promise<{ id?: string; error?: string }> {
  const found = await admin.from('razorpay_plan_variants').select('razorpay_plan_id').eq('period', period).eq('amount_paise', amount).maybeSingle();
  if (found.data?.razorpay_plan_id) return { id: found.data.razorpay_plan_id as string };
  const pr = await fetch('https://api.razorpay.com/v1/plans', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ ...INTERVAL[period], item: { name: `Eventora Pro (${period})`, amount, currency: 'INR' } }),
  });
  const plan = await pr.json();
  if (!pr.ok || !plan.id) return { error: plan?.error?.description ?? 'Could not create the plan at Razorpay.' };
  await admin.from('razorpay_plan_variants').upsert({ period, amount_paise: amount, razorpay_plan_id: plan.id });
  return { id: plan.id as string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { email, period, coupon, businessName } = await req.json();
    const em = String(email ?? '').trim().toLowerCase();
    if (em.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return json({ error: 'Enter a valid email address.' }, 400);
    if (!INTERVAL[period]) return json({ error: 'Choose monthly, quarterly or yearly.' }, 400);

    const keyId = Deno.env.get('RAZORPAY_KEY_ID'), secret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keyId || !secret) return json({ error: 'Online payments are not set up yet. Please contact support.' }, 503);
    const auth = `Basic ${btoa(`${keyId}:${secret}`)}`;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const pre = await admin.rpc('purchase_precheck', { p_email: em });
    if (pre.error) return json({ error: pre.error.message }, 500);
    if (pre.data?.blocked) return json({ error: pre.data.reason, blocked: true }, 409);

    const price = await admin.rpc('purchase_price', { p_email: em, p_period: period, p_code: coupon ? String(coupon) : null });
    if (price.error || !price.data) return json({ error: price.error?.message ?? 'Could not work out the price.' }, 400);
    const amount: number = price.data.amountPaise;

    const plan = await ensureRazorpayPlan(admin, auth, period, amount);
    if (!plan.id) return json({ error: plan.error }, 502);

    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        plan_id: plan.id, total_count: CYCLES[period], customer_notify: 1,
        notify_info: { notify_email: em },
        notes: { email: em, period, coupon: price.data.code ?? '', source: 'buy-first' },
      }),
    });
    const created = await res.json();
    if (!res.ok || !created.id) return json({ error: created?.error?.description ?? 'Could not start the payment.' }, 502);

    const ins = await admin.from('purchases').insert({
      email: em, period, amount_paise: amount, coupon_code: price.data.code ?? null,
      business_name: businessName ? String(businessName).trim().slice(0, 80) || null : null,
      provider_subscription_id: created.id, status: 'pending',
    }).select('id').single();
    if (ins.error || !ins.data) return json({ error: ins.error?.message ?? 'Could not save the order.' }, 500);

    return json({ purchaseId: ins.data.id, url: created.short_url, amountPaise: amount });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 500);
  }
});
