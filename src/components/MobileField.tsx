import { useEffect, useState } from 'react';
import { Field, Input } from '@/components/ui';
import { useMyContactPhone } from '@/lib/apiExt';

/** The owner's own mobile number for a request form: pre-filled from what is saved, required, saved again when they send. */
export function useMobile() {
  const { data: saved } = useMyContactPhone(true);
  const [mobile, setMobile] = useState('');
  useEffect(() => { if (saved && !mobile) setMobile(saved); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  return [mobile, setMobile] as const;
}

export function MobileField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Your mobile number" required hint="so we can call you if needed">
      <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} placeholder="98765 43210" />
    </Field>
  );
}
