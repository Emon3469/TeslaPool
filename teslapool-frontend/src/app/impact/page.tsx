import type { Metadata } from 'next';
import { ImpactDashboard } from '@/components/marketing/ImpactDashboard';
import { PageHero } from '@/components/marketing/PageHero';
import { getImpact } from '@/lib/server';

export const metadata: Metadata = {
  title: 'Live impact',
  description: 'Savings, seat utilisation, match rate and integrity checks, computed live from every TeslaPool trip.',
};

export const dynamic = 'force-dynamic';

export default async function ImpactPage() {
  const initial = await getImpact();
  return (
    <>
      <PageHero
        tag="Impact"
        title="Impact you can"
        highlight="audit, live."
        subtitle="No marketing numbers. Every figure below is computed from the database the moment you load it, including the checks that would reveal our own mistakes."
      />
      <section className="container-page py-14 md:py-16">
        <ImpactDashboard initial={initial} />
      </section>
    </>
  );
}
