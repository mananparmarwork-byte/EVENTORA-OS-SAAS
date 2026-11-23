import { useEffect, useState } from 'react';
import { qrDataUrl } from '@/lib/qr';
import { buildUpiUri, isValidUpiId } from '@/lib/settings';

/** A UPI QR code with the exact amount filled in. Any UPI app (GPay, PhonePe, Paytm…) can scan it. */
export function UpiQr({ upi, payee, amount, note, size = 220 }: { upi: string; payee: string; amount: number; note: string; size?: number }) {
  const [src, setSrc] = useState('');
  const ok = isValidUpiId(upi) && amount > 0;
  useEffect(() => {
    let live = true;
    if (!ok) { setSrc(''); return; }
    qrDataUrl(buildUpiUri({ upiId: upi, payeeName: payee || 'Eventora' }, amount, note), size * 2).then((u) => { if (live) setSrc(u); }).catch(() => { if (live) setSrc(''); });
    return () => { live = false; };
  }, [ok, upi, payee, amount, note, size]);
  if (!ok) return null;
  return src
    ? <img src={src} alt={`UPI QR code for ${amount} rupees`} width={size} height={size} className="rounded-2xl bg-white p-2" />
    : <div style={{ width: size, height: size }} className="animate-pulse rounded-2xl bg-surface-hover" aria-hidden />;
}
