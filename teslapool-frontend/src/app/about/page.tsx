import { Eye, Scale, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { CityScene } from '@/components/illustrations';
import { PageHero, SectionHeading } from '@/components/marketing/PageHero';
import { ButtonLink } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'About',
  description: 'Why TeslaPool exists and the principles it is built on.',
};

const PRINCIPLES = [
  { icon: Eye, title: 'Explain everything', body: 'Every match carries its reasons, every rejection its cause, every fare its arithmetic. If we can’t explain a decision, we don’t make it.' },
  { icon: Scale, title: 'Fair by construction', body: 'Money is stored as whole poysha. Each passenger’s discount comes from their own shared distance, so nobody subsidises anyone else by accident.' },
  { icon: ShieldCheck, title: 'Promises the database keeps', body: 'Capacity, balances and ride history are enforced by the database itself, not only by application code that might have a bug.' },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        tag="Company"
        title="Built in Dhaka,"
        highlight="for Dhaka’s streets."
        subtitle="Every morning thousands of auto-rickshaws carry one passenger with two empty seats down the same roads. TeslaPool exists to fill those seats, fairly."
      />
      <section className="container-page grid items-center gap-10 py-16 md:py-20 lg:grid-cols-2">
        <div>
          <SectionHeading tag="Our story" title="From empty seats to" highlight="shared journeys" />
          <div className="space-y-4 text-sm leading-relaxed text-dark/75">
            <p>
              Dhaka’s green CNG auto-rickshaws, nicknamed “Teslas”, are the backbone of short trips across the city. They are also often two-thirds
              empty. Pooling them means lower fares for riders, more income per trip for drivers, and fewer engines idling in traffic.
            </p>
            <p>
              Pooling only works if people trust it. So TeslaPool shows its work: who you share with and why, what you pay and how it was calculated, and
              a public page of live numbers, including the ones that would expose our own mistakes.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/how-it-works">How it works</ButtonLink>
            <ButtonLink href="/impact" variant="outline">
              Live impact
            </ButtonLink>
          </div>
        </div>
        <div className="rounded-4xl bg-white p-6 shadow-card">
          <CityScene className="h-auto w-full" />
        </div>
      </section>
      <section className="bg-white">
        <div className="container-page py-16 md:py-20">
          <SectionHeading tag="Principles" title="What we" highlight="won’t compromise" center />
          <div className="grid gap-6 md:grid-cols-3">
            {PRINCIPLES.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-3xl border-subtle bg-cream/60 p-6">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
