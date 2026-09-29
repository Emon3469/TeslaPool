import { BadgeCheck, Banknote, ClipboardList, Power, Route, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import { AutoRickshaw } from '@/components/illustrations';
import { Faq, PageHero, SectionHeading } from '@/components/marketing/PageHero';
import { ButtonLink } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Drive with us',
  description: 'Fill every seat of your auto-rickshaw with riders already heading your way.',
};

const BENEFITS = [
  { icon: Route, title: 'Riders on your route', body: 'You see waiting passengers who fit your current route, the detour each would add, and how long they have waited.' },
  { icon: Banknote, title: 'Every seat can earn', body: 'Up to three riders share one trip, each paying their own fare. TeslaPay fares land in your wallet as soon as the trip completes.' },
  { icon: Power, title: 'Online when you want', body: 'Choose a vehicle and go online in one tap. Go offline whenever no passenger is waiting on you.' },
  { icon: BadgeCheck, title: 'No surprises', body: 'Rules are published. You can’t be asked to overload your vehicle, and passengers can’t be added past your seat count.' },
];

const STEPS = [
  { icon: ClipboardList, title: 'Create a driver account', body: 'Sign up as a driver with your name, phone and email.' },
  { icon: Wallet, title: 'Register your vehicle', body: 'Add its name, type, seats and registration number, e.g. DHAKA-METRO-TA-11-2233.' },
  { icon: Power, title: 'Go online', body: 'Your vehicle opens a live pool. Accept riders or let them join; follow the stop order on screen.' },
];

export default function DrivePage() {
  return (
    <>
      <PageHero
        tag="Drive with us"
        title="Fill every seat of"
        highlight="your Tesla."
        subtitle="TeslaPool brings you passengers who are already going your way, so one trip carries up to three paying riders instead of one."
      >
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/register?role=DRIVER" size="lg">
            Become a driver
          </ButtonLink>
          <ButtonLink href="/login?next=/driver" variant="outline" size="lg">
            Driver log in
          </ButtonLink>
        </div>
      </PageHero>

      <section className="container-page py-16 md:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="grid gap-5 sm:grid-cols-2">
            {BENEFITS.map(({ icon: Icon, title, body }) => (
              <article key={title} className="card card-hover p-6">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="font-bold">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </article>
            ))}
          </div>
          <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-4xl bg-mint">
            <svg viewBox="0 0 300 200" className="w-4/5" aria-hidden="true">
              <ellipse cx="150" cy="176" rx="130" ry="12" fill="#151515" opacity="0.08" />
              <line x1="10" y1="172" x2="290" y2="172" stroke="#151515" strokeWidth="1.5" />
              <AutoRickshaw x={44} y={25} />
            </svg>
            <span className="absolute left-5 top-5 rounded-full bg-white px-3 py-1 text-xs font-bold shadow-card">3 seats · 3 fares</span>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-page py-16 md:py-20">
          <SectionHeading tag="Getting started" title="On the road in" highlight="three steps" center />
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="relative rounded-3xl border-subtle bg-cream/60 p-6">
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-dark text-sm font-black text-brand">{i + 1}</span>
                <h3 className="flex items-center gap-2 font-bold">
                  <Icon className="h-4 w-4" aria-hidden="true" /> {title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container-page py-16 md:py-20">
        <SectionHeading tag="FAQ" title="Driver" highlight="questions" />
        <Faq
          items={[
            { q: 'How are passengers assigned to me?', a: 'Passengers can join your open pool when the route rules fit, or you can accept compatible waiting requests yourself from your dashboard. Either way the same checks run, inside one transaction.' },
            { q: 'Can I go offline mid-trip?', a: 'Not while passengers are assigned to you. Finish or hand back those rides first; then going offline closes your pool.' },
            { q: 'How do I get paid?', a: 'Cash riders pay you directly. TeslaPay fares are credited to your TeslaPay wallet automatically when you complete each passenger’s trip.' },
            { q: 'What vehicles can I register?', a: 'Auto-rickshaws (CNG “Teslas”), rickshaws and bikes for ride-share. Each vehicle has a seat count, and a pool never exceeds it.' },
          ]}
        />
      </section>
    </>
  );
}
