import { MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/format';
import { telHref, validPhone } from '@/lib/phone';
import { whatsappLink } from '@/lib/settings';

/** The client's mobile number as a tap-to-call link. A missing number is shown as a warning, never hidden. */
export function PhoneLink({ phone, className }: { phone: string | null | undefined; className?: string }) {
  if (!validPhone(phone)) return <span className="text-xs font-medium text-warning">No mobile number</span>;
  return <a href={telHref(phone as string)} className={cn('tabular text-sm text-text hover:text-gold hover:underline', className)}>{phone}</a>;
}

/** Call + WhatsApp (message pre-filled) for one client. Renders nothing when there is no usable number. */
export function ContactButtons({ phone, message = '', size = 'sm', whatsappLabel = 'WhatsApp', onWhatsapp }: {
  phone: string | null | undefined; message?: string; size?: 'sm' | 'md'; whatsappLabel?: string; onWhatsapp?: () => void;
}) {
  if (!validPhone(phone)) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a href={telHref(phone as string)}><Button type="button" size={size} variant="outline"><Phone size={13} /> Call</Button></a>
      <a href={whatsappLink(phone as string, message)} target="_blank" rel="noreferrer" onClick={onWhatsapp}><Button type="button" size={size} variant="outline"><MessageCircle size={13} /> {whatsappLabel}</Button></a>
    </span>
  );
}
