import { Globe, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Earn with TeslaPool',
    links: [
      { href: '/drive', label: 'Drive with us' },
      { href: '/driver', label: 'Driver dashboard' },
      { href: '/driver/vehicles', label: 'Register a vehicle' },
    ],
  },
  {
    title: 'Our Services',
    links: [
      { href: '/ride/new', label: 'Pooled rides' },
      { href: '/areas', label: 'Dhaka areas' },
      { href: '/how-it-works#calculator', label: 'Fare calculator' },
      { href: '/wallet', label: 'TeslaPay wallet' },
      { href: '/safety', label: 'Safety' },
    ],
  },
  {
    title: 'Impact',
    links: [
      { href: '/impact', label: 'Live impact' },
      { href: '/intelligence', label: 'Intelligence' },
      { href: '/safety#seat-guarantee', label: 'Seat guarantee' },
      { href: '/news', label: 'Newsroom' },
    ],
  },
  {
    title: 'About',
    links: [
      { href: '/about', label: 'Company' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/terms', label: 'Terms of use' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
];

const SOCIAL = [
  { label: 'Facebook', path: 'M14 8h2.5V4.5H14c-2.2 0-4 1.8-4 4V10H8v3.5h2V20h3.5v-6.5H16l.5-3.5h-3V8.5c0-.3.2-.5.5-.5Z' },
  { label: 'X', path: 'M5 4.5h3.6l3.6 5 4.2-5h2.1l-5.3 6.3 6 8.7h-3.6l-3.9-5.5-4.6 5.5H5l5.7-6.8L5 4.5Z' },
  { label: 'Instagram', path: 'M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Zm4 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm4.6-1.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z' },
  { label: 'LinkedIn', path: 'M5 9h3v10H5V9Zm1.5-4.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5ZM10 9h2.9v1.4c.5-.9 1.6-1.6 3.1-1.6 3 0 3.5 1.9 3.5 4.4V19h-3v-5.1c0-1.2 0-2.6-1.6-2.6s-1.9 1.2-1.9 2.5V19h-3V9Z' },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 w-full bg-dark pb-10 pt-16 text-white print:hidden">
      <div className="container-page">
        <div className="grid grid-cols-2 gap-8 pb-12 md:grid-cols-3 lg:grid-cols-12">
          <div className="col-span-2 space-y-4 md:col-span-3 lg:col-span-4">
            <Logo tone="light" />
            <p className="max-w-xs pr-4 text-[11px] leading-relaxed text-white/50">
              TeslaPool pools passengers heading the same way into one auto-rickshaw (a Dhaka &ldquo;Tesla&rdquo;). Every fare follows a published formula;
              drivers are independent partners.
            </p>
            <div className="flex items-center gap-2.5 pt-1" aria-label="Social channels (launching soon)">
              {SOCIAL.map((s) => (
                <span key={s.label} title={`${s.label} — launching soon`} className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-dark">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                    <path d={s.path} fillRule="evenodd" />
                  </svg>
                  <span className="sr-only">{s.label} (launching soon)</span>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-[11px] font-bold text-white">
                <Globe className="h-4 w-4" aria-hidden="true" /> EN · Dhaka, Bangladesh
              </span>
              <Link
                href="/ride/new"
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-1.5 transition hover:border-brand hover:text-brand"
              >
                <Smartphone className="h-5 w-5" aria-hidden="true" />
                <span className="leading-tight">
                  <span className="block text-[9px] uppercase tracking-wider text-white/60">Open the</span>
                  <span className="block text-xs font-bold">Web app</span>
                </span>
              </Link>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="lg:col-span-2">
              <h2 className="mb-4 text-xs font-bold tracking-tight text-white">{col.title}</h2>
              <ul className="space-y-2.5 text-xs text-white/60">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} prefetch={false} className="rounded transition hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-8 text-[11px] text-white/40 sm:flex-row">
          <p>© {new Date().getFullYear()} TeslaPool. Built for Dhaka.</p>
          <p>Fares in BDT · Cash or TeslaPay (simulated wallet)</p>
        </div>
      </div>
    </footer>
  );
}
