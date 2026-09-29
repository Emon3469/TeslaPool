import { EyeOff, History, LifeBuoy, Lock, PhoneCall, ShieldCheck, UserCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { SafetyRing, SeatGuaranteeArt } from '@/components/illustrations';
import { PageHero, SectionHeading } from '@/components/marketing/PageHero';
import { ButtonLink } from '@/components/ui/Button';
import { getImpact } from '@/lib/server';

export const metadata: Metadata = {
  title: 'Safety',
  description: 'The TeslaPool safety pact: what passengers, drivers and TeslaPool promise each other on every ride.',
};

export const revalidate = 30;

const PACT = [
  {
    who: 'Passengers',
    promises: ['Be at your pickup zone on time', 'Book only the seats you need', 'Treat co-riders and your driver with respect', 'Cancel before the driver arrives if plans change'],
  },
  {
    who: 'Drivers',
    promises: ['Drive a registered vehicle with its plate on file', 'Mark arrival and trip start honestly', 'Never carry more riders than the seats offered', 'Go offline only when no one is waiting on you'],
  },
  {
    who: 'TeslaPool',
    promises: ['Never overbook a seat', 'Show only first names and zones to co-riders', 'Explain every match and every taka', 'Keep a permanent, tamper-proof ride timeline'],
  },
];

const FEATURES = [
  { icon: EyeOff, title: 'Minimal sharing', body: 'Co-riders see your first name, seats and zones. Never your phone, email, fare or ride ID.' },
  { icon: UserCheck, title: 'Known driver and vehicle', body: 'Your ride shows the driver’s first name, the vehicle’s name and its registration number.' },
  { icon: History, title: 'Tamper-proof timeline', body: 'Every status change is written to an append-only history the database refuses to edit or delete.' },
  { icon: Lock, title: 'Only you see your ride', body: 'Every request is checked for ownership; someone else’s ride returns “forbidden”, not data.' },
  { icon: Users, title: 'Honest rules', body: 'Detour limits protect people already on board: a new rider can’t make your trip much longer.' },
  { icon: LifeBuoy, title: 'Leave or cancel', body: 'Leave a pool before the driver arrives, or cancel until pickup. Your fare is never charged for a cancelled ride.' },
];

export default async function SafetyPage() {
  const impact = await getImpact();
  return (
    <>
      <PageHero
        tag="Safety"
        title="Your safety"
        highlight="is our priority"
        subtitle="Sharing a ride with strangers takes trust. The safety pact is how passengers, drivers and TeslaPool earn it from each other, on every single ride."
      />

      <section className="container-page py-16 md:py-20" aria-labelledby="pact-title">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <SectionHeading id="pact-title" tag="The pact" title="A three-way" highlight="promise" body="Every ride is an alliance with mutual responsibilities. Here is what each side commits to." />
            <div className="flex justify-center lg:justify-start">
              <SafetyRing />
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-3 lg:col-span-8">
            {PACT.map((p, i) => (
              <article key={p.who} className={`card p-6 ${i === 2 ? 'bg-dark text-white' : ''}`}>
                <h3 className={`text-lg font-black ${i === 2 ? 'text-brand' : ''}`}>{p.who}</h3>
                <ul className="mt-4 space-y-3 text-sm">
                  {p.promises.map((x) => (
                    <li key={x} className="flex gap-2.5">
                      <ShieldCheck className={`mt-0.5 h-4 w-4 flex-shrink-0 ${i === 2 ? 'text-brand' : 'text-lime-600'}`} aria-hidden="true" />
                      <span className={i === 2 ? 'text-white/85' : 'text-dark/80'}>{x}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="seat-guarantee" className="scroll-mt-24 bg-white" aria-labelledby="seat-title">
        <div className="container-page grid items-center gap-10 py-16 md:py-20 lg:grid-cols-2">
          <div>
            <SectionHeading id="seat-title" tag="Seat guarantee" title="Seats are a promise," highlight="not a guess" />
            <p className="text-sm leading-relaxed text-muted">
              When several people tap join for the last seat at the same moment, exactly one gets it. The pool is locked while every rule is re-checked on
              fresh data, and the database independently refuses any booking that would exceed the vehicle’s seats. Two layers, so one bug can’t
              overbook you.
            </p>
            <div className="mt-6 flex items-center gap-4 rounded-2xl bg-brand p-5">
              <span className="text-5xl font-black tabular-nums">{impact ? impact.integrity.capacityViolations : '—'}</span>
              <span className="text-sm font-bold leading-snug">
                capacity violations across {impact ? impact.integrity.checkedPools : '—'} pools,
                <span className="block font-medium text-dark/70">recounted live from raw bookings</span>
              </span>
            </div>
          </div>
          <div className="card mx-auto aspect-[16/10] w-full max-w-lg overflow-hidden p-0">
            <SeatGuaranteeArt className="h-full w-full" />
          </div>
        </div>
      </section>

      <section className="container-page py-16 md:py-20" aria-labelledby="features-title">
        <SectionHeading id="features-title" tag="Built in" title="Safety features on" highlight="every ride" center />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="card card-hover p-6">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-mint">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="font-bold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-5 rounded-4xl bg-dark p-8 text-white sm:flex-row sm:items-center sm:p-10">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-brand text-dark">
              <PhoneCall className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-lg font-black">In an emergency, call 999</p>
              <p className="text-sm text-white/60">Bangladesh’s national emergency service: police, fire and ambulance.</p>
            </div>
          </div>
          <ButtonLink href="/ride/new" size="lg">
            Book a safe ride
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
