import markUrl from '@/assets/logo-mark.png';
import textUrl from '@/assets/logo-text.png';

/** The Eventora OS app icon (navy "E" + gold triangle). */
export function LogoMark({ size = 36 }: { size?: number }) {
  return <img src={markUrl} width={size} height={size} alt="Eventora OS" draggable={false} className="shrink-0 select-none" style={{ width: size, height: size }} />;
}

/** The "EVENTORA OS" wordmark that sits to the right of the icon. */
export function LogoText({ height = 15 }: { height?: number }) {
  return <img src={textUrl} alt="Eventora OS" draggable={false} className="block max-w-full select-none" style={{ height, width: 'auto' }} />;
}

export function Brand({ collapsed = false, subtitle = 'Event OS', size = 'md' }: { collapsed?: boolean; subtitle?: string; size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <div className="flex items-center gap-3 overflow-hidden">
      <LogoMark size={lg ? 46 : 38} />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <LogoText height={lg ? 20 : 15} />
          <p className="mt-1.5 truncate text-[11px] text-text-secondary">{subtitle}</p>
        </div>
      )}
    </div>
  );
}
