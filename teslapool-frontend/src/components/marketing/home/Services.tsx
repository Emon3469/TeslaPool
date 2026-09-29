import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { PooledRideArt, VehicleClassesArt, WalletArt } from '@/components/illustrations';

const SERVICES = [
  {
    title: 'Pooled Rides',
    body: 'Share a Tesla with riders going your way. Each passenger pays their own itemised fare, lower than riding alone.',
    chips: ['Passengers', 'Drivers'],
    href: '/ride/new',
    Art: PooledRideArt,
  },
  {
    title: 'Three Ways to Ride',
    body: 'Auto-rickshaw, rickshaw or bike ride-share: every class is quoted from the same transparent formula.',
    chips: ['Passengers', 'Drivers'],
    href: '/how-it-works',
    Art: VehicleClassesArt,
  },
  {
    title: 'TeslaPay Wallet',
    body: 'Pay cash to your driver or tap TeslaPay: settled the moment your trip completes, and it can never go below zero.',
    chips: ['Wallet'],
    href: '/wallet',
    Art: WalletArt,
  },
];

export function Services() {
  return (
    <section aria-labelledby="services-title" className="container-page py-16 md:py-20">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <span className="badge-tag mb-2">TeslaPool app</span>
          <h2 id="services-title" className="text-3xl font-black tracking-tight text-dark">
            Our <span className="highlight-marker">Service</span>
          </h2>
        </div>
        <Link href="/how-it-works" className="group inline-flex items-center rounded text-xs font-bold text-dark hover:text-dark/80">
          See more <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {SERVICES.map(({ title, body, chips, href, Art }) => (
          <article key={title} className="card card-hover group relative flex flex-col justify-between p-6">
            <div>
              <div className="relative mb-6 flex h-44 w-full items-center justify-center overflow-hidden rounded-2xl border-subtle bg-white p-2">
                <Art className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]" />
              </div>
              <h3 className="mb-1.5 text-lg font-bold text-dark">
                <Link href={href} className="after:absolute after:inset-0 after:rounded-3xl after:content-['']">
                  {title}
                </Link>
              </h3>
              <p className="mb-6 text-xs leading-relaxed text-muted">{body}</p>
            </div>
            <div className="flex items-center gap-2">
              {chips.map((c) => (
                <span key={c} className="badge-tag">
                  {c}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
