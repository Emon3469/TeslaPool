import type { Metadata } from 'next';
import Link from 'next/link';
import { NewsArtwork } from '@/components/marketing/NewsArtwork';
import { PageHero } from '@/components/marketing/PageHero';
import { formatNewsDate, NEWS } from '@/content/news';

export const metadata: Metadata = {
  title: 'Newsroom',
  description: 'Product updates from TeslaPool.',
};

export default function NewsPage() {
  return (
    <>
      <PageHero tag="Newsroom" title="Right now" highlight="at TeslaPool" subtitle="What we shipped, what we learned, and what it means for your next ride." />
      <section className="container-page py-14 md:py-16">
        <div className="grid gap-6 sm:grid-cols-2">
          {NEWS.map((n) => (
            <article key={n.slug} className="card card-hover relative flex flex-col p-5">
              <div className="mb-5 flex aspect-[16/9] items-center justify-center overflow-hidden rounded-2xl border-subtle bg-cream p-3">
                <NewsArtwork art={n.art} large />
              </div>
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span className="badge-tag px-2.5 py-0.5 text-[10px] font-bold tracking-wider">{n.category}</span>
                <time dateTime={n.date}>{formatNewsDate(n.date, 'long')}</time>
              </div>
              <h2 className="text-lg font-bold leading-snug">
                <Link href={`/news/${n.slug}`} className="after:absolute after:inset-0 after:rounded-3xl after:content-['']">
                  {n.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{n.excerpt}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
