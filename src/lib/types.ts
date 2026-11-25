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
  /** optional PAN of the customer (10 characters, e.g. ABCDE1234F), printed on the bill like the GSTIN */
  panNumber?: string;
  /** optional e-mail of the customer, used for payment requests and reminders */
  email?: string;
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
  /** the customer's PAN lives here (no extra database column needed) */
  customerPan?: string;
  customerPanVisible?: boolean;
  /** 'enquiry-link' when the customer filled the public form themselves */
  source?: string;
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

/** 'draft' = a customer filled the public enquiry link; no services or price yet. Saving it from the bill form turns it into 'new'. */
export type QuoteStatus = 'draft' | 'new' | 'contacted' | 'confirmed' | 'archived';
export type QuoteInput = { reference: string; customer: QuoteCustomer; services: QuoteService[]; pricing: QuotePricing; /** which branch the bill belongs to (owner picks; employees are always put in their own branch by the database) */ branchId?: string };
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
export type Session = { email: string; role: Role; tenantId?: string; tenantName?: string; slug?: string; platform?: boolean; /** true while the super admin is looking at a client's dashboard (read-only) */ viewing?: boolean } | null;

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
  action: ActivityAction; reference: string; title: string; detail: string; data: ActivityData; legacy?: boolean; branchId?: string;
};
export type ActivityDraft = Omit<ActivityEntry, 'id' | 'at' | 'actorEmail' | 'actorRole' | 'legacy'>;

export type StaffMember = { id: string; email: string; active: boolean; branchId?: string | null };

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

/* ------------------------------------------------------------ Collections (Super admin) --- */
export type CollectBucket = 'overdue' | 'due_soon' | 'upcoming' | 'autopay' | 'later' | 'none';
/** One business in Super admin -> Collections. Money is in rupees. */
export type CollectionRow = {
  id: string; name: string; ownerEmail: string | null; phone: string; state: SubState; bucket: CollectBucket;
  period: string | null; planName: string | null; endsAt: string | null; daysLeft: number | null; autopay: boolean;
  amountDue: number; planMonths: number; lastPaymentAt: string | null; lastAmount: number | null; paymentsCount: number; renewals: number; paid: number;
  note: string; reminders: number; lastReminderAt: string | null; lastFollowupAt: string | null; promiseDate: string | null;
};
export type CollectedPayment = {
  id: string; tenantId: string; tenant: string; ownerEmail: string | null; amount: number; planName: string | null; paidAt: string;
  offline: boolean; method: string; note: string; renewal: boolean;
};
export type FollowUpAction = 'email' | 'whatsapp' | 'copy' | 'call' | 'note' | 'collected';
export type FollowUp = { id: string; action: FollowUpAction; note: string; promiseDate: string | null; at: string };
export type ReminderResult = { sent: number; failed: number; skipped: string[]; errors: string[] };


/* ------------------------------------------------------------ Branches --- */
export type Branch = { id: string; name: string; address: string; phone: string; isMain: boolean; active: boolean; createdAt: string; staff: number };
/** `limit` = how many active branches the plan allows (raised when you approve a request). `myBranchId` is set for employees. */
export type BranchInfo = { branches: Branch[]; limit: number; activeCount: number; myBranchId: string | null };

/* ------------------------------------------------- Saved custom quotation items --- */
export type Preset = { id: string; name: string; price: number; pricingType: PricingType; note?: string };

/* ------------------------------------------------- Messages, requests, automation --- */
export type NoticeKind = 'info' | 'reminder' | 'warning' | 'payment' | 'plan' | 'branch' | 'reply' | 'success';
export type AppNotification = { id: string; kind: NoticeKind; title: string; body: string; actionUrl: string | null; createdAt: string; readAt: string | null; source: 'manual' | 'auto' };
export type NotificationFeed = { unread: number; items: AppNotification[] };

export type RequestKind = 'branch' | 'renewal' | 'support';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'closed';
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type RequestPayload = Record<string, any>;
export type OwnerRequest = { id: string; kind: RequestKind; status: RequestStatus; subject: string; message: string; payload: RequestPayload; createdAt: string; decidedAt: string | null; note: string };
export type PlatformRequest = OwnerRequest & { tenantId: string; business: string; ownerEmail: string | null; phone: string; amount: number; branchLimit: number; branchesUsed: number; periodEnd: string | null; subStatus: string | null };
export type Lead = { id: string; createdAt: string; name: string; business: string; phone: string; email: string; message: string; status: 'new' | 'contacted' | 'done' };
export type InboxCounts = { requests: number; leads: number };

