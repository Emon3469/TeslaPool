import clsx from 'clsx';

/** Mint header band used by inner pages; mirrors the home hero's type scale. */
export function PageHero({
  tag,
  title,
  highlight,
  after,
  subtitle,
  children,
  className,
}: {
  tag: string;
  title: string;
  highlight?: string;
  after?: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('bg-mint', className)}>
      <div className="container-page py-14 text-center md:py-20">
        <span className="badge-tag mb-4 bg-white/70 text-[11px] font-bold uppercase tracking-wider">{tag}</span>
        <h1 className="mx-auto max-w-3xl text-4xl font-black leading-[1.08] tracking-tight text-dark sm:text-5xl">
          {title} {highlight && <span className="highlight-marker">{highlight}</span>} {after}
        </h1>
        {subtitle && <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-dark/70 sm:text-base">{subtitle}</p>}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

export function SectionHeading({ id, tag, title, highlight, body, center = false }: { id?: string; tag?: string; title: string; highlight?: string; body?: string; center?: boolean }) {
  return (
    <div className={clsx('mb-8', center && 'text-center')}>
      {tag && <span className="badge-tag mb-2">{tag}</span>}
      <h2 id={id} className="text-3xl font-black tracking-tight text-dark">
        {title} {highlight && <span className="highlight-marker">{highlight}</span>}
      </h2>
      {body && <p className={clsx('mt-2 max-w-2xl text-sm leading-relaxed text-muted', center && 'mx-auto')}>{body}</p>}
    </div>
  );
}

export function Faq({ items }: { items: { q: string; a: React.ReactNode }[] }) {
  return (
    <div className="divide-y divide-dark/10 rounded-3xl border-subtle bg-white shadow-card">
      {items.map((item) => (
        <details key={item.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-sm font-bold text-dark">
            {item.q}
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-chip text-lg leading-none transition group-open:rotate-45 group-open:bg-brand" aria-hidden="true">
              +
            </span>
          </summary>
          <div className="pt-3 text-sm leading-relaxed text-muted">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
