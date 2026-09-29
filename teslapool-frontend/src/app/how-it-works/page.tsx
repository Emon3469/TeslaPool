import { CheckCircle2, MapPin, Receipt, Route, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { FareCalculator } from '@/components/marketing/FareCalculator';
import { Faq, PageHero, SectionHeading } from '@/components/marketing/PageHero';
import { ButtonLink } from '@/components/ui/Button';
import { formatBdt } from '@/lib/format';
import { getMeta } from '@/lib/server';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'How TeslaPool matches riders into shared auto-rickshaws and how every fare is calculated.',
};

export const revalidate = 300;

const STEPS = [
  { icon: MapPin, title: 'Request a seat', body: 'Pick your zones, how many seats you need, and cash or TeslaPay. You get a quote before anything is booked.' },
  { icon: Route, title: 'See the pools that fit', body: 'Every open pool is checked against your route. You see which ones fit, the route each would take, and why others don’t.' },
  { icon: Users, title: 'Share the ride', body: 'Join a pool yourself or let a driver accept you. Co-riders see only your first name and zones, nothing else.' },
  { icon: Receipt, title: 'Pay your own fare', body: 'Each passenger pays an individual, itemised fare. It’s locked at pickup and settled when your trip completes.' },
];

export default async function HowItWorksPage() {
  const meta = await getMeta();
  const rules = meta?.rules;

  const RULES = rules
    ? [
        `A Tesla carries at most ${rules.poolMaxCapacity} passengers. A request for more seats than are left is declined, never squeezed in.`,
        `Your pickup must be within ${rules.pickupMaxHops} zone hop${rules.pickupMaxHops === 1 ? '' : 's'} of the pool’s current pickups.`,
        `Your destination must be within ${rules.destinationMaxHops} zone hop${rules.destinationMaxHops === 1 ? '' : 's'} of the pool’s destinations.`,
        `No passenger’s detour may exceed ${rules.maxDetourKm} km or ${Math.round(rules.maxDetourRatio * 100)}% of their direct trip, and that includes the people already on board.`,
        `A route has at most ${rules.maxStops} stops, and every pickup comes before that passenger’s drop-off.`,
        rules.allowLateJoin ? 'You can join a pool that has already started, if the rules above still hold.' : 'Pools stop accepting new riders once the trip has started.',
      ]
    : [];

  return (
    <>
      <PageHero
        tag="How it works"
        title="One Tesla, several riders,"
        highlight="one fair fare each."
        subtitle="TeslaPool fills the empty seats of Dhaka’s auto-rickshaws with passengers heading the same way. Here is exactly how a match is made and how your price is worked out."
      >
        <ButtonLink href="/ride/new" size="lg">
          Get a quote
        </ButtonLink>
      </PageHero>

      <section className="container-page py-16 md:py-20" aria-label="How it works in four steps">
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="card card-hover relative p-6">
              <span className="absolute right-6 top-6 text-5xl font-black text-dark/[0.06]">{i + 1}</span>
              <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="text-lg font-bold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-white" aria-labelledby="rules-title">
        <div className="container-page grid gap-10 py-16 md:py-20 lg:grid-cols-2">
          <div>
            <SectionHeading id="rules-title" tag="Matching" title="The rules every" highlight="match must pass" body="Matching is deterministic: the same requests always give the same pools. Every rule is checked for you and for every passenger already riding." />
            <p className="text-sm text-muted">
              When a pool can’t take you, you see the reason in plain words, for example{' '}
              <em className="font-medium not-italic text-dark">“Not matched: Only 1 seat left, 2 requested”</em>.
            </p>
          </div>
          <ul className="space-y-3">
            {RULES.length === 0 && <li className="text-sm text-muted">Live rules are unavailable right now.</li>}
            {RULES.map((r) => (
              <li key={r} className="flex gap-3 rounded-2xl border-subtle bg-cream/60 p-4 text-sm leading-relaxed">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-lime-600" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="calculator" className="container-page scroll-mt-24 py-16 md:py-20" aria-labelledby="calc-title">
        <div className="mb-8 grid gap-6 lg:grid-cols-2 lg:items-end">
          <div>
            <span className="badge-tag mb-2">Fares</span>
            <h2 id="calc-title" className="text-3xl font-black tracking-tight">
              A price you can <span className="highlight-marker">check by hand</span>
            </h2>
          </div>
          {meta && (
            <p className="rounded-2xl bg-dark px-5 py-4 font-mono text-xs leading-relaxed text-brand sm:text-sm">
              fare = {formatBdt(meta.fare.basePoysha)} + km × {formatBdt(meta.fare.perKmPoysha)} + min × {formatBdt(meta.fare.perMinPoysha)}
              <span className="block text-white/60">pooled = fare × (1 − your discount, up to {meta.fare.maxPoolDiscountPercent}%)</span>
            </p>
          )}
        </div>
        <FareCalculator />
      </section>

      <section className="container-page pb-16 md:pb-20" aria-labelledby="faq-title">
        <SectionHeading id="faq-title" tag="FAQ" title="Questions," highlight="answered" />
        <Faq
          items={[
            { q: 'Why is it called a “Tesla”?', a: 'In Dhaka, the green CNG auto-rickshaw is jokingly called a Tesla. TeslaPool pools them; no electric sports cars involved.' },
            {
              q: 'Can my fare go up after I join?',
              a: 'Never above your quote. Your solo fare is the ceiling: it drops when a compatible passenger shares your route, can return towards the quote if they leave before pickup, and is locked the moment your trip starts.',
            },
            { q: 'Why do two people in the same Tesla pay different amounts?', a: 'Each discount depends on how much of that passenger’s own trip is shared. Someone who shares 100% of their ride saves more than someone who shares half of it.' },
            { q: 'What happens if two people grab the last seat at once?', a: 'Exactly one gets it. The other is told the seat is gone and can match elsewhere. Seats are never overbooked.' },
            { q: 'How do I pay?', a: 'Cash to the driver, or TeslaPay from your in-app wallet. TeslaPay is charged automatically when your trip completes and can never overdraw your balance.' },
          ]}
        />
      </section>
    </>
  );
}
