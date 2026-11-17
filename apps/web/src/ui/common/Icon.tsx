import type { IconSpec } from '../../commands/types.ts';

/** Lucide のアイコン、または文字のアイコン（章・節・前・附）を出す。 */
export function Icon({ icon, size }: { icon: IconSpec; size?: number }) {
  if (typeof icon === 'string') {
    return (
      <span
        className="ti"
        aria-hidden="true"
        style={size ? { width: size, height: size } : undefined}
      >
        {icon}
      </span>
    );
  }
  const C = icon;
  return <C className="i" aria-hidden="true" size={size} strokeWidth={1.8} />;
}
