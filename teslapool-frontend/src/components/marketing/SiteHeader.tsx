'use client';

import clsx from 'clsx';
import { ChevronDown, Globe, LogOut, Menu, User as UserIcon, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { initials } from '@/lib/format';
import { homeFor, useLogout, useMe } from '@/lib/hooks';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/areas', label: 'Areas' },
  { href: '/safety', label: 'Safety' },
  { href: '/impact', label: 'Impact' },
];

const MORE = [
  { href: '/intelligence', label: 'Intelligence', hint: 'System health, models and rules' },
  { href: '/drive', label: 'Drive with us', hint: 'Earn with your auto-rickshaw' },
  { href: '/news', label: 'Newsroom', hint: 'Product updates' },
  { href: '/about', label: 'About', hint: 'Why we built TeslaPool' },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Closes a popover on outside click and Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export function SiteHeader() {
  const pathname = usePathname();
  const overHero = pathname === '/';
  const { user } = useMe();
  const logout = useLogout();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const moreRef = useDismiss(moreOpen, () => setMoreOpen(false));
  const langRef = useDismiss(langOpen, () => setLangOpen(false));
  const userRef = useDismiss(userOpen, () => setUserOpen(false));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setMoreOpen(false);
    setUserOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const moreActive = MORE.some((m) => isActive(pathname, m.href));
  const appHref = homeFor(user);
  const appLabel = user?.role === 'DRIVER' ? 'Driver dashboard' : user?.role === 'ADMIN' ? 'Ops console' : 'My dashboard';

  return (
    <header
      className={clsx(
        'sticky top-0 z-50 w-full transition-all duration-200 print:hidden',
        scrolled ? 'border-b border-dark/[0.06] bg-cream/85 shadow-[0_1px_12px_rgba(0,0,0,0.04)] backdrop-blur-md' : overHero ? 'bg-transparent' : 'bg-cream',
      )}
    >
      <div className="container-page flex h-16 items-center justify-between gap-4 sm:h-[72px]">
        <Logo />

        <nav aria-label="Main" className="hidden items-center gap-8 text-sm font-medium lg:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx('relative inline-flex flex-col items-center pb-1 transition-colors', active ? 'font-bold text-dark' : 'text-dark/75 hover:text-dark')}
              >
                {item.label}
                <span className={clsx('mt-0.5 block h-[3px] w-4 rounded-full bg-dark transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
              </Link>
            );
          })}
          <div ref={moreRef} className="relative">
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="true"
              onClick={() => setMoreOpen((v) => !v)}
              className={clsx('inline-flex items-center gap-1 pb-[7px] transition-colors', moreActive ? 'font-bold text-dark' : 'text-dark/75 hover:text-dark')}
            >
              More <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-180')} aria-hidden="true" />
            </button>
            {moreOpen && (
              <div className="absolute left-1/2 top-full z-10 mt-3 w-64 -translate-x-1/2 animate-fade-up rounded-2xl border-subtle bg-white p-2 shadow-card-hover">
                {MORE.map((m) => (
                  <Link key={m.href} href={m.href} className="block rounded-xl px-3 py-2.5 transition hover:bg-cream">
                    <span className="block text-sm font-bold text-dark">{m.label}</span>
                    <span className="block text-xs text-muted">{m.hint}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <div ref={langRef} className="relative hidden sm:block">
            <button
              type="button"
              aria-label="Language: English"
              aria-expanded={langOpen}
              onClick={() => setLangOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-dark/20 px-3 py-1.5 text-[11px] font-bold text-dark transition hover:bg-dark/5"
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              EN
              <ChevronDown className="h-3 w-3 text-dark/70" aria-hidden="true" />
            </button>
            {langOpen && (
              <div role="menu" className="absolute right-0 top-full z-10 mt-2 w-44 animate-fade-up rounded-2xl border-subtle bg-white p-1.5 shadow-card-hover">
                <span role="menuitemradio" aria-checked="true" className="flex items-center justify-between rounded-xl bg-cream px-3 py-2 text-sm font-bold">
                  English <span className="h-2 w-2 rounded-full bg-brand ring-2 ring-dark/10" />
                </span>
                <span role="menuitemradio" aria-checked="false" aria-disabled="true" className="flex items-center justify-between px-3 py-2 text-sm text-muted">
                  বাংলা <span className="text-[10px] font-bold uppercase">Soon</span>
                </span>
              </div>
            )}
          </div>

          {user ? (
            <>
              <Link href={appHref} className={buttonClass('lime', 'sm', 'hidden rounded-xl px-5 py-2 sm:inline-flex')}>
                {appLabel}
              </Link>
              <div ref={userRef} className="relative">
                <button
                  type="button"
                  aria-label={`Account menu for ${user.name}`}
                  aria-expanded={userOpen}
                  onClick={() => setUserOpen((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-dark text-xs font-bold text-brand ring-2 ring-white transition hover:scale-105"
                >
                  {initials(user.name)}
                </button>
                {userOpen && (
                  <div className="absolute right-0 top-full z-10 mt-2 w-60 animate-fade-up rounded-2xl border-subtle bg-white p-2 shadow-card-hover">
                    <div className="border-b border-dark/5 px-3 pb-2.5 pt-1.5">
                      <p className="truncate text-sm font-bold">{user.name}</p>
                      <p className="truncate text-xs text-muted">{user.email}</p>
                      <span className="badge-tag mt-2 bg-mint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{user.role.toLowerCase()}</span>
                    </div>
                    <Link href={appHref} className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-cream">
                      {appLabel}
                    </Link>
                    <Link href="/wallet" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-cream">
                      <Wallet className="h-4 w-4" aria-hidden="true" /> Wallet
                    </Link>
                    <Link href="/profile" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-cream">
                      <UserIcon className="h-4 w-4" aria-hidden="true" /> Profile
                    </Link>
                    <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50">
                      <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/login" className="hidden rounded-lg px-2 py-1 text-sm font-bold text-dark/80 transition hover:text-dark sm:inline">
                Log in
              </Link>
              <Link href="/ride/new" className={buttonClass('lime', 'sm', 'rounded-xl px-5 py-2')}>
                Book a ride
              </Link>
            </>
          )}

          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-dark transition hover:bg-dark/5 lg:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div id="mobile-nav" className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-cream px-4 pb-10 pt-4 lg:hidden">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {[...NAV, ...MORE].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                className={clsx('rounded-2xl px-4 py-3.5 text-lg font-bold transition', isActive(pathname, item.href) ? 'bg-brand' : 'hover:bg-white')}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-6 grid gap-3 border-t border-dark/10 pt-6">
            {user ? (
              <>
                <Link href={appHref} className={buttonClass('lime', 'lg')}>
                  {appLabel}
                </Link>
                <Link href="/wallet" className={buttonClass('outline', 'lg')}>
                  Wallet
                </Link>
                <button type="button" onClick={logout} className={buttonClass('ghost', 'lg', 'text-red-700')}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href="/ride/new" className={buttonClass('lime', 'lg')}>
                  Book a ride
                </Link>
                <Link href="/login" className={buttonClass('outline', 'lg')}>
                  Log in
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
