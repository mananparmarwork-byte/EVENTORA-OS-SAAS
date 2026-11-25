import type { BillingPeriod, Plan } from './types';

/**
 * (These are only the FALLBACK prices shown if the database cannot be reached. The real prices and the free-trial length are set
 *  in the app: All businesses -> Plans and Settings.)
 */
export const PLAN_NAME = 'Eventora Pro';
export const PRICES: Record<BillingPeriod, { label: string; months: number; price: number }> = {
  monthly: { label: 'Monthly', months: 1, price: 1799 },
  'half-year': { label: 'Half year plan', months: 6, price: 10194 },   // 1,699 a month for the main branch
  yearly: { label: 'Yearly', months: 12, price: 17999 },               // about 1,500 a month for the main branch
};
export const PERIODS: BillingPeriod[] = ['monthly', 'half-year', 'yearly'];

/** Price of ONE extra branch, per month, by plan length. Longer plans get a lower rate. */
export const BRANCH_MONTHLY_RATE: { months: number; rate: number }[] = [{ months: 1, rate: 1349 }, { months: 6, rate: 1249 }, { months: 12, rate: 1149 }];
export const branchMonthlyRate = (months: number) => [...BRANCH_MONTHLY_RATE].reverse().find((t) => months >= t.months)?.rate ?? BRANCH_MONTHLY_RATE[0].rate;
/** What each extra branch costs for the whole plan period (e.g. yearly: 1,149 x 12 = 13,788). */
export const branchPlanPrice = (months: number) => branchMonthlyRate(months) * months;

/** Shown only if the database cannot be reached. The real plans are created in Super admin -> Plans & prices. */
export const FALLBACK_PLANS: Plan[] = PERIODS.map((period, i) => ({
  period, name: PRICES[period].label, months: PRICES[period].months, price: PRICES[period].price, active: true,
  popular: period === 'half-year', description: '', features: [], sort: i + 1,
}));

/** "per month", "per 3 months", "per year" ... */
export const perLabel = (months: number) => (months === 1 ? 'per month' : months === 12 ? 'per year' : months % 12 === 0 ? `per ${months / 12} years` : `per ${months} months`);
/** The name to show for a plan code (falls back to the code itself for plans that were deleted). */
export const planName = (plans: Plan[], key?: string | null) => (key ? plans.find((p) => p.period === key)?.name ?? PRICES[key]?.label ?? key : '');
/** Lower-case letters, numbers and dashes: used to turn a plan name into its code. */
export const slugPlan = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);


export const FEATURES = [
  'Unlimited quotations, tax invoices and PDF bills with your logo',
  'Calendar with free-time check and double-booking protection',
  'Manage several branches: separate bills, staff and calendar per branch',
  'Branch-wise reports and a combined view of all branches',
  'Payment tracking: advance, balance, cash, UPI and bank',
  'Owner dashboard: revenue and bookings by day, week, month or any dates',
  'Employee logins with permissions you control',
  'Full activity log: edits, deletions, payments, who did what',
  'Your own catalog and custom items in every quotation',
  'WhatsApp sharing of quotations and payment requests',
  'Two-step verification, auto sign-out and secure data',
  'Reminders and messages from the Eventora team',
];

/** Free with every plan, for as long as you use the software. */
export const BONUSES = [
  { title: 'Free business website worth ₹25,000', text: 'We build your website and keep it live for as long as you use Eventora OS. Domain charges are extra.' },
  { title: 'Up to 20% off digital branding & marketing', text: 'Logo, social media, ads and more from our digital branding and marketing team.' },
];
