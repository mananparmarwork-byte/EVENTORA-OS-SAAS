// Owner turns autopay off. Access continues until the end of the period already paid for.
// Deploy:  supabase functions deploy manage-subscription
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: ctx } = await asUser.rpc('my_context');
    if (!ctx || ctx.role !== 'admin' || !ctx.tenantId) return json({ error: 'Only the owner can manage billing.' }, 403);
    const { action } = await req.json();
    if (action !== 'cancel') return json({ error: 'Unknown action.' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: row } = await admin.from('subscriptions').select('provider_subscription_id,status').eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!row?.provider_subscription_id) return json({ error: 'There is no autopay to cancel.' }, 400);

    const keyId = Deno.env.get('RAZORPAY_KEY_ID')!, secret = Deno.env.get('RAZORPAY_KEY_SECRET')!;
    // paid and running: stop after the current period. Trial / not yet charged: cancel straight away.
    const atCycleEnd = row.status === 'active' ? 1 : 0;
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${row.provider_subscription_id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${keyId}:${secret}`)}` },
      body: JSON.stringify({ cancel_at_cycle_end: atCycleEnd }),
    });
    const out = await res.json();
    if (!res.ok) return json({ error: out?.error?.description ?? 'Could not cancel autopay.' }, 502);
    await admin.from('subscriptions').update({ autopay: false, updated_at: new Date().toISOString() }).eq('tenant_id', ctx.tenantId);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 500);
  }
});
