import { AutoRickshaw } from '@/components/illustrations';
import { ButtonLink } from '@/components/ui/Button';

/** The TeslaPool playbook as a 3D hardcover: the design's book promo, with our own cover art. */
function Book() {
  return (
    <div className="relative w-60 transition-transform duration-300 hover:scale-105 sm:w-72" style={{ perspective: '1200px' }}>
      <div
        className="relative w-full overflow-hidden rounded-xl"
        style={{
          transform: 'rotate(-8deg) rotateY(18deg) rotateX(12deg)',
          boxShadow: '-20px 25px 40px rgba(21, 21, 21, 0.4), 0 10px 20px rgba(0,0,0,0.25)',
        }}
      >
        <div className="relative flex aspect-[3/4.2] w-full flex-col justify-between border-l-4 border-[#0d0d0d] bg-gradient-to-b from-[#2a2a2a] via-[#1c1c1c] to-[#0f0f0f] p-6 text-white">
          <div>
            <span className="block text-[10px] font-medium tracking-wider text-white/60">The TeslaPool Playbook</span>
            <p className="mt-1 text-3xl font-black leading-none tracking-tight text-brand drop-shadow-sm sm:text-4xl">Every Seat Counts</p>
            <p className="mt-1.5 text-[10px] font-semibold tracking-wide text-white/80">From empty seats to shared journeys</p>
          </div>
          <div className="relative my-2 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-cream">
            <svg viewBox="0 0 280 170" className="w-[88%]" aria-hidden="true">
              <line x1="0" y1="152" x2="280" y2="152" stroke="#151515" strokeWidth="2" />
              <AutoRickshaw x={34} y={5} />
            </svg>
          </div>
          <p className="pt-1 font-mono text-[9px] leading-tight text-brand/95">How explainable matching, personal fares and a seat guarantee keep Dhaka moving.</p>
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 top-0 w-3 bg-gradient-to-r from-black/40 via-black/10 to-transparent" />
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/10" />
      </div>
    </div>
  );
}

export function PromoBanner() {
  return (
    <section aria-labelledby="promo-title" id="download" className="container-page py-10">
      <div className="on-lime relative overflow-hidden rounded-3xl bg-brand p-8 shadow-sm sm:rounded-4xl sm:p-12 lg:p-16">
        <div className="relative z-10 grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="max-w-xl space-y-5 lg:col-span-7">
            <h2 id="promo-title" className="text-3xl font-black leading-[1.12] tracking-tight text-dark sm:text-4xl lg:text-[44px]">
              From Empty Seats to Shared Journeys: A Story of Growth and Innovation.
            </h2>
            <p className="max-w-md text-sm font-medium leading-relaxed text-dark/80">
              How TeslaPool pools Dhaka&rsquo;s auto-rickshaws: explainable matches, a fare you can verify yourself, and seats that are never
              overbooked.
            </p>
            <div className="flex flex-wrap gap-3 pt-4">
              <ButtonLink href="/ride/new" variant="dark" size="lg">
                Book a ride
              </ButtonLink>
              <ButtonLink href="/how-it-works" variant="outline" size="lg" className="border-dark/30">
                Read the playbook
              </ButtonLink>
            </div>
          </div>
          <div className="relative flex justify-center lg:col-span-5 lg:justify-end">
            <Book />
          </div>
        </div>
      </div>
    </section>
  );
}
