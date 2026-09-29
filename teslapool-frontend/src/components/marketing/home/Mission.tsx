import { CityScene } from '@/components/illustrations';
import { Photo } from '@/components/ui/Photo';
import { PHOTOS } from '@/content/media';

export function Mission() {
  return (
    <section aria-labelledby="mission-title" className="bg-white">
      <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center sm:px-6 lg:px-8 md:py-20">
        <div className="mx-auto max-w-3xl space-y-3">
          <h2 id="mission-title" className="text-2xl font-black leading-snug tracking-tight text-dark sm:text-3xl lg:text-[34px]">
            Challenging empty seats to <span className="highlight-marker">make every commute fairer</span> for millions of Dhaka riders{' '}
            <span className="ml-1 inline-flex -space-x-1.5 align-middle">
              {PHOTOS.avatars.map((src, i) => (
                <Photo key={src} src={src} alt="" className="h-7 w-7 rounded-full border-2 border-white" sizes="28px" imgClassName={i === 1 ? 'object-top' : undefined} />
              ))}
            </span>
          </h2>
          <p className="mx-auto max-w-xl pt-1 text-xs leading-relaxed text-muted sm:text-sm">
            Half-empty auto-rickshaws crawl down the same roads every morning. We pool riders who are heading the same way, so every trip costs less,
            every seat is used, and fewer engines idle in traffic.
          </p>
        </div>
        <div className="mt-8 flex justify-center">
          <CityScene className="h-auto w-full max-w-2xl" />
        </div>
      </div>
    </section>
  );
}
