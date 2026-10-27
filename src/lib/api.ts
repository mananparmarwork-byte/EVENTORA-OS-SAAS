import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBackend } from './backend';
import { cleanBusiness, cleanPayment } from './settings';
import { cloneCatalog } from './catalog';
import { FALLBACK_PLANS } from './plans';
import { billDeleted, billUpdated, statusChanged } from './activity';
import { DEFAULT_ACTIVITY_SETTINGS, DEFAULT_NUMBERING, DEFAULT_PERMISSIONS, type ActivityDraft, type ActivityEntry, type ActivitySettings, type BusinessProfile, type CatalogCategory, type NumberingSettings, type PaymentSettings, type Quote, type QuoteInput, type QuotePricing, type QuoteStatus, type Session, type StaffMember, type StaffPermissions, type BillingPeriod, type SubStatus, type Subscription, type TenantRow, type Plan, type Coupon, type PurchaseStatus, type PlatformDashboard, type SubRow, type TenantPayment } from './types';

const BUSINESS_FALLBACK = cleanBusiness(null);
const PAYMENT_FALLBACK = cleanPayment(null);

export const keys = {
  catalog: ['catalog'] as const,
  quotes: ['quotes'] as const,
  quote: (ref: string) => ['quote', ref] as const,
  booked: ['booked'] as const,
  settings: (k: string) => ['settings', k] as const,
  session: ['session'] as const,
  activity: ['activity'] as const,
  staff: ['staff'] as const,
  nextBill: ['next-bill'] as const,
  subscription: ['subscription'] as const,
  tenants: ['tenants'] as const,
};

const be = () => getBackend();

export function useCatalog() {
  return useQuery<CatalogCategory[]>({ queryKey: keys.catalog, queryFn: () => be().getCatalog(), staleTime: 30_000 });
}
export function useSaveCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: CatalogCategory[]) => be().saveCatalog(c),
    onSuccess: (_d, c) => qc.setQueryData(keys.catalog, c),
  });
}
export const defaultCatalog = () => cloneCatalog();

export function useQuotes() {
  return useQuery<Quote[]>({ queryKey: keys.quotes, queryFn: () => be().listQuotes(), refetchOnWindowFocus: true });
}
export function useQuote(reference: string, enabled = true) {
  return useQuery<Quote | null>({ queryKey: keys.quote(reference), queryFn: () => be().getQuote(reference), enabled: enabled && Boolean(reference) });
}

function useInvalidateQuotes() {
  const qc = useQueryClient();
  return (reference?: string) => {
    void qc.invalidateQueries({ queryKey: keys.quotes });
    void qc.invalidateQueries({ queryKey: keys.booked });
    void qc.invalidateQueries({ queryKey: keys.nextBill });
    if (reference) void qc.invalidateQueries({ queryKey: keys.quote(reference) });
  };
}

/** Writes one line to the activity log. A failure to log never blocks the real action, but it is reported in the console. */
function useLogger() {
  const qc = useQueryClient();
  return async (draft: ActivityDraft | null) => {
    if (!draft) return;
    try { await be().logActivity(draft); void qc.invalidateQueries({ queryKey: keys.activity }); }
    catch (e) { console.warn('Activity log could not be saved:', e); }
  };
}

