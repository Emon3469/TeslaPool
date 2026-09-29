import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewsArtwork } from '@/components/marketing/NewsArtwork';
import { ButtonLink } from '@/components/ui/Button';
import { findNews, formatNewsDate, NEWS } from '@/content/news';

export function generateStaticParams() {
  return NEWS.map((n) => ({ slug: n.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const item = findNews((await params).slug);
  return item ? { title: item.title, description: item.excerpt } : { title: 'Not found' };
}

export default async function NewsArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const item = findNews((await params).slug);
  if (!item) notFound();
  const more = NEWS.filter((n) => n.slug !== item.slug).slice(0, 2);

  return (
    <article className="container-page max-w-3xl py-12 md:py-16">
      <Link href="/news" className="mb-8 inline-flex items-center gap-1.5 rounded text-sm font-bold text-dark/70 hover:text-dark">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Newsroom
      </Link>
      <div className="mb-4 flex items-center gap-3 text-xs text-muted">
        <span className="badge-tag px-2.5 py-0.5 text-[10px] font-bold tracking-wider">{item.category}</span>
        <time dateTime={item.date}>{formatNewsDate(item.date, 'long')}</time>
      </div>
      <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">{item.title}</h1>
      <p className="mt-4 text-lg leading-relaxed text-dark/70">{item.excerpt}</p>
      <div className="my-10 flex aspect-[16/9] items-center justify-center overflow-hidden rounded-4xl border-subtle bg-white p-6 shadow-card">
        <NewsArtwork art={item.art} large />
      </div>
      <div className="space-y-6 text-base leading-relaxed text-dark/80">
        {item.body.map((b, i) => (
          <section key={i}>
            {b.heading && <h2 className="mb-2 text-xl font-black text-dark">{b.heading}</h2>}
            <p>{b.text}</p>
          </section>
        ))}
      </div>
      {item.cta && (
        <div className="mt-10">
          <ButtonLink href={item.cta.href} size="lg">
            {item.cta.label}
          </ButtonLink>
        </div>
      )}
      <aside className="mt-16 border-t border-dark/10 pt-10" aria-label="More news">
        <h2 className="mb-5 text-sm font-bold uppercase tracking-wider text-muted">Keep reading</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          {more.map((n) => (
            <Link key={n.slug} href={`/news/${n.slug}`} className="card card-hover block p-5">
              <span className="badge-tag mb-2 px-2 py-0.5 text-[10px] font-bold tracking-wider">{n.category}</span>
              <p className="font-bold leading-snug">{n.title}</p>
            </Link>
          ))}
        </div>
      </aside>
    </article>
  );
}
