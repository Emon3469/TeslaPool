import clsx from 'clsx';
import Link from 'next/link';
import { forwardRef } from 'react';
import { Spinner } from './States';

type Variant = 'lime' | 'dark' | 'outline' | 'ghost' | 'danger' | 'white';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold tracking-tight transition duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-50 select-none';

const variants: Record<Variant, string> = {
  lime: 'on-lime bg-brand text-dark shadow-sm hover:brightness-105 hover:shadow-md active:brightness-95',
  dark: 'bg-dark text-white shadow-sm hover:bg-black active:bg-black/90',
  outline: 'border border-dark/20 bg-transparent text-dark hover:border-dark/40 hover:bg-dark/5',
  ghost: 'bg-transparent text-dark hover:bg-dark/5',
  danger: 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  white: 'bg-white text-dark shadow-sm hover:bg-cream',
};

const sizes: Record<Size, string> = {
  sm: 'rounded-lg px-3.5 py-2 text-xs',
  md: 'rounded-xl px-5 py-2.5 text-sm',
  lg: 'rounded-xl px-6 py-3.5 text-sm',
};

export function buttonClass(variant: Variant = 'lime', size: Size = 'md', className?: string) {
  return clsx(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'lime', size = 'md', loading = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = 'lime',
  size = 'md',
  className,
  children,
  ...rest
}: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