export function useCreateQuote() {
  const done = useInvalidateQuotes();
  const qc = useQueryClient();
  // The database function also writes the "bill created" line, so nothing is logged here.
  return useMutation({
    mutationFn: (v: { input: QuoteInput; overrideRef?: string }) => be().createQuote(v.input, v.overrideRef),
    onSuccess: (q) => { done(q.reference); void qc.invalidateQueries({ queryKey: keys.activity }); },
  });
}
export function useUpdateQuote() {
  const done = useInvalidateQuotes();
  const log = useLogger();
  return useMutation({
    mutationFn: async (v: { reference: string; input: QuoteInput; before: Quote }) => { await be().updateQuote(v.reference, v.input); await log(billUpdated(v.before, { ...v.before, ...v.input })); },
    onSuccess: (_d, v) => done(v.reference),
  });
}
export function useUpdatePricing() {
  const done = useInvalidateQuotes();
  const log = useLogger();
  return useMutation({
    mutationFn: async (v: { reference: string; pricing: QuotePricing; log?: ActivityDraft }) => { await be().updatePricing(v.reference, v.pricing); await log(v.log ?? null); },
    onSuccess: (_d, v) => done(v.reference),
  });
}
export function useSetStatus() {
  const done = useInvalidateQuotes();
  const log = useLogger();
  return useMutation({
    mutationFn: async (v: { quote: Quote; status: QuoteStatus }) => { await be().setStatus(v.quote.reference, v.status); await log(statusChanged(v.quote, v.status === 'confirmed')); },
    onSuccess: (_d, v) => done(v.quote.reference),
  });
}
export function useDeleteQuote() {
  const done = useInvalidateQuotes();
  const log = useLogger();
  return useMutation({
    mutationFn: async (quote: Quote) => { await be().deleteQuote(quote.reference); await log(billDeleted(quote)); },
    onSuccess: (_d, q) => done(q.reference),
  });
}
/** For one-off lines such as "payment request sent". */
export function useLogActivity() { return useLogger(); }

export function useActivity(enabled: boolean) {
  return useQuery<ActivityEntry[]>({ queryKey: keys.activity, queryFn: () => be().listActivity(), enabled, refetchOnWindowFocus: true, retry: false });
}
export function usePurgeActivity() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (beforeISO: string) => be().purgeActivity(beforeISO), onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.activity }); } });
}

/** The bill number the next bill will get. Employees see it read-only. */
export function useNextBillNumber(enabled: boolean) {
  return useQuery<string | null>({ queryKey: keys.nextBill, queryFn: () => be().peekBillNumber(), enabled, staleTime: 0, refetchOnWindowFocus: true });
}
export function useSetNextBillNumber() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (n: number) => be().setNextBillNumber(n), onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.nextBill }); } });
}

export function useStaff(enabled: boolean) {
  return useQuery<StaffMember[]>({ queryKey: keys.staff, queryFn: () => be().listStaff(), enabled, retry: false });
}
export function useStaffActions() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: keys.staff }); };
  return {
    setActive: useMutation({ mutationFn: (v: { id: string; active: boolean }) => be().setStaffActive(v.id, v.active), onSuccess: refresh }),
    create: useMutation({ mutationFn: (v: { email: string; password: string }) => be().createStaff(v.email, v.password), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => { const f = be().deleteStaff; if (!f) throw new Error('Deleting employees is not available on this database.'); return f.call(be(), id); }, onSuccess: refresh }),
    resetPassword: useMutation({ mutationFn: (v: { id: string; password: string }) => { const f = be().resetStaffPassword; if (!f) throw new Error('Password reset is not available on this database.'); return f.call(be(), v.id, v.password); } }),
  };
}
export const canCreateStaff = () => be().canCreateStaff;
export const canManageStaff = () => Boolean(be().deleteStaff && be().resetStaffPassword);

/** Account security: password, two-step verification, sign out everywhere. Undefined where the database does not offer them. */
export const accountApi = () => {
  const b = be();
  return { changePassword: b.changePassword?.bind(b), signOutEverywhere: b.signOutEverywhere?.bind(b), mfa: b.mfa };
};
export const verifyMfa = (factorId: string, code: string) => { const b = be(); if (!b.verifyMfa) throw new Error('Two-step verification is not available.'); return b.verifyMfa(factorId, code); };

export function useBookedTimes() {
  return useQuery({ queryKey: keys.booked, queryFn: () => be().bookedTimes(), staleTime: 20_000, refetchOnWindowFocus: true, retry: false });
}

export function useBusiness() {
  const q = useQuery<BusinessProfile>({ queryKey: keys.settings('business'), queryFn: async () => cleanBusiness((await be().getSettings('business')) as Partial<BusinessProfile> | null), staleTime: 60_000 });
  return { ...q, business: q.data ?? BUSINESS_FALLBACK };
}
export function usePayment() {
  const q = useQuery<PaymentSettings>({ queryKey: keys.settings('payment'), queryFn: async () => cleanPayment((await be().getSettings('payment')) as Partial<PaymentSettings> | null), staleTime: 60_000 });
  return { ...q, payment: q.data ?? PAYMENT_FALLBACK };
}
export function useSaveSettings(key: 'business' | 'payment') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: BusinessProfile | PaymentSettings) => be().saveSettings(key, data),
    onSuccess: (_d, data) => qc.setQueryData(keys.settings(key), data),
  });
}

