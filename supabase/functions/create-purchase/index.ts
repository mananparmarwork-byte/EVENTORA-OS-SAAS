// BUY FIRST: a visitor with no account picks a plan, enters the admin email and pays.
// The payment is remembered against that email; the admin login + business are created automatically at the first sign-in
// (database function claim_purchase). If the email already has a business, the same business is reconnected (renewal).
// Deploy:  supabase functions deploy create-purchase --no-verify-jwt
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   (same ones as create-checkout)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, cyclesFor, ensureRazorpayPlan, getPlan, json } from '../_shared.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { email, period, coupon, businessName } = await req.json();
    const em = String(email ?? '').trim().toLowerCase();
    if (em.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return json({ error: 'Enter a valid email address.' }, 400);

    const keyId = Deno.env.get('RAZORPAY_KEY_ID'), secret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keyId || !secret) return json({ error: 'Online payments are not set up yet. Please contact support.' }, 503);
    const auth = `Basic ${btoa(`${keyId}:${secret}`)}`;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const chosen = await getPlan(admin, period);
    if (!chosen) return json({ error: 'That plan is not available. Please choose another one.' }, 400);

    const pre = await admin.rpc('purchase_precheck', { p_email: em });
    if (pre.error) return json({ error: pre.error.message }, 500);
    if (pre.data?.blocked) return json({ error: pre.data.reason, blocked: true }, 409);

    const price = await admin.rpc('purchase_price', { p_email: em, p_period: period, p_code: coupon ? String(coupon) : null });
    if (price.error || !price.data) return json({ error: price.error?.message ?? 'Could not work out the price.' }, 400);
    const amount: number = price.data.amountPaise;

    const plan = await ensureRazorpayPlan(admin, auth, period, amount, chosen.months, chosen.name);
    if (!plan.id) return json({ error: plan.error }, 502);

    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        plan_id: plan.id, total_count: cyclesFor(chosen.months), customer_notify: 1,
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
