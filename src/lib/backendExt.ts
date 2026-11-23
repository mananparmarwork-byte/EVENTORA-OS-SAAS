import type { SupabaseClient } from '@supabase/supabase-js';
import type { BillingQuote, Invoice, InvoicePatch, InvoiceSettings, RequestPayload, Audience, AppNotification, BranchInfo, Campaign, InboxCounts, Lead, MessageRule, MessageTemplate, NewOwner, NewOwnerResult, NotificationFeed, OwnerRequest, PaymentInfo, PlatformConfig, PlatformPayment, NewPayment, PlatformRequest, Preset, PublicContact, RequestKind, SendResult, TenantMeta } from './types';

/**
 * Everything added for: manual access (add owners), messages & automation, requests, multi-branch and saved custom items.
 * Needs supabase/16-manual-access-messages-branches.sql (and the Edge Functions platform-owners / send-message-emails).
 */
export interface SaasExt {
  /* branches */
  listBranches(): Promise<BranchInfo>;
  saveBranch(v: { id?: string; name: string; address: string; phone: string; active: boolean }): Promise<string>;
  setStaffBranch(userId: string, branchId: string): Promise<void>;
  /* saved custom quotation items */
  getPresets(): Promise<Preset[]>;
  savePresets(list: Preset[]): Promise<void>;
  /* owner: inbox, requests, how to pay */
  myNotifications(): Promise<NotificationFeed>;
  markNotificationsRead(ids?: string[]): Promise<void>;
  createRequest(v: { kind: RequestKind; subject?: string; message?: string; payload?: RequestPayload }): Promise<string>;
  /** The amount to pay (plan renewal and/or extra branches), worked out by the database. */
  billingQuote(v: { renew: boolean; period: string; keep: number; newCount: number }): Promise<BillingQuote>;
  myInvoices(): Promise<Invoice[]>;
  platformListInvoices(): Promise<Invoice[]>;
  platformUpdateInvoice(id: string, patch: InvoicePatch): Promise<void>;
  platformGetInvoiceSettings(): Promise<InvoiceSettings>;
  platformSaveInvoiceSettings(s: InvoiceSettings): Promise<void>;
  myRequests(): Promise<OwnerRequest[]>;
  getPaymentInfo(): Promise<PaymentInfo>;
  /* public page */
  publicContact(): Promise<PublicContact>;
  submitLead(v: { name: string; business: string; phone: string; email: string; message: string }): Promise<void>;
  /* software owner */
  platformGetConfig(): Promise<PlatformConfig>;
  platformSaveConfig(c: PlatformConfig): Promise<void>;
  platformListRequests(status?: string): Promise<PlatformRequest[]>;
  platformDecideRequest(v: { id: string; status: 'approved' | 'rejected' | 'closed'; note: string; amountRupees?: number; until?: string | null; period?: string | null }): Promise<void>;
  platformSetBranchLimit(tenantId: string, limit: number): Promise<void>;
  platformTenantMeta(): Promise<TenantMeta[]>;
  platformUpdateTenant(v: { tenantId: string; name: string; businessType: string; phone: string }): Promise<void>;
  platformInboxCounts(): Promise<InboxCounts>;
  platformListLeads(): Promise<Lead[]>;
  platformSetLead(id: string, status: 'new' | 'contacted' | 'done' | 'delete'): Promise<void>;
  platformPreviewMessage(v: { title: string; body: string; audience: Audience }): Promise<SendResult['recipients']>;
  platformSendMessage(v: { title: string; body: string; kind: string; channels: string[]; audience: Audience; url?: string; label: string }): Promise<SendResult>;
  platformListCampaigns(): Promise<Campaign[]>;
  platformListTemplates(): Promise<MessageTemplate[]>;
  platformSaveTemplate(v: { id?: string; name: string; title: string; body: string; kind: string }): Promise<void>;
  platformDeleteTemplate(id: string): Promise<void>;
  platformListRules(): Promise<MessageRule[]>;
  platformSaveRule(r: { key: string; enabled: boolean; days: number; title: string; body: string; kind: string; channels: string[] }): Promise<void>;
  platformRunAuto(): Promise<number>;
  platformAddOwner(v: NewOwner): Promise<NewOwnerResult>;
  platformResetOwnerPassword(tenantId: string, password: string): Promise<void>;
  platformSendEmails(): Promise<{ sent: number; failed: number; skipped: number }>;
  /* file 18: payments list, mark as paid, clean-up of answered requests, owner's saved mobile */
  myContactPhone(): Promise<string>;
  platformListPayments(): Promise<PlatformPayment[]>;
  platformRecordPayment(v: NewPayment): Promise<string>;
  platformDeleteRequest(id: string): Promise<void>;
  platformClearAnswered(): Promise<number>;
  platformPurge(): Promise<void>;
}

