import type { Metadata } from 'next';
import { DistanceMatrix, EngineRules, ModelStats, StateMachine } from '@/components/intelligence/EngineInsights';
import { PredictionLab } from '@/components/intelligence/PredictionLab';
import { SystemHealth } from '@/components/intelligence/SystemHealth';
import { PageHero, SectionHeading } from '@/components/marketing/PageHero';
import { ButtonLink } from '@/components/ui/Button';
import { getImpact, getMeta } from '@/lib/server';

export const metadata: Metadata = {
  title: 'Intelligence',
  description: 'System health, the live ETA and fare models with their guardrails, and the rules of the matching engine.',
};

export const dynamic = 'force-dynamic';

const SECTIONS = [
  ['health', 'System health'],
  ['lab', 'Prediction lab'],
  ['models', 'Models & matching'],
  ['engine', 'Engine rules'],
  ['zones', 'Zone graph'],
];

export default async function IntelligencePage() {
  const [meta, impact] = await Promise.all([getMeta(), getImpact()]);

  return (
    <>
      <PageHero
        tag="Intelligence"
        title="Under the hood,"
        highlight="in plain sight."
        subtitle="Live system health, the ETA and fare models with the guardrails that keep them honest, and the deterministic rules every match must pass."
      />

      <nav aria-label="On this page" className="sticky top-16 z-30 border-b border-dark/[0.06] bg-cream/90 backdrop-blur sm:top-[72px]">
        <div className="container-page no-scrollbar flex gap-1 overflow-x-auto py-2">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold text-dark/70 transition hover:bg-white hover:text-dark">
              {label}
            </a>
          ))}
        </div>
      </nav>

      <div className="container-page space-y-16 py-12 md:space-y-20 md:py-16">
        <section id="health" className="scroll-mt-36" aria-labelledby="health-h">
          <SectionHeading id="health-h" tag="Status" title="System" highlight="health" body="Liveness and readiness of the API, its database and the optional ML sidecar. If ML is down, rides still work on the deterministic fallback." />
          <SystemHealth />
        </section>

        {meta ? (
          <>
            <section id="lab" className="scroll-mt-36" aria-labelledby="lab-h">
              <SectionHeading id="lab-h"
                tag="ML"
                title="Prediction"
                highlight="lab"
                body="Run the exact ETA and fare pipeline a real ride uses. ML only estimates uncertain quantities; a guardrail decides whether its answer is allowed, and the published formula is always the fallback."
              />
              <PredictionLab meta={meta} />
            </section>

            <section id="models" className="scroll-mt-36" aria-labelledby="models-h">
              <SectionHeading id="models-h" tag="Live" title="Models &" highlight="matching" body="How often the models are trusted, and how the matcher performs under load, measured on this deployment." />
              <ModelStats initial={impact} />
              <div className="mt-4">
                <ButtonLink href="/impact" variant="outline" size="sm">
                  Full impact dashboard
                </ButtonLink>
              </div>
            </section>

            <section id="engine" className="scroll-mt-36 space-y-8" aria-labelledby="engine-h">
              <div>
                <SectionHeading id="engine-h" tag="Deterministic" title="Engine" highlight="rules" body="Matching is never decided by a model. These rules are checked for the new rider and for everyone already on board, inside a locked transaction." />
                <EngineRules meta={meta} />
              </div>
              <div>
                <h3 className="mb-3 text-lg font-black">Ride state machine</h3>
                <p className="mb-4 max-w-2xl text-sm text-muted">Every ride moves only along these arrows. Anything else is refused with a clear error and counted.</p>
                <StateMachine meta={meta} />
              </div>
            </section>

            <section id="zones" className="scroll-mt-36" aria-labelledby="zones-h">
              <SectionHeading id="zones-h" tag="Geography" title="Zone" highlight="graph" body="Distances between the ten service areas, in km. The same table prices every ride, so identical trips always get identical quotes." />
              <DistanceMatrix meta={meta} />
              <div className="mt-4">
                <ButtonLink href="/areas" variant="outline" size="sm">
                  Explore the areas on a map
                </ButtonLink>
              </div>
            </section>
          </>
        ) : (
          <p className="rounded-2xl bg-red-50 p-5 text-sm text-red-700">The API is unreachable, so model and engine details can’t be shown right now. System health above updates automatically.</p>
        )}
      </div>
    </>
  );
}