const PERM_FALLBACK = DEFAULT_PERMISSIONS;
export function usePermissions() {
  const q = useQuery<StaffPermissions>({ queryKey: keys.settings('permissions'), queryFn: async () => ({ ...DEFAULT_PERMISSIONS, ...(((await be().getSettings('permissions')) as Partial<StaffPermissions> | null) ?? {}) }), staleTime: 60_000 });
  return { ...q, permissions: q.data ?? PERM_FALLBACK };
}
const NUM_FALLBACK = DEFAULT_NUMBERING;
export function useNumbering() {
  const q = useQuery<NumberingSettings>({ queryKey: keys.settings('numbering'), queryFn: async () => ({ ...DEFAULT_NUMBERING, ...(((await be().getSettings('numbering')) as Partial<NumberingSettings> | null) ?? {}) }), staleTime: 60_000 });
  return { ...q, numbering: q.data ?? NUM_FALLBACK };
}
const ACT_FALLBACK = DEFAULT_ACTIVITY_SETTINGS;
export function useActivitySettings(enabled = true) {
  const q = useQuery<ActivitySettings>({ queryKey: keys.settings('activity'), enabled, queryFn: async () => ({ ...DEFAULT_ACTIVITY_SETTINGS, ...(((await be().getSettings('activity')) as Partial<ActivitySettings> | null) ?? {}) }), staleTime: 60_000 });
  return { ...q, activitySettings: q.data ?? ACT_FALLBACK };
}
/** Owner-only settings blocks (permissions, numbering, activity retention). */
export function useSaveGeneric<K extends 'permissions' | 'numbering' | 'activity'>(key: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => be().saveSettings(key, data),
    onSuccess: (_d, data) => qc.setQueryData(keys.settings(key), data),
  });
}

export function useSession() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.session, queryFn: () => be().getSession(), staleTime: Infinity });
  useEffect(() => be().onAuthChange(() => { void qc.invalidateQueries({ queryKey: keys.session }); }), [qc]);
  const session: Session = q.data ?? null;
  return { session, loading: q.isLoading, isAdmin: session?.role === 'admin', isStaff: session?.role === 'staff' };
}
export const signIn = (email: string, password: string) => be().signIn(email, password);
export const signOut = () => be().signOut();
export const backendMode = () => be().mode;

/* ------------------------------------------------------------------ SaaS --- */
export const signUp = (email: string, password: string) => be().signUp(email, password);
export const createTenant = (name: string, slug: string) => be().createTenant(name, slug);
export const createPurchase = (input: { email: string; period: BillingPeriod; coupon?: string; businessName?: string }) => be().createPurchase(input);
export const purchaseStatus = (q: { id?: string; email?: string }) => be().purchaseStatus(q);
export const savePurchaseProfile = (id: string, businessName: string) => be().savePurchaseProfile(id, businessName);
/** Polls while the payment is still on its way. */
export function usePurchaseStatus(q: { id?: string; email?: string }, enabled = true) {
  return useQuery<PurchaseStatus>({
    queryKey: ['purchase', q.id ?? '', q.email ?? ''],
    queryFn: () => be().purchaseStatus(q),
    enabled,
    retry: false,
    refetchInterval: (query) => (query.state.data?.found && query.state.data.status === 'pending' ? 4000 : false),
  });
}
export const startCheckout = (period: BillingPeriod, coupon?: string) => be().startCheckout(period, coupon);
export const cancelAutopay = () => be().cancelAutopay();
export const checkCoupon = (code: string, period: BillingPeriod | null) => be().checkCoupon(code, period);
export const redeemCoupon = (code: string) => be().redeemCoupon(code);

