import { AlertTriangle, BadgeCheck, Bell, Building2, CreditCard, Info, MessageCircle, Clock } from 'lucide-react';
import type { NoticeKind } from '@/lib/types';

export const KIND_STYLE: Record<NoticeKind, { icon: typeof Info; box: string; label: string }> = {
  info: { icon: Info, box: 'bg-info/15 text-info', label: 'Info' },
  reminder: { icon: Clock, box: 'bg-warning-bg text-warning', label: 'Reminder' },
  warning: { icon: AlertTriangle, box: 'bg-error-bg text-error', label: 'Important' },
  payment: { icon: CreditCard, box: 'bg-gold/15 text-gold', label: 'Payment' },
  plan: { icon: Bell, box: 'bg-gold/15 text-gold', label: 'Plan' },
  branch: { icon: Building2, box: 'bg-info/15 text-info', label: 'Branch' },
  reply: { icon: MessageCircle, box: 'bg-success-bg text-success', label: 'Reply' },
  success: { icon: BadgeCheck, box: 'bg-success-bg text-success', label: 'Good news' },
};
export const KINDS = Object.keys(KIND_STYLE) as NoticeKind[];
