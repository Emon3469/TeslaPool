import { ButtonLink } from '@/components/ui/Button';
import { Photo } from '@/components/ui/Photo';
import { PHOTOS } from '@/content/media';

function Sparkle({ className, size = 22 }: { className: string; size?: number }) {
  return (
    <svg className={`pointer-events-none absolute select-none text-[#9eb85b] opacity-40 ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
    </svg>
  );
}

export interface HeroMetric {
  label: string;
  value: string;
  live?: boolean;
}

export function Hero({ metrics }: { metrics: HeroMetric[] }) {
  return (
    <section aria-labelledby="hero-title" className="relative -mt-16 overflow-hidden bg-mint pt-16 sm:-mt-[72px] sm:pt-[72px]">
      <div className="container-page relative pb-16 pt-8">
        <Sparkle className="left-1/4 top-4" />
        <Sparkle className="bottom-8 left-12" size={26} />
        <Sparkle className="right-1/3 top-10 hidden lg:block" size={14} />

        <div className="grid grid-cols-1 items-center gap-10 pb-6 pt-2 lg:grid-cols-12 lg:gap-8">
          <div className="z-10 space-y-6 lg:col-span-6">
            <h1 id="hero-title" className="text-4xl font-black leading-[1.08] tracking-tight text-dark sm:text-5xl lg:text-[58px]">
              Together, We Make a
              <br />
              <span className="mt-1 inline-block rounded-md bg-brand px-2 py-0.5">Greener Dhaka.</span>
            </h1>
            <p className="max-w-md pt-1 text-sm font-medium leading-relaxed text-dark/75 sm:text-base">
              Whether you&rsquo;re commuting to Motijheel, meeting friends in Gulshan or heading home to Mirpur, TeslaPool seats you in a shared
              auto-rickshaw going your way: smart, safe, and kinder to the city.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <ButtonLink href="/ride/new" size="lg">
                Book a ride
              </ButtonLink>
              <ButtonLink href="/how-it-works" variant="ghost" size="lg" className="underline-offset-4 hover:underline">
                How pooling works
              </ButtonLink>
            </div>
            <dl className="grid max-w-md grid-cols-3 gap-6 pt-8">
              {metrics.map((m) => (
                <div key={m.label}>
                  <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    {m.label}
                    {m.live && (
                      <span className="relative flex h-1.5 w-1.5" title="Live from the API">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-500 opacity-70" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime-600" />
                      </span>
                    )}
                  </dt>
                  <dd className="mt-0.5 text-2xl font-black text-dark sm:text-3xl">{m.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative flex justify-center lg:col-span-6 lg:justify-end">
            <div className="relative w-full max-w-lg lg:max-w-none">
              <div
                className="relative overflow-hidden rounded-2xl"
                style={{ clipPath: 'polygon(18% 0%, 100% 0%, 100% 82%, 85% 82%, 85% 100%, 0% 100%, 0% 22%, 18% 22%)', aspectRatio: '1.15 / 1' }}
              >
                <Photo
                  src={PHOTOS.driver}
                  alt="A smiling TeslaPool driver at the wheel"
                  className="h-full w-full"
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  priority
                  style={{ transform: 'scaleX(-1)', objectPosition: '45% 25%' }}
                />
              </div>
              <div className="pointer-events-none absolute left-0 top-0 h-[22%] w-[18%] bg-mint" />
              <div className="pointer-events-none absolute bottom-0 right-0 h-[18%] w-[15%] bg-mint" />
              <div className="absolute bottom-[6%] left-[4%] hidden animate-fade-up items-center gap-3 rounded-2xl border-subtle bg-white/95 p-3 pr-4 shadow-card-hover backdrop-blur sm:flex">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-lg font-black">3</span>
                <span className="text-xs leading-tight">
                  <span className="block font-bold text-dark">Seats per Tesla</span>
                  <span className="block text-muted">each one guaranteed</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
