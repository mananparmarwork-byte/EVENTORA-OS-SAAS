// Shared helpers for the Edge Functions (imported with a relative path; the Supabase CLI bundles it when you deploy).
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Razorpay billing periods (used by create-purchase). A Razorpay plan is created once per exact price and remembered.
export const INTERVAL: Record<string, { period: 'monthly' | 'yearly'; interval: number }> = {
  monthly: { period: 'monthly', interval: 1 }, quarterly: { period: 'monthly', interval: 3 }, yearly: { period: 'yearly', interval: 1 },
};
export const CYCLES: Record<string, number> = { monthly: 120, quarterly: 40, yearly: 10 };

// deno-lint-ignore no-explicit-any
export async function ensureRazorpayPlan(admin: any, auth: string, period: string, amount: number): Promise<{ id?: string; error?: string }> {
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
