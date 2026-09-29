import clsx from 'clsx';
import Link from 'next/link';

/** Lime roundel with a stylised three-wheeler "T" + wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-dark', className)} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none">
        <path d="M5 6.5h14" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M12 6.5v8.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="12" cy="19.5" r="2.2" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({ tone = 'dark', href = '/', className }: { tone?: 'dark' | 'light'; href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="TeslaPool home" className={clsx('inline-flex items-center gap-1.5 rounded-lg', className)}>
      <LogoMark />
      <span className={clsx('text-2xl font-black tracking-tight', tone === 'dark' ? 'text-dark' : 'text-white')}>
        Tesla<span className={clsx('text-brand', tone === 'dark' && 'wordmark-outline')}>Pool</span>
      </span>
    </Link>
  );
}