/** The business's plan. `writable` is false once the trial / subscription has ended: the app becomes read-only. */
export function useSubscription(enabled = true) {
  const q = useQuery<Subscription | null>({ queryKey: keys.subscription, queryFn: () => be().getSubscription(), enabled, staleTime: 30_000, refetchOnWindowFocus: true });
  const sub = q.data ?? null;
  return { ...q, sub, writable: sub ? sub.writable : true };
}

export function useTenants(enabled: boolean) {
  return useQuery<TenantRow[]>({ queryKey: keys.tenants, queryFn: () => be().listTenants(), enabled, retry: false });
}
export function usePlatformDashboard() {
  return useQuery<PlatformDashboard>({ queryKey: ['platform-dashboard'], queryFn: () => be().platformDashboard(), retry: false, staleTime: 30_000 });
}
export function useSubscriptionOverview() {
  return useQuery<SubRow[]>({ queryKey: ['platform-subs'], queryFn: () => be().platformSubscriptions(), retry: false, staleTime: 30_000 });
}
export function useTenantPayments(tenantId: string | null) {
  return useQuery<TenantPayment[]>({ queryKey: ['platform-payments', tenantId], queryFn: () => be().platformTenantPayments(tenantId!), enabled: !!tenantId, retry: false });
}
/** Refresh every Super admin screen after a change. */
function refreshPlatform(qc: ReturnType<typeof useQueryClient>) {
  for (const k of [keys.tenants, ['platform-dashboard'], ['platform-subs'], ['platform-payments']]) void qc.invalidateQueries({ queryKey: k });
}
export function useSetTenantSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { tenantId: string; status: SubStatus | null; extendDays: number }) => be().platformSetSubscription(v.tenantId, v.status, v.extendDays),
    onSuccess: () => refreshPlatform(qc),
  });
}

/** The prices shown on the website and Billing page (managed in the "All businesses" panel). Falls back to the defaults in plans.ts. */
export function usePlans() {
  const q = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: async () => (await be().getPlans()) ?? FALLBACK_PLANS,
    staleTime: 60_000,
  });
  const all = [...(q.data ?? FALLBACK_PLANS)].sort((x, y) => x.sort - y.sort || x.months - y.months || x.price - y.price);
  return { ...q, all, plans: all.filter((p) => p.active) };
}

export function useSubscriptionAdmin() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: keys.subscription }); };
  return { cancelAutopay: useMutation({ mutationFn: () => be().cancelAutopay(), onSuccess: refresh }), redeem: useMutation({ mutationFn: (code: string) => be().redeemCoupon(code), onSuccess: refresh }) };
}

/* ---- software-owner panel ---- */
export function useTrialDays(enabled: boolean) { return useQuery<number>({ queryKey: ['trial-days'], queryFn: () => be().platformGetTrialDays(), enabled, retry: false }); }
export function usePlatformActions() {
  const qc = useQueryClient();
  return {
    saveTrial: useMutation({ mutationFn: (d: number) => be().platformSaveTrialDays(d), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['trial-days'] }); } }),
    savePlan: useMutation({ mutationFn: (v: { period: BillingPeriod; price: number; active: boolean }) => be().platformSavePlan(v.period, v.price, v.active), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plans'] }); } }),
    grantAccess: useMutation({ mutationFn: (v: { tenantId: string; period: BillingPeriod | null; until: string; note: string; amountRupees: number }) => be().platformGrantAccess(v), onSuccess: () => refreshPlatform(qc) }),
    setNote: useMutation({ mutationFn: (v: { tenantId: string; note: string }) => be().platformSetNote(v.tenantId, v.note), onSuccess: () => refreshPlatform(qc) }),
    upsertPlan: useMutation({ mutationFn: (p: Plan) => be().platformUpsertPlan(p), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plans'] }); } }),
    deletePlan: useMutation({ mutationFn: (period: BillingPeriod) => be().platformDeletePlan(period), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plans'] }); } }),
    saveCoupon: useMutation({ mutationFn: (c: Coupon) => be().platformSaveCoupon(c), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['coupons'] }); } }),
  };
}
export function useCoupons(enabled: boolean) { return useQuery<Coupon[]>({ queryKey: ['coupons'], queryFn: () => be().platformListCoupons(), enabled, retry: false }); }
