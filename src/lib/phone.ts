/** Mobile-number helpers: every client must have a number the software owner can call. */
export const phoneDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
/** At least 10 digits (an Indian mobile, with or without +91 / 0). */
export const validPhone = (v: string | null | undefined) => phoneDigits(v).length >= 10;
export const PHONE_ERROR = 'Enter a valid mobile number (at least 10 digits).';
export const telHref = (v: string) => `tel:${(v ?? '').replace(/[^\d+]/g, '')}`;
