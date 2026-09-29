import { PageHero } from './PageHero';

export function LegalPage({ tag, title, updated, sections }: { tag: string; title: string; updated: string; sections: { heading: string; body: string }[] }) {
  return (
    <>
      <PageHero tag={tag} title={title} subtitle={`Last updated ${updated}`} />
      <div className="container-page max-w-3xl py-14">
        <div className="card space-y-8 p-6 sm:p-10">
          {sections.map((s, i) => (
            <section key={s.heading}>
              <h2 className="text-lg font-black">
                {i + 1}. {s.heading}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-dark/75">{s.body}</p>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
