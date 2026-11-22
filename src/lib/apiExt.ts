import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBackend } from './backend';
import type { Audience, Campaign, InboxCounts, Lead, MessageRule, MessageTemplate, NewOwner, NotificationFeed, OwnerRequest, PaymentInfo, PlatformConfig, PlatformRequest, Preset, PublicContact, RequestKind, TenantMeta } from './types';

const be = () => getBackend();

/* ------------------------------------------------------------ branches --- */
export function useBranchActions() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['branches'] }); void qc.invalidateQueries({ queryKey: ['staff'] }); void qc.invalidateQueries({ queryKey: ['my-requests'] }); };
  return {
    save: useMutation({ mutationFn: (v: { id?: string; name: string; address: string; phone: string; active: boolean }) => be().saveBranch(v), onSuccess: refresh }),
    moveStaff: useMutation({ mutationFn: (v: { userId: string; branchId: string }) => be().setStaffBranch(v.userId, v.branchId), onSuccess: refresh }),
  };
}

/* -------------------------------------------------- saved custom items --- */
export function usePresets(enabled = true) {
  return useQuery<Preset[]>({ queryKey: ['presets'], queryFn: () => be().getPresets(), enabled, staleTime: 30_000 });
}
export function useSavePresets() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (list: Preset[]) => be().savePresets(list), onSuccess: (_d, list) => qc.setQueryData(['presets'], list) });
}

/* ---------------------------------------------- owner: inbox + requests --- */
export function useNotifications(enabled = true) {
  const q = useQuery<NotificationFeed>({ queryKey: ['notifications'], queryFn: () => be().myNotifications(), enabled, refetchInterval: 90_000, refetchOnWindowFocus: true, retry: false });
  return { ...q, feed: q.data ?? { unread: 0, items: [] } };
}
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (ids?: string[]) => be().markNotificationsRead(ids), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); } });
}
export function useMyRequests(enabled = true) {
  return useQuery<OwnerRequest[]>({ queryKey: ['my-requests'], queryFn: () => be().myRequests(), enabled, retry: false, refetchOnWindowFocus: true });
}
export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: RequestKind; subject?: string; message?: string; payload?: Record<string, string> }) => be().createRequest(v),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-requests'] }); void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });
}
export function usePaymentInfo(enabled = true) {
  const q = useQuery<PaymentInfo>({ queryKey: ['payment-info'], queryFn: () => be().getPaymentInfo(), enabled, staleTime: 60_000 });
  return { ...q, info: q.data ?? {} };
}
export function usePublicContact() {
  const q = useQuery<PublicContact>({ queryKey: ['public-contact'], queryFn: () => be().publicContact(), staleTime: 300_000, retry: false });
  return { ...q, contact: q.data ?? { whatsapp: '', phone: '', email: '' } };
}
export const submitLead = (v: { name: string; business: string; phone: string; email: string; message: string }) => be().submitLead(v);

/* ----------------------------------------------------- software owner --- */
function refreshPlatformExt(qc: ReturnType<typeof useQueryClient>) {
  for (const k of [['platform-requests'], ['platform-leads'], ['inbox-counts'], ['tenant-meta'], ['platform-campaigns'], ['platform-templates'], ['platform-rules'], ['platform-config'],
    ['platform-subs'], ['platform-dashboard'], ['tenants'], ['platform-payments']]) void qc.invalidateQueries({ queryKey: k });
}
export function usePlatformConfig(enabled = true) { return useQuery<PlatformConfig>({ queryKey: ['platform-config'], queryFn: () => be().platformGetConfig(), enabled, retry: false }); }
export function useInboxCounts(enabled = true) { return useQuery<InboxCounts>({ queryKey: ['inbox-counts'], queryFn: () => be().platformInboxCounts(), enabled, retry: false, refetchInterval: 60_000 }); }
export function usePlatformRequests(status?: string) { return useQuery<PlatformRequest[]>({ queryKey: ['platform-requests', status ?? ''], queryFn: () => be().platformListRequests(status), retry: false }); }
export function usePlatformLeads() { return useQuery<Lead[]>({ queryKey: ['platform-leads'], queryFn: () => be().platformListLeads(), retry: false }); }
export function useTenantMeta() { return useQuery<TenantMeta[]>({ queryKey: ['tenant-meta'], queryFn: () => be().platformTenantMeta(), retry: false, staleTime: 30_000 }); }
export function usePlatformCampaigns() { return useQuery<Campaign[]>({ queryKey: ['platform-campaigns'], queryFn: () => be().platformListCampaigns(), retry: false }); }
export function usePlatformTemplates() { return useQuery<MessageTemplate[]>({ queryKey: ['platform-templates'], queryFn: () => be().platformListTemplates(), retry: false }); }
export function usePlatformRules() { return useQuery<MessageRule[]>({ queryKey: ['platform-rules'], queryFn: () => be().platformListRules(), retry: false }); }
export function usePreviewMessage(v: { title: string; body: string; audience: Audience }, enabled: boolean) {
  return useQuery({ queryKey: ['preview-message', v.title, v.body, JSON.stringify(v.audience)], queryFn: () => be().platformPreviewMessage(v), enabled, retry: false, staleTime: 10_000 });
}

export function usePlatformExt() {
  const qc = useQueryClient();
  const done = () => refreshPlatformExt(qc);
  return {
    saveConfig: useMutation({ mutationFn: (c: PlatformConfig) => be().platformSaveConfig(c), onSuccess: done }),
    decide: useMutation({ mutationFn: (v: Parameters<ReturnType<typeof getBackend>['platformDecideRequest']>[0]) => be().platformDecideRequest(v), onSuccess: done }),
    setBranchLimit: useMutation({ mutationFn: (v: { tenantId: string; limit: number }) => be().platformSetBranchLimit(v.tenantId, v.limit), onSuccess: done }),
    updateTenant: useMutation({ mutationFn: (v: { tenantId: string; name: string; businessType: string; phone: string }) => be().platformUpdateTenant(v), onSuccess: done }),
    setLead: useMutation({ mutationFn: (v: { id: string; status: 'new' | 'contacted' | 'done' | 'delete' }) => be().platformSetLead(v.id, v.status), onSuccess: done }),
    send: useMutation({ mutationFn: (v: Parameters<ReturnType<typeof getBackend>['platformSendMessage']>[0]) => be().platformSendMessage(v), onSuccess: done }),
    saveTemplate: useMutation({ mutationFn: (v: { id?: string; name: string; title: string; body: string; kind: string }) => be().platformSaveTemplate(v), onSuccess: done }),
    deleteTemplate: useMutation({ mutationFn: (id: string) => be().platformDeleteTemplate(id), onSuccess: done }),
    saveRule: useMutation({ mutationFn: (r: Parameters<ReturnType<typeof getBackend>['platformSaveRule']>[0]) => be().platformSaveRule(r), onSuccess: done }),
    runAuto: useMutation({ mutationFn: () => be().platformRunAuto(), onSuccess: done }),
    addOwner: useMutation({ mutationFn: (v: NewOwner) => be().platformAddOwner(v), onSuccess: done }),
    resetPassword: useMutation({ mutationFn: (v: { tenantId: string; password: string }) => be().platformResetOwnerPassword(v.tenantId, v.password) }),
    sendEmails: useMutation({ mutationFn: () => be().platformSendEmails() }),
  };
}
