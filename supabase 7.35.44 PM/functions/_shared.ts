// Shared helpers for the Edge Functions (imported with a relative path; the Supabase CLI bundles it when you deploy).
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Razorpay billing interval for a plan that lasts `months` months (1, 3, 12, or anything the software owner creates).
// Whole years use Razorpay's yearly period; everything else is counted in months.
export const intervalFor = (months: number): { period: 'monthly' | 'yearly'; interval: number } =>
  months % 12 === 0 ? { period: 'yearly', interval: months / 12 } : { period: 'monthly', interval: months };
// About 10 years of billing cycles (120 for monthly, 40 for quarterly, 10 for yearly: same as before).
export const cyclesFor = (months: number): number => Math.max(1, Math.ceil(120 / months));

// deno-lint-ignore no-explicit-any
export async function getPlan(admin: any, period: string): Promise<{ name: string; months: number } | null> {
  const r = await admin.from('plans').select('name, months, active').eq('period', String(period)).maybeSingle();
  if (r.error || !r.data || !r.data.active) return null;
  return { name: String(r.data.name ?? period), months: Number(r.data.months ?? 1) };
}

// deno-lint-ignore no-explicit-any
export async function ensureRazorpayPlan(admin: any, auth: string, period: string, amount: number, months: number, name: string): Promise<{ id?: string; error?: string }> {
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
