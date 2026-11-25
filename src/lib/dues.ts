import { formatEventDates, inr } from './format';
import { quoteDates, quotePaymentState } from './pricing';
import { isValidUpiId, whatsappLink } from './settings';
import type { BusinessProfile, PaymentSettings, Quote } from './types';

/** Is this bill paid, part paid or unpaid, and how much is still due? */
export function dueInfo(q: Quote) {
  const p = quotePaymentState(q.pricing);
  return { ...p, isPaid: p.balance <= 0 && q.pricing.grandTotal > 0, isUnpaid: p.balance > 0 };
}

/** A payment REQUEST when nothing was paid yet, a REMINDER when part of the money is already received. */
export function dueMessage(q: Quote, business: BusinessProfile, pay: PaymentSettings) {
  const { received, balance } = dueInfo(q);
  const isReminder = received > 0;
  const dates = formatEventDates(quoteDates(q.customer));
  const upi = isValidUpiId(pay.upiId);
  const lines = [
    `Hello ${q.customer.name},`,
    isReminder
      ? `This is a friendly reminder from ${business.name} about the balance for your ${q.customer.eventType.toLowerCase()}${dates ? ` on ${dates}` : ''} (Bill ${q.reference}).`
      : `Thank you for choosing ${business.name} for your ${q.customer.eventType.toLowerCase()}${dates ? ` on ${dates}` : ''} (Bill ${q.reference}). Please complete your payment to confirm.`,
    '',
    `• Bill total: ${inr(q.pricing.grandTotal)}`,
    ...(received > 0 ? [`• Received so far: ${inr(received)}`] : []),
    `• Amount due: ${inr(balance)}`,
    ...(upi ? [`• Pay by UPI: ${pay.upiId}${pay.payeeName ? ` (${pay.payeeName})` : ''}`] : []),
    '',
    'After paying, please send us the payment screenshot or transaction ID.',
    '',
    `Team ${business.name}${business.phone ? ` · ${business.phone}` : ''}`,
  ];
  return { kind: isReminder ? 'reminder' as const : 'request' as const, subject: `${isReminder ? 'Payment reminder' : 'Payment request'} · ${business.name} · Bill ${q.reference}`, text: lines.join('\n') };
}

export const whatsappDueLink = (q: Quote, business: BusinessProfile, pay: PaymentSettings) => whatsappLink(q.customer.mobile, dueMessage(q, business, pay).text);
export function emailDueLink(q: Quote, business: BusinessProfile, pay: PaymentSettings) {
  const m = dueMessage(q, business, pay);
  return `mailto:${encodeURIComponent(q.customer.email ?? '')}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`;
}
