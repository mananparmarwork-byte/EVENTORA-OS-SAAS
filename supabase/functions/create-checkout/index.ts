// Starts a Razorpay AUTOPAY subscription for the signed-in owner's business and returns the hosted payment link.
// The customer authorises autopay once (UPI AutoPay / card / e-mandate); Razorpay then debits every period by itself.
// Deploy:  supabase functions deploy create-checkout
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
// Prices come from the `plans` table (set in the "All businesses" panel); a Razorpay plan is created automatically per price.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// ---- helpers (inlined from _shared.ts so this function is a single self-contained file) ----
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Razorpay billing interval for a plan that lasts `months` months (1, 3, 12, or anything the software owner creates).
// Whole years use Razorpay's yearly period; everything else is counted in months.
const intervalFor = (months: number): { period: 'monthly' | 'yearly'; interval: number } =>
  months % 12 === 0 ? { period: 'yearly', interval: months / 12 } : { period: 'monthly', interval: months };
// About 10 years of billing cycles (120 for monthly, 40 for quarterly, 10 for yearly: same as before).
const cyclesFor = (months: number): number => Math.max(1, Math.ceil(120 / months));

// deno-lint-ignore no-explicit-any
async function getPlan(admin: any, period: string): Promise<{ name: string; months: number } | null> {
  const r = await admin.from('plans').select('name, months, active').eq('period', String(period)).maybeSingle();
  if (r.error || !r.data || !r.data.active) return null;
  return { name: String(r.data.name ?? period), months: Number(r.data.months ?? 1) };
}

// deno-lint-ignore no-explicit-any
async function ensureRazorpayPlan(admin: any, auth: string, period: string, amount: number, months: number, name: string): Promise<{ id?: string; error?: string }> {
  const found = await admin.from('razorpay_plan_variants').select('razorpay_plan_id').eq('period', period).eq('amount_paise', amount).maybeSingle();
  if (found.data?.razorpay_plan_id) return { id: found.data.razorpay_plan_id as string };
  const pr = await fetch('https://api.razorpay.com/v1/plans', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ ...intervalFor(months), item: { name: `Eventora Pro (${name})`.slice(0, 100), amount, currency: 'INR' } }),
  });
  const plan = await pr.json();
  if (!pr.ok || !plan.id) return { error: plan?.error?.description ?? 'Could not create the plan at Razorpay.' };
  await admin.from('razorpay_plan_variants').upsert({ period, amount_paise: amount, razorpay_plan_id: plan.id });
  return { id: plan.id as string };
}
// ---- end helpers ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: ctx } = await asUser.rpc('my_context');
    if (!ctx || ctx.role !== 'admin' || !ctx.tenantId) return json({ error: 'Only the owner can manage billing.' }, 403);

    const { period, coupon } = await req.json();
    const keyId = Deno.env.get('RAZORPAY_KEY_ID'), secret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keyId || !secret) return json({ error: 'Online payments are not set up yet. Please contact support.' }, 503);
    const auth = `Basic ${btoa(`${keyId}:${secret}`)}`;

    const { data: sub } = await asUser.rpc('get_subscription');
    if (sub?.autopay && sub?.status === 'active') return json({ error: 'Autopay is already on for your plan. Cancel it first if you want to change the plan.' }, 400);

    const { data: price, error: priceErr } = await asUser.rpc('checkout_price', { p_period: period, p_code: coupon ?? null });
    if (priceErr || !price) return json({ error: priceErr?.message ?? 'Could not work out the price.' }, 400);
    const amount: number = price.amountPaise;

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const chosen = await getPlan(admin, period);
    if (!chosen) return json({ error: 'That plan is not available. Please choose another one.' }, 400);

    // find (or create once) the Razorpay plan for this exact price
    const rp = await ensureRazorpayPlan(admin, auth, period, amount, chosen.months, chosen.name);
    if (!rp.id) return json({ error: rp.error }, 502);
    const planId = rp.id;

    // If a free trial is still running, the first charge waits until it ends (customer is not charged early).
    const body: Record<string, unknown> = { plan_id: planId, total_count: cyclesFor(chosen.months), customer_notify: 1, notes: { tenant_id: ctx.tenantId, period, coupon: price.code ?? '' } };
    if (sub?.status === 'trialing' && sub?.trialEndsAt) {
      const start = Math.floor(new Date(sub.trialEndsAt).getTime() / 1000);
      if (start > Math.floor(Date.now() / 1000) + 3600) body.start_at = start;
    }
    const res = await fetch('https://api.razorpay.com/v1/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body) });
    const created = await res.json();
    if (!res.ok || !created.id) return json({ error: created?.error?.description ?? 'Could not start the payment.' }, 502);

    await admin.from('subscriptions').update({ provider: 'razorpay', provider_subscription_id: created.id, period, updated_at: new Date().toISOString() }).eq('tenant_id', ctx.tenantId);
    if (price.code) await admin.rpc('apply_coupon_usage', { p_tenant: ctx.tenantId, p_code: price.code });
    return json({ url: created.short_url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 500);
  }
});
