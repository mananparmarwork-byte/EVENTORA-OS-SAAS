import type { BillingPeriod } from './types';

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

export const perMonth = (p: BillingPeriod) => Math.round(PRICES[p].price / PRICES[p].months);
/** Percentage saved against paying month by month. */
export const savePercent = (p: BillingPeriod) => Math.max(0, Math.round((1 - PRICES[p].price / (PRICES.monthly.price * PRICES[p].months)) * 100));

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
