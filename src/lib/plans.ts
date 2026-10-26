import type { BillingPeriod, Plan } from './types';

/**
 * (These are only the FALLBACK prices shown if the database cannot be reached. The real prices and the free-trial length are set
 *  in the app: All businesses -> Plans and Settings. Razorpay plans are created automatically, you do not need to make them.)
 */
export const PLAN_NAME = 'Eventora Pro';
export const PRICES: Record<BillingPeriod, { label: string; months: number; price: number }> = {
  monthly: { label: 'Monthly', months: 1, price: 1499 },
  quarterly: { label: 'Quarterly', months: 3, price: 3999 },
  yearly: { label: 'Yearly', months: 12, price: 14999 },
};
export const PERIODS: BillingPeriod[] = ['monthly', 'quarterly', 'yearly'];

/** Shown only if the database cannot be reached. The real plans are created in Super admin -> Plans & prices. */
export const FALLBACK_PLANS: Plan[] = PERIODS.map((period, i) => ({
  period, name: PRICES[period].label, months: PRICES[period].months, price: PRICES[period].price, active: true,
  popular: period === 'quarterly', description: '', features: [], sort: i + 1,
}));

/** "per month", "per 3 months", "per year" ... */
export const perLabel = (months: number) => (months === 1 ? 'per month' : months === 12 ? 'per year' : months % 12 === 0 ? `per ${months / 12} years` : `per ${months} months`);
/** The name to show for a plan code (falls back to the code itself for plans that were deleted). */
export const planName = (plans: Plan[], key?: string | null) => (key ? plans.find((p) => p.period === key)?.name ?? PRICES[key]?.label ?? key : '');
/** Lower-case letters, numbers and dashes: used to turn a plan name into its code. */
export const slugPlan = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);


export const FEATURES = [
  'Quotations, tax invoices and PDF bills with your logo',
  'Calendar with free-time check and double-booking protection',
  'UPI QR and payment tracking (cash, UPI, bank)',
  'Owner dashboard with any date range, daily / weekly / monthly',
  'Full activity log: edits, deletions, payments, who did what',
  'Employee logins with permissions you control',
  'Daily bill numbers that never repeat',
  'Two-step verification, auto sign-out and bills only your team can see',
];
