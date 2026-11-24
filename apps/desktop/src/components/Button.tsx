import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '@/components/Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-accent to-[#5B8CFF] text-white shadow-glow hover:brightness-110 disabled:from-line disabled:to-line disabled:text-faint disabled:shadow-none',
  secondary: 'bg-raised text-text ring-1 ring-line hover:bg-[#1C2335] hover:ring-[#2E3850] disabled:text-faint',
  ghost: 'text-muted hover:bg-raised hover:text-text disabled:text-faint',
  danger: 'bg-bad/10 text-bad ring-1 ring-bad/30 hover:bg-bad/20 disabled:opacity-50',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-9 gap-2 px-4 text-sm',
  lg: 'h-11 gap-2 px-5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: IconName }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {icon && <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, active = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-accent/15 text-accent ring-1 ring-accent/40' : 'text-muted hover:bg-raised hover:text-text'} ${className}`}
    >
      <Icon name={icon} />
    </button>
  );
}
