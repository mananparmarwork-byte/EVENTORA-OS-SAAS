import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/format';

/* ---------------------------------------------------------------- Buttons --- */
type Variant = 'gold' | 'outline' | 'ghost' | 'danger' | 'soft';
const VARIANTS: Record<Variant, string> = {
  gold: 'bg-gold text-text-on-gold hover:bg-gold-hover font-semibold shadow-[0_6px_18px_rgba(52,120,246,.28)]',
  outline: 'border border-border bg-surface text-text hover:bg-surface-hover hover:border-steel-blue',
  soft: 'bg-surface-hover text-text hover:bg-border',
  ghost: 'bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text',
  danger: 'border border-error/30 bg-error-bg text-error hover:bg-error/15',
};
export function Button({ variant = 'outline', size = 'md', loading = false, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-sm' };
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50', sizes[size], VARIANTS[variant], className)}
    >
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Fields --- */
const control = 'rounded-xl border border-border bg-input px-3.5 text-sm text-text transition-colors hover:border-steel-blue/70 focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/10 disabled:opacity-50';
/** Default width / height only when the caller did not choose their own (two competing Tailwind classes would be decided by stylesheet order, not by us). */
const sized = (className: string | undefined, h = 'h-11') => cn(/(^|\s)w-/.test(className ?? '') ? '' : 'w-full', /(^|\s)h-/.test(className ?? '') ? '' : h);
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(control, sized(className), className)} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cn(control, sized(className), 'appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>{children}</select>;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(control, 'w-full min-h-24 py-3', className)} />;
}
export function Field({ label, required, hint, error, children, className, as = 'label' }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode; className?: string; as?: 'label' | 'div' }) {
  const Wrapper = as;
  return (
    <Wrapper className={cn('block', className)}>
      <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-text-secondary">
        <span>{label}{required && <span className="ml-0.5 text-gold">*</span>}</span>
        {hint && !error && <span className="font-normal text-text-disabled">{hint}</span>}
      </span>
      {children}
      {error && <span role="alert" className="mt-1.5 block text-xs text-error">{error}</span>}
    </Wrapper>
  );
}
export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-4', disabled && 'pointer-events-none opacity-50')}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-text">{label}</span>}
          {description && <span className="block text-xs text-text-secondary">{description}</span>}
        </span>
      )}
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full border transition-colors', checked ? 'border-gold bg-gold' : 'border-border bg-[#CBD5E3]')}>
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

/* ------------------------------------------------------------------- Cards --- */
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn('rounded-2xl border border-border bg-surface card-glow', className)}>{children}</div>;
}
export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'gold';
const TONES: Record<Tone, string> = {
  success: 'bg-success-bg text-success border-success/30',
  warning: 'bg-warning-bg text-warning border-warning/30',
  error: 'bg-error-bg text-error border-error/30',
  info: 'bg-info/10 text-info border-info/30',
  neutral: 'bg-surface-hover text-text-secondary border-border',
  gold: 'bg-gold/10 text-gold border-gold/30',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', TONES[tone], className)}>{children}</span>;
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-surface-hover text-gold">{icon}</div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-text-secondary">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton', className)} />;
}

/** Compact shimmer rows. (The name stays "Spinner" so every existing screen gets the new look.) */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 px-1 py-8">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-4/5" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** Full-page placeholder: header, four KPI cards, a chart and a list. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      <div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-80 max-w-full" /></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      <Skeleton className="h-72 rounded-2xl" />
      <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}</div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Shows a value such as "₹12,50,000" or "42" and counts its first number up over about 700 ms. Off for reduced motion. */
export function CountText({ value }: { value: string }) {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(value);
  const target = m ? Number(m[0].replace(/,/g, '')) : NaN;
  const reduce = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [n, setN] = useState<number>(reduce || !Number.isFinite(target) ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target) || reduce) { setN(target); from.current = target; return; }
    const begin = from.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setN(begin + (target - begin) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce]);
  if (!m || !Number.isFinite(target)) return <>{value}</>;
  const token = m[0];
  const decimals = token.includes('.') ? token.split('.')[1].length : 0;
  const text = new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: token.includes(',') }).format(n);
  return <>{value.slice(0, m.index)}{text}{value.slice(m.index + token.length)}</>;
}

/* ------------------------------------------------------------------- Modal --- */
export function Modal({ title, eyebrow, onClose, children, width = 'max-w-xl', footer }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  // rendered into <body> so no animated or blurred parent can trap this full-screen layer
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-obsidian/50 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn('pop-in flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-3xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-6 py-5">
          <div>
            {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</p>}
            <h2 className="mt-0.5 font-display text-xl font-semibold text-text">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-xl text-text-secondary hover:bg-surface-hover hover:text-text"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------- Toasts + confirm --- */
type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; text: string };
type Ui = { toast: (text: string, kind?: ToastKind) => void; confirm: (o: { title: string; text?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean> };
const UiContext = createContext<Ui | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<{ title: string; text?: string; confirmLabel?: string; danger?: boolean } | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const counter = useRef(0);

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3200);
  }, []);
  const confirm = useCallback((o: { title: string; text?: string; confirmLabel?: string; danger?: boolean }) => new Promise<boolean>((resolve) => { resolver.current = resolve; setDialog(o); }), []);
  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setDialog(null); };

  const icon = { success: <CheckCircle2 size={18} className="text-success" />, error: <XCircle size={18} className="text-error" />, info: <Info size={18} className="text-info" /> };
  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn('toast-in pointer-events-auto flex items-start gap-3 rounded-xl border border-l-4 border-border bg-surface px-4 py-3 text-sm shadow-xl', { success: 'border-l-success', error: 'border-l-error', info: 'border-l-info' }[t.kind])}>
            {icon[t.kind]}<span className="min-w-0 flex-1 text-text">{t.text}</span>
          </div>
        ))}
      </div>
      {dialog && (
        <Modal title={dialog.title} onClose={() => close(false)} width="max-w-md"
          footer={<><Button variant="outline" onClick={() => close(false)}>Cancel</Button><Button variant={dialog.danger ? 'danger' : 'gold'} onClick={() => close(true)}>{dialog.confirmLabel ?? 'Confirm'}</Button></>}>
          <div className="flex gap-3 text-sm text-text-secondary">
            {dialog.danger && <AlertTriangle className="mt-0.5 shrink-0 text-error" size={18} />}
            <p>{dialog.text}</p>
          </div>
        </Modal>
      )}
    </UiContext.Provider>
  );
}
export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}

/* ------------------------------------------------------------------ Charts --- */
/** Small trend line used on KPI cards. */
export function Sparkline({ values, color = '#3478F6', height = 34 }: { values: number[]; color?: string; height?: number }) {
  const w = 120;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const id = `sp-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