const MISSING_SQL = 'Run supabase/16-manual-access-messages-branches.sql and then supabase/18-clients-payments-cleanup.sql and supabase/19-billing-qr-invoices.sql in the Supabase SQL Editor, then refresh.';
const FN_MISSING = (name: string) => `The "${name}" function is not deployed yet. Run: supabase functions deploy ${name}${name === 'send-message-emails' ? ' --no-verify-jwt' : ''}`;

async function fnBody(error: unknown): Promise<string> {
  let msg = error instanceof Error ? error.message : 'Something went wrong.';
  const res = (error as { context?: Response }).context;
  try {
    const j = await res?.clone().json();
    if (j?.error) msg = String(j.error);
    else if (j?.message) msg = `${j.message} (status ${res?.status})`;
  } catch { /* keep message */ }
  return msg;
}

export function makeSaasExt(client: SupabaseClient): SaasExt {
  /** Calls a database function; turns "function does not exist" into a clear instruction. */
  async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      if (/schema cache|could not find the function|does not exist/i.test(error.message) && error.message.includes(fn)) throw new Error(MISSING_SQL);
      throw new Error(error.message.replace(/^BRANCH_LIMIT:\s*/, ''));
    }
    return data as T;
  }
  async function fn<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      if (error.name === 'FunctionsFetchError' || ctx?.status === 404) throw new Error(FN_MISSING(name));
      throw new Error(await fnBody(error));
    }
    const d = data as { error?: string } | null;
    if (d && typeof d === 'object' && d.error) throw new Error(String(d.error));
    return data as T;
  }

  return {
    async listBranches() {
      const d = await rpc<BranchInfo | null>('list_branches');
      return d && Array.isArray(d.branches) ? d : { branches: [], limit: 1, activeCount: 0, myBranchId: null };
    },
    async saveBranch(v) { return String(await rpc<string>('save_branch', { p_id: v.id ?? null, p_name: v.name, p_address: v.address, p_phone: v.phone, p_active: v.active })); },
    async setStaffBranch(userId, branchId) { await rpc('set_staff_branch', { p_user: userId, p_branch: branchId }); },

    async getPresets() {
      const { data, error } = await client.rpc('get_presets');
      if (error || !Array.isArray(data)) return [];
      return (data as Partial<Preset>[]).map((p, i) => ({ id: String(p.id ?? `preset-${i}`), name: String(p.name ?? ''), price: Number(p.price) || 0, pricingType: p.pricingType === 'perPerson' || p.pricingType === 'perUnit' ? p.pricingType : 'fixed', note: p.note ?? '' }));
    },
    async savePresets(list) { await rpc('save_presets', { p: list }); },

    async myNotifications() {
      const { data, error } = await client.rpc('my_notifications');
      if (error || !data) return { unread: 0, items: [] };
      const d = data as { unread: number; items: AppNotification[] };
      return { unread: Number(d.unread) || 0, items: Array.isArray(d.items) ? d.items : [] };
    },
    async markNotificationsRead(ids) { await rpc('mark_notifications_read', { p_ids: ids && ids.length ? ids : null }); },
    async createRequest(v) { return String(await rpc<string>('create_request', { p_kind: v.kind, p_subject: v.subject ?? '', p_message: v.message ?? '', p_payload: v.payload ?? {} })); },
    async billingQuote(v) { return rpc<BillingQuote>('billing_quote', { p_renew: v.renew, p_period: v.period, p_keep: v.keep, p_new: v.newCount }); },
    async myInvoices() { const { data, error } = await client.rpc('my_invoices'); return error || !Array.isArray(data) ? [] : (data as Invoice[]); },
    async platformListInvoices() { return (await rpc<Invoice[] | null>('platform_list_invoices')) ?? []; },
    async platformUpdateInvoice(id, patch) { await rpc('platform_update_invoice', { p_id: id, p: patch }); },
    async platformGetInvoiceSettings() {
      const d = await rpc<Partial<InvoiceSettings>>('platform_get_invoice_settings');
      return { name: d.name ?? '', address: d.address ?? '', gstin: d.gstin ?? '', pan: d.pan ?? '', phone: d.phone ?? '', email: d.email ?? '', terms: d.terms ?? '', footer: d.footer ?? '', prefix: d.prefix ?? 'INV', next: Number(d.next) || 1, gstEnabled: Boolean(d.gstEnabled), gstRate: Number(d.gstRate) || 18 };
    },
    async platformSaveInvoiceSettings(s) { await rpc('platform_save_invoice_settings', { p: s }); },
    async myRequests() {
      const { data, error } = await client.rpc('my_requests');
      return error || !Array.isArray(data) ? [] : (data as OwnerRequest[]);
    },
    async getPaymentInfo() {
      const { data, error } = await client.rpc('get_payment_info');
      return error || !data ? {} : (data as PaymentInfo);
    },

    async publicContact() {
      const { data, error } = await client.rpc('public_contact');
      const d = (error || !data ? {} : data) as Partial<PublicContact>;
      return { whatsapp: d.whatsapp ?? '', phone: d.phone ?? '', email: d.email ?? '' };
    },
    async submitLead(v) { await rpc('submit_access_lead', { p_name: v.name, p_business: v.business, p_phone: v.phone, p_email: v.email, p_message: v.message }); },

    async platformGetConfig() {
      const d = await rpc<Partial<PlatformConfig>>('platform_get_config');
      return { whatsapp: d.whatsapp ?? '', phone: d.phone ?? '', email: d.email ?? '', upi: d.upi ?? '', payee: d.payee ?? '', bankText: d.bankText ?? '', instructions: d.instructions ?? '', branchPrice: Number(d.branchPrice) || 0, allowSelfSignup: Boolean(d.allowSelfSignup), requestKeepDays: d.requestKeepDays == null ? 7 : Number(d.requestKeepDays) };
    },
    async platformSaveConfig(c) { await rpc('platform_save_config', { p: c }); },
    async platformListRequests(status) { return (await rpc<PlatformRequest[] | null>('platform_list_requests', { p_status: status ?? null })) ?? []; },
    async platformDecideRequest(v) {
      await rpc('platform_decide_request', { p_id: v.id, p_status: v.status, p_note: v.note, p_amount_paise: Math.round((v.amountRupees ?? 0) * 100), p_until: v.until ?? null, p_period: v.period || null });
    },
    async platformSetBranchLimit(tenantId, limit) { await rpc('platform_set_branch_limit', { p_tenant: tenantId, p_limit: limit }); },
    async platformTenantMeta() { return (await rpc<TenantMeta[] | null>('platform_tenant_meta')) ?? []; },
    async platformUpdateTenant(v) { await rpc('platform_update_tenant', { p_tenant: v.tenantId, p_name: v.name, p_type: v.businessType, p_phone: v.phone }); },
    async platformInboxCounts() { const d = await rpc<InboxCounts | null>('platform_inbox_counts'); return { requests: Number(d?.requests) || 0, leads: Number(d?.leads) || 0 }; },
    async platformListLeads() { return (await rpc<Lead[] | null>('platform_list_leads')) ?? []; },
    async platformSetLead(id, status) { await rpc('platform_set_lead', { p_id: id, p_status: status }); },
    async platformPreviewMessage(v) { return (await rpc<SendResult['recipients'] | null>('platform_preview_message', { p_title: v.title, p_body: v.body, p_audience: v.audience })) ?? []; },
    async platformSendMessage(v) {
      return rpc<SendResult>('platform_send_message', { p_title: v.title, p_body: v.body, p_kind: v.kind, p_channels: v.channels, p_audience: v.audience, p_url: v.url ?? null, p_label: v.label });
    },
    async platformListCampaigns() { return (await rpc<Campaign[] | null>('platform_list_campaigns')) ?? []; },
    async platformListTemplates() { return (await rpc<MessageTemplate[] | null>('platform_list_templates')) ?? []; },
    async platformSaveTemplate(v) { await rpc('platform_save_template', { p_id: v.id ?? null, p_name: v.name, p_title: v.title, p_body: v.body, p_kind: v.kind }); },
    async platformDeleteTemplate(id) { await rpc('platform_delete_template', { p_id: id }); },
    async platformListRules() { return (await rpc<MessageRule[] | null>('platform_list_rules')) ?? []; },
    async platformSaveRule(r) { await rpc('platform_save_rule', { p_key: r.key, p_enabled: r.enabled, p_days: r.days, p_title: r.title, p_body: r.body, p_kind: r.kind, p_channels: r.channels }); },
    async platformRunAuto() { return Number(await rpc<number>('platform_run_auto_messages')) || 0; },
    async platformAddOwner(v) {
      return fn<NewOwnerResult>('platform-owners', { action: 'create', ...v });
    },
    async platformResetOwnerPassword(tenantId, password) { await fn('platform-owners', { action: 'resetPassword', tenantId, password }); },
    async platformSendEmails() { return fn<{ sent: number; failed: number; skipped: number }>('send-message-emails', {}); },

    async myContactPhone() { const { data, error } = await client.rpc('my_contact_phone'); return error || typeof data !== 'string' ? '' : data; },
    async platformListPayments() { return (await rpc<PlatformPayment[] | null>('platform_list_payments')) ?? []; },
    async platformRecordPayment(v) {
      return String(await rpc<string>('platform_record_payment', { p_tenant: v.tenantId, p_amount_paise: Math.round(v.amountRupees * 100), p_paid_on: v.paidOn, p_method: v.method, p_reference: v.reference, p_period: v.period || null, p_until: v.until, p_note: v.note }));
    },
    async platformDeleteRequest(id) { await rpc('platform_delete_request', { p_id: id }); },
    async platformClearAnswered() { return Number(await rpc<number>('platform_clear_answered')) || 0; },
    async platformPurge() { await client.rpc('platform_purge_requests'); },
  };
}

