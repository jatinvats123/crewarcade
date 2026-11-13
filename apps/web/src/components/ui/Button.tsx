import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'approve';
export type ButtonSize = 'md' | 'lg' | 'sm';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-ink hover:brightness-110 shadow-card',
  secondary: 'bg-surface-2 text-text border border-border hover:bg-surface-3',
  ghost: 'bg-transparent text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
  approve: 'bg-success text-[#06261a] hover:brightness-110 shadow-card',
};
// Every size keeps a >= 44px touch target (sm pads its hit area).
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-11 px-4 text-base',
  lg: 'min-h-13 px-6 text-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold transition-[filter,background-color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
    </button>
  );
}
