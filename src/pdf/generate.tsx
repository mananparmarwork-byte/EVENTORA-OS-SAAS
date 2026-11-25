import { createElement } from 'react';
import type { BusinessProfile, Invoice, PaymentSettings, Quote } from '@/lib/types';
import type { BillKind } from './BillDocument';

// The PDF engine is large, so it is only downloaded the first time someone actually creates a PDF.
async function render(element: React.ReactElement): Promise<Blob> {
  const { pdf } = await import('@react-pdf/renderer');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pdf(element as any).toBlob();
}

export async function buildBillBlob(quote: Quote, business: BusinessProfile, payment: PaymentSettings, kind: BillKind): Promise<Blob> {
  const { BillDocument } = await import('./BillDocument');
  return render(createElement(BillDocument, { quote, business, payment, kind }));
}

export async function buildReportBlob(title: string, quotes: Quote[], business: BusinessProfile): Promise<Blob> {
  const { ReportDocument } = await import('./ReportDocument');
  return render(createElement(ReportDocument, { title, quotes, business }));
}

export async function buildInvoiceBlob(invoice: Invoice): Promise<Blob> {
  const { InvoiceDocument } = await import('./InvoiceDocument');
  return render(createElement(InvoiceDocument, { invoice }));
}

export const invoiceFileName = (i: Invoice) => `invoice-${i.number.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) saveBlob(blob, 'document.pdf');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const billFileName = (quote: Quote, kind: BillKind) =>
  `${kind === 'invoice' ? 'Invoice' : 'Quotation'}-${quote.reference}-${quote.customer.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.pdf`;
