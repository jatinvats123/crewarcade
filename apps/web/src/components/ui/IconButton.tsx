import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '@/lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  icon: ReactNode;
  variant?: 'ghost' | 'filled' | 'brand';
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT = {
  ghost: 'text-dim hover:text-text hover:bg-surface-2',
  filled: 'bg-surface-2 text-text border border-border hover:bg-surface-3',
  brand: 'bg-brand text-brand-ink hover:brightness-110',
} as const;

export function IconButton({ label, icon, variant = 'ghost', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-[filter,background-color,transform] duration-150 active:scale-90 disabled:opacity-40',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
