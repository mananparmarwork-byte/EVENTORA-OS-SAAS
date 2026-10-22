// Razorpay tells us when autopay is set up, a payment succeeds, fails, or the subscription is cancelled.
// Deploy:  supabase functions deploy razorpay-webhook --no-verify-jwt
// Razorpay Dashboard -> Settings -> Webhooks: URL = https://<project-ref>.supabase.co/functions/v1/razorpay-webhook
//   events: subscription.authenticated, subscription.activated, subscription.charged, subscription.pending,
//           subscription.halted, subscription.cancelled, subscription.completed
// Secret:  RAZORPAY_WEBHOOK_SECRET (the secret you typed in the webhook form)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
async function sign(body: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  if (!secret || !safeEqual(await sign(raw, secret), req.headers.get('x-razorpay-signature') ?? '')) return new Response('bad signature', { status: 401 });

  const event = JSON.parse(raw);
  const sub = event?.payload?.subscription?.entity;
  const tenantId: string | undefined = sub?.notes?.tenant_id;
  if (!sub || !tenantId) return new Response('ignored', { status: 200 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const end = sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null;
  const period = ['monthly', 'quarterly', 'yearly'].includes(sub?.notes?.period) ? sub.notes.period : undefined;
  const base = { provider: 'razorpay', provider_subscription_id: sub.id, updated_at: new Date().toISOString(), ...(period ? { period } : {}) };

  switch (event.event) {
    case 'subscription.authenticated':        // customer approved autopay; the first charge happens on the start date
      await admin.from('subscriptions').update({ ...base, autopay: true }).eq('tenant_id', tenantId);
      break;
    case 'subscription.activated':
    case 'subscription.charged': {
      await admin.from('subscriptions').update({ ...base, status: 'active', autopay: true, current_period_end: end }).eq('tenant_id', tenantId);
      const pay = event?.payload?.payment?.entity;
      if (pay?.id && event.event === 'subscription.charged') {
        await admin.from('subscription_payments').upsert({ id: pay.id, tenant_id: tenantId, amount_paise: pay.amount, period: period ?? null, paid_at: new Date((pay.created_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString() });
      }
      break;
    }
    case 'subscription.pending':
    case 'subscription.halted':               // a debit failed (and after retries, stopped)
      await admin.from('subscriptions').update({ ...base, status: 'past_due' }).eq('tenant_id', tenantId);
      break;
    case 'subscription.cancelled':
      await admin.from('subscriptions').update({ ...base, status: 'cancelled', autopay: false, ...(end ? { current_period_end: end } : {}) }).eq('tenant_id', tenantId);
      break;
    case 'subscription.completed':
      await admin.from('subscriptions').update({ ...base, status: 'expired', autopay: false }).eq('tenant_id', tenantId);
      break;
  }
  return new Response('ok', { status: 200 });
});