/** The Hostinger (PHP) version is a single business: none of the above exists there. */
const EXT_KEYS = ['listBranches', 'saveBranch', 'setStaffBranch', 'getPresets', 'savePresets', 'myNotifications', 'markNotificationsRead', 'createRequest', 'billingQuote', 'myInvoices', 'platformListInvoices', 'platformUpdateInvoice', 'platformGetInvoiceSettings', 'platformSaveInvoiceSettings', 'myRequests', 'getPaymentInfo', 'publicContact', 'submitLead', 'platformGetConfig', 'platformSaveConfig', 'platformListRequests', 'platformDecideRequest', 'platformSetBranchLimit', 'platformTenantMeta', 'platformUpdateTenant', 'platformInboxCounts', 'platformListLeads', 'platformSetLead', 'platformPreviewMessage', 'platformSendMessage', 'platformListCampaigns', 'platformListTemplates', 'platformSaveTemplate', 'platformDeleteTemplate', 'platformListRules', 'platformSaveRule', 'platformRunAuto', 'platformAddOwner', 'platformResetOwnerPassword', 'platformSendEmails', 'myContactPhone', 'platformListPayments', 'platformRecordPayment', 'platformDeleteRequest', 'platformClearAnswered', 'platformPurge'];
const unsupportedCall = (name: string) => async () => {
  if (name === 'listBranches') return { branches: [], limit: 1, activeCount: 0, myBranchId: null };
  if (name === 'getPresets' || name === 'myRequests' || name === 'platformListPayments' || name === 'myInvoices') return [];
  if (name === 'myContactPhone') return '';
  if (name === 'myNotifications') return { unread: 0, items: [] };
  if (name === 'getPaymentInfo') return {};
  if (name === 'publicContact') return { whatsapp: '', phone: '', email: '' };
  throw new Error('This needs the Supabase version of Eventora.');
};
export const unsupportedExt = Object.fromEntries(EXT_KEYS.map((k) => [k, unsupportedCall(k)])) as unknown as SaasExt;
