export type PricingType = 'perPerson' | 'fixed' | 'perUnit';

export type CatalogItem = {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  subcategoryId: string;
  price: number;
  pricingType: PricingType;
  active: boolean;
  minQuantity: number;
  maxQuantity: number;
};
export type CatalogSubcategory = { id: string; name: string; items: CatalogItem[] };
export type CatalogCategory = { id: string; name: string; description: string; subcategories: CatalogSubcategory[] };

/** 24-hour "HH:MM" text. An empty range means "time not chosen yet". */
export type TimeRange = { start: string; end: string };
export type EventSlots = Record<string, TimeRange | undefined>;

export type QuoteService = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  pricingType: PricingType;
  quantity: number;
  unitPrice: number;
  total: number;
  description?: string;
};

export type QuoteCustomer = {
  name: string;
  mobile: string;
  eventType: string;
  eventDate: string;
  eventDates?: string[];
  eventSlots?: EventSlots;
  guests: number;
  gstNumber?: string;
  hall: string;
};

export type PaymentMethod = 'upi' | 'cash' | 'bank';
export type PaymentKind = 'advance' | 'full';
export type QuotePayment = { id: string; amount: number; method: PaymentMethod; kind: PaymentKind; paidAt: string; note?: string; by?: string };

export type QuotePricing = {
  foodPerPlate: number;
  subtotal: number;
  gstEnabled: boolean;
  gstRate: number;
  gstAmount: number;
  gstNumber: string;
  gstNumberVisible: boolean;
  customerGstNumberVisible?: boolean;
  showCostPerGuest?: boolean;
  eventDates?: string[];
  eventSlots?: EventSlots;
  discountEnabled?: boolean;
  discountPercent?: number;
  discountFlat?: number;
  discountAmount?: number;
  grandTotal: number;
  costPerGuest: number;
  advancePaid?: boolean;
  advanceAmount?: number;
  balanceDue?: number;
  payments?: QuotePayment[];
};

export type QuoteStatus = 'new' | 'contacted' | 'confirmed' | 'archived';
export type QuoteInput = { reference: string; customer: QuoteCustomer; services: QuoteService[]; pricing: QuotePricing };
export type Quote = QuoteInput & { id: string; createdAt: string; status: QuoteStatus };

export type BusinessProfile = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  website: string;
  terms: string;
  footerNote: string;
  signatory: string;
  gstSplit: boolean; // show CGST + SGST instead of a single GST line
  logo?: string; // optional PNG data URL printed on bills
};

export type PaymentSettings = {
  upiId: string;
  payeeName: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
};

/* ------------------------------------------------------------ Roles & audit --- */
export type Role = 'admin' | 'staff';
export type Session = { email: string; role: Role; tenantId?: string; tenantName?: string; slug?: string; platform?: boolean } | null;

/** What an employee may do. The owner changes these in Settings → Team. */
/** `deleteBills` is always false: employees can never delete a bill (the database enforces it, no switch exists). */
export type StaffPermissions = { deleteBills: boolean; editBills: boolean; removePayments: boolean; markBooked: boolean; discounts: boolean; viewAllBills: boolean };
export const DEFAULT_PERMISSIONS: StaffPermissions = { deleteBills: false, editBills: true, removePayments: true, markBooked: true, discounts: true, viewAllBills: true };

/** Bill numbers look like EV-201026-1001 (prefix, day DDMMYY, running number). The running number restarts at `start` every day. */
export type NumberingSettings = { prefix: string; start: number };
export const DEFAULT_NUMBERING: NumberingSettings = { prefix: 'EV', start: 1001 };

export type ActivitySettings = { retentionDays: number }; // 0 = keep forever
export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = { retentionDays: 0 };

export type ActivityAction =
  | 'bill.created' | 'bill.updated' | 'bill.deleted' | 'bill.booked' | 'bill.released'
  | 'payment.received' | 'payment.removed' | 'payment.request' | 'settings.changed';

