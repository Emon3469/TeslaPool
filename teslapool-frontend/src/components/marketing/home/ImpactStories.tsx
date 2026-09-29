'use client';

import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { Photo } from '@/components/ui/Photo';

export interface ImpactStory {
  photo: string;
  alt: string;
  stat: string;
  statLabel: string;
  tint: string;
  title: string;
  body: string;
  href: string;
}

export function ImpactStories({ stories }: { stories: ImpactStory[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    cards.forEach((c, i) => {
      if (Math.abs(c.offsetLeft + c.offsetWidth / 2 - center) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - center)) best = i;
    });
    setActive(best);
  }, []);

  useEffect(() => {
    const el = track.current;
    el?.addEventListener('scroll', onScroll, { passive: true });
    return () => el?.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  const goTo = (i: number) => {
    const card = track.current?.children[i] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  return (
    <section aria-labelledby="impact-title" className="bg-white">
      <div className="container-page py-16 md:py-20">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <span className="badge-tag mb-2">Impact</span>
            <h2 id="impact-title" className="text-3xl font-black tracking-tight text-dark">
              <span className="highlight-marker">Social impact</span> making a difference.
            </h2>
            <p className="mt-1.5 text-xs text-muted sm:text-sm">To keep ourselves honest, every number here is computed live from real trips.</p>
          </div>
          <ButtonLink href="/impact" size="sm" className="rounded-full px-5 py-2.5">
            See live impact
          </ButtonLink>
        </div>

        <div
          ref={track}
          className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0"
          aria-label="Impact stories"
        >
          {stories.map((s) => (
            <article key={s.title} className="card card-hover flex w-[82%] flex-shrink-0 snap-center flex-col justify-between p-5 md:w-auto">
              <div>
                <div className="relative mb-4 aspect-[4/3] w-full overflow-hidden rounded-2xl">
                  <Photo src={s.photo} alt={s.alt} className="h-full w-full" />
                  <div className="absolute bottom-3 left-3 rounded-md px-2.5 py-1 text-[10px] font-semibold text-white" style={{ backgroundColor: s.tint }}>
                    <span className="block text-sm font-bold leading-none">{s.stat}</span>
                    {s.statLabel}
                  </div>
                </div>
                <h3 className="mb-1 text-sm font-bold text-dark">{s.title}</h3>
                <p className="mb-4 text-xs leading-relaxed text-muted">{s.body}</p>
              </div>
              <Link href={s.href} className="group inline-flex w-fit items-center gap-1 rounded text-xs font-semibold text-dark hover:underline">
                Learn more <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 md:hidden">
          {stories.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show story ${i + 1} of ${stories.length}`}
              aria-current={i === active}
              className={clsx('rounded-full transition-all', i === active ? 'h-2 w-2 bg-brand ring-2 ring-brand/30' : 'h-1.5 w-1.5 bg-dark/20')}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
