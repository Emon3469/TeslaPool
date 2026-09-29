import Link from 'next/link';
import { formatNewsDate, NEWS } from '@/content/news';
import { NewsArtwork } from '../NewsArtwork';

export function RightNow() {
  const [feature, ...rest] = NEWS;
  return (
    <section aria-labelledby="news-title" className="container-page py-16 md:py-20">
      <div className="mb-10 text-center">
        <span className="badge-tag mb-3 text-[11px] font-bold uppercase tracking-wider text-dark/70">Newsroom</span>
        <h2 id="news-title" className="text-3xl font-black leading-tight tracking-tight text-dark sm:text-4xl lg:text-[40px]">
          Right now <span className="highlight-marker">at TeslaPool</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12 lg:gap-8">
        <article className="card card-hover relative flex flex-col p-6 lg:col-span-5">
          <div className="relative mb-6 flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border-subtle bg-cream p-4">
            <NewsArtwork art={feature.art} large />
          </div>
          <div className="mb-3 flex items-center justify-between text-[11px] font-medium text-muted">
            <span className="badge-tag px-2.5 py-0.5 text-[10px] font-bold tracking-wider">{feature.category}</span>
            <time dateTime={feature.date} className="text-xs">
              {formatNewsDate(feature.date)}
            </time>
          </div>
          <h3 className="text-base font-bold leading-snug text-dark">
            <Link href={`/news/${feature.slug}`} className="after:absolute after:inset-0 after:rounded-3xl after:content-['']">
              {feature.title}
            </Link>
          </h3>
        </article>

        <div className="flex flex-col justify-between gap-5 lg:col-span-7">
          {rest.map((n) => (
            <article key={n.slug} className="card card-hover relative flex items-center gap-4 p-4 sm:gap-5 sm:p-5">
              <div className="relative flex h-20 w-28 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border-subtle bg-white sm:h-24 sm:w-36">
                <NewsArtwork art={n.art} />
              </div>
              <div className="min-w-0 flex-grow pr-1">
                <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium text-muted">
                  <span className="badge-tag px-2 py-0.5 text-[10px] font-bold tracking-wider">{n.category}</span>
                  <time dateTime={n.date} className="text-xs">
                    {formatNewsDate(n.date)}
                  </time>
                </div>
                <h3 className="text-xs font-bold leading-snug text-dark sm:text-[13px]">
                  <Link href={`/news/${n.slug}`} className="after:absolute after:inset-0 after:rounded-3xl after:content-['']">
                    {n.title}
                  </Link>
                </h3>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