export type ActivityChange = { label: string; from?: string; to?: string };
export type ActivityData = {
  changes?: ActivityChange[];
  amount?: number; method?: string; kind?: string; txn?: string; paymentId?: string; balance?: number;
  total?: number; customer?: string; mobile?: string; eventType?: string; dates?: string; guests?: number;
  services?: string[]; received?: number;
};
export type ActivityEntry = {
  id: string; at: string; actorEmail: string; actorRole: Role | 'public' | 'system';
  action: ActivityAction; reference: string; title: string; detail: string; data: ActivityData; legacy?: boolean;
};
export type ActivityDraft = Omit<ActivityEntry, 'id' | 'at' | 'actorEmail' | 'actorRole' | 'legacy'>;

export type StaffMember = { id: string; email: string; active: boolean };

/* ------------------------------------------------------------------ SaaS --- */
/** The plan code (e.g. 'monthly', 'quarterly', 'yearly' or anything the software owner creates, like 'diwali-offer'). */
export type BillingPeriod = string;
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
export type Subscription = { status: SubStatus; plan: string; period: BillingPeriod; trialEndsAt: string | null; currentPeriodEnd: string | null; writable: boolean; autopay?: boolean; couponCode?: string | null };
export type TenantRow = { id: string; name: string; slug: string; createdAt: string; ownerEmail: string | null; status: SubStatus | null; period: BillingPeriod | null; trialEndsAt: string | null; currentPeriodEnd: string | null; members: number; bills: number; autopay?: boolean; couponCode?: string | null; paid?: number };

export type Plan = { period: BillingPeriod; name: string; months: number; price: number; active: boolean; popular: boolean; description: string; features: string[]; sort: number };
export type CouponKind = 'percent' | 'amount' | 'free_days';
/** `value`: percent (1-100), rupees off, or days. */
export type Coupon = { code: string; kind: CouponKind; value: number; periods: BillingPeriod[] | null; maxUses: number | null; usedCount: number; validUntil: string | null; active: boolean; note: string };
export type CouponCheck = { ok: boolean; error?: string; kind?: CouponKind; code?: string; value?: number; days?: number; basePrice?: number; finalPrice?: number };

/* ---- buy first: pay on the website, the admin + business are created automatically at the first sign-in ---- */
export type PurchaseState = 'pending' | 'paid' | 'claimed' | 'failed';
export type PurchaseStatus = {
  found: boolean; status?: PurchaseState; email?: string; period?: BillingPeriod; amount?: number; periodEnd?: string | null;
  hasAccount?: boolean;            // a login with this email already exists
  hasWorkspace?: boolean;          // a business with this admin email already exists (a renewal: it is reconnected, nothing is lost)
  workspaceName?: string | null; businessName?: string | null;
};
export type NewPurchase = { purchaseId: string; url: string; amount: number };

/** One business as the software owner sees it in Super admin -> Subscriptions. */
export type SubState = 'trial' | 'trial_ended' | 'renewing' | 'manual_renew' | 'cancelling' | 'past_due' | 'lapsed' | 'free_access' | 'no_plan';
export type SubRow = {
  id: string; name: string; slug: string; createdAt: string; ownerEmail: string | null; status: SubStatus | null; state: SubState;
  period: BillingPeriod | null; planName: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; endsAt: string | null; daysLeft: number | null;
  autopay: boolean; manualAccess: boolean; note: string; couponCode: string | null; paymentsCount: number; renewals: number; paid: number;
  lastPaymentAt: string | null; firstPaymentAt: string | null; members: number; bills: number;
};
export type PlatformDashboard = {
  counts: Partial<Record<SubState, number>>; total: number; mrr: number;
  revenue: { thisMonth: number; lastMonth: number; last30: number; allTime: number };
  renewal: { renewed90: number; lapsed90: number; rate: number | null };
  series: { month: string; revenue: number; signups: number; newPaying: number }[];
  planMix: { name: string; count: number }[];
  expiring: { id: string; name: string; ownerEmail: string | null; state: SubState; planName: string | null; endsAt: string; daysLeft: number; autopay: boolean }[];
  lapsed: { id: string; name: string; ownerEmail: string | null; state: SubState; planName: string | null; endsAt: string | null; daysLeft: number | null }[];
  recentPayments: { tenant: string; amount: number; planName: string | null; paidAt: string; renewal: boolean; offline: boolean }[];
};
export type TenantPayment = { id: string; amount: number; planName: string | null; paidAt: string; offline: boolean };