/** Who receives a message. segment: expiring_7 | expiring_30 | expired | due | trial | paid | multi_branch */
export type Audience = { mode: 'all' } | { mode: 'selected'; ids: string[] } | { mode: 'segment'; segment: string };
export type Recipient = { id: string; business: string; ownerEmail: string | null; phone: string; title: string; body: string; endDate?: string; plan?: string };
export type SendResult = { campaignId: string; count: number; recipients: Recipient[]; email: boolean };
export type Campaign = { id: string; createdAt: string; title: string; body: string; kind: NoticeKind; channels: string[]; audienceLabel: string; count: number; read: number };
export type MessageTemplate = { id: string; name: string; title: string; body: string; kind: NoticeKind; builtin: boolean };
export type MessageRule = { key: string; label: string; description: string; trigger: 'before_end' | 'after_end' | 'event'; appliesTo: 'any' | 'trial' | 'paid'; days: number; enabled: boolean; title: string; body: string; kind: NoticeKind; channels: string[]; sent: number; custom?: boolean };
export type CustomRuleInput = { key?: string; label: string; trigger: 'before_end' | 'after_end'; appliesTo: 'any' | 'trial' | 'paid'; days: number; enabled: boolean; title: string; body: string; kind: string; channels: string[] };
/** One branch as the software owner sees it (with how many bills and employees would move if it is deleted). */
export type PlatformBranch = { id: string; name: string; address: string; phone: string; isMain: boolean; active: boolean; createdAt: string; bills: number; staff: number };

export type PlatformConfig = { whatsapp: string; phone: string; email: string; upi: string; payee: string; bankText: string; instructions: string; branchPrice: number; allowSelfSignup: boolean };
export type PaymentInfo = Partial<PlatformConfig>;
export type PublicContact = { whatsapp: string; phone: string; email: string };
export type TenantMeta = { id: string; businessType: string; phone: string; branchLimit: number; branches: number; owners: number; unread: number };
export type NewOwner = { email: string; password: string; businessName: string; businessType: string; phone: string; period: string; until: string; amountRupees: number; note: string; tenantId?: string };
export type NewOwnerResult = { email: string; name: string; slug: string; existing: boolean; linkedExistingLogin: boolean; tenantId: string };


/* ---------------------------------------------- Billing quote and invoices --- */
export type QuoteLine = { label: string; amount: number };
/** What the owner has to pay for: renew plan and/or add branches. Calculated by the database. */
export type BillingQuote = {
  renew: boolean; period: string; planName: string; planMonths: number; planPrice: number; branchPrice: number;
  extras: number; keep: number; newCount: number; monthsLeft: number; branchMonths: number; lines: QuoteLine[]; total: number; newEnd: string | null;
};
export type InvoiceParty = { name?: string; address?: string; gstin?: string; pan?: string; phone?: string; email?: string; terms?: string; footer?: string };
export type Invoice = {
  id: string; number: string; issuedAt: string; tenantId: string; business: string; billTo: InvoiceParty; seller: InvoiceParty;
  items: { description: string; amount: number }[]; gstEnabled: boolean; gstRate: number; subtotal: number; gst: number; total: number; paid: number;
  paymentRef: string; paidOn: string | null; periodFrom: string | null; periodTo: string | null; planName: string; notes: string;
};
export type InvoicePatch = Partial<Pick<Invoice, 'items' | 'gstEnabled' | 'gstRate' | 'paymentRef' | 'notes' | 'planName'>> & { number?: string; billTo?: InvoiceParty; seller?: InvoiceParty; paid?: number; paidOn?: string; issuedAt?: string };
export type InvoiceSettings = InvoiceParty & { prefix: string; next: number; gstEnabled: boolean; gstRate: number };

/* ------------------------------------------------------- Public enquiry link --- */
/** What the public form (a customer opening the business's link) needs to know. Branches are only the active ones. */
export type EnquiryInfo = { found: boolean; name: string; phone: string; open: boolean; branches: { id: string; name: string }[] };
/** What a customer sends. Bill number, GST and PAN are deliberately not part of it. */
export type EnquiryInput = { name: string; mobile: string; email: string; eventType: string; guests: number; dates: string[]; slots: EventSlots; branchId?: string; /** honeypot: must stay empty */ website?: string };
