import { SafetyRing, ZigzagBackdrop } from '@/components/illustrations';
import { ButtonLink } from '@/components/ui/Button';
import { Photo } from '@/components/ui/Photo';
import { PHOTOS } from '@/content/media';

export function SafetyBanner() {
  return (
    <section aria-labelledby="safety-title" className="container-page py-16 text-center md:py-20">
      <span className="badge-tag mb-3 text-[11px] font-bold uppercase tracking-wider">Safety</span>
      <h2 id="safety-title" className="text-3xl font-black tracking-tight text-dark sm:text-4xl">
        Your safety <span className="highlight-marker">is our priority</span>
      </h2>
      <p className="mt-2 text-xs text-muted sm:text-sm">Stay on the safe side with TeslaPool</p>

      <div className="mt-10 grid grid-cols-1 items-center gap-8 overflow-hidden rounded-4xl border-subtle bg-cardBg p-6 text-left shadow-card sm:p-10 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <h3 className="text-2xl font-black leading-snug text-dark sm:text-3xl">We want all of us to be on the same page about safety</h3>
          <p className="text-sm leading-relaxed text-muted">
            That&rsquo;s why we call it our safety pact: a three-way promise between passengers, drivers and TeslaPool. You always see who you
            share with, seats are never overbooked, and every ride keeps a tamper-proof timeline.
          </p>
          <div className="pt-2">
            <ButtonLink href="/safety" size="sm" className="px-6 py-2.5">
              Learn more
            </ButtonLink>
          </div>
        </div>
        <div className="flex justify-center py-4 lg:col-span-3">
          <SafetyRing />
        </div>
        <div className="flex justify-center lg:col-span-4 lg:justify-end">
          <div className="relative flex aspect-square w-full max-w-sm items-end justify-center overflow-hidden rounded-3xl bg-white">
            <ZigzagBackdrop className="absolute inset-0 h-full w-full" />
            <Photo
              src={PHOTOS.passenger}
              alt="A smiling TeslaPool passenger"
              className="relative z-10 h-[88%] w-[78%] rounded-t-[2rem] bg-transparent"
              sizes="(min-width: 1024px) 30vw, 80vw"
              imgClassName="object-cover object-top drop-shadow-md"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
