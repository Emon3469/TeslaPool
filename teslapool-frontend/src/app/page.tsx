import { Hero, type HeroMetric } from '@/components/marketing/home/Hero';
import { ImpactStories, type ImpactStory } from '@/components/marketing/home/ImpactStories';
import { Mission } from '@/components/marketing/home/Mission';
import { PromoBanner } from '@/components/marketing/home/PromoBanner';
import { RightNow } from '@/components/marketing/home/RightNow';
import { SafetyBanner } from '@/components/marketing/home/SafetyBanner';
import { Services } from '@/components/marketing/home/Services';
import { PHOTOS } from '@/content/media';
import { getImpact, getMeta } from '@/lib/server';

export const revalidate = 30;

export default async function HomePage() {
  const [meta, impact] = await Promise.all([getMeta(), getImpact()]);

  const metrics: HeroMetric[] = [
    { label: 'Dhaka zones', value: meta ? String(meta.zones.length) : '10' },
    { label: 'Max pool saving', value: meta ? `${meta.fare.maxPoolDiscountPercent}%` : '—' },
    { label: 'Overbookings', value: impact ? String(impact.integrity.capacityViolations) : '—', live: Boolean(impact) },
  ];

  const pooled = impact?.pooling.pooledPassengers;
  const discount = impact?.pooling.averageDiscountPercent;
  const stories: ImpactStory[] = [
    {
      photo: PHOTOS.students,
      alt: 'A group of young commuters smiling together',
      stat: pooled === undefined ? '—' : String(pooled),
      statLabel: 'Pooled riders',
      tint: 'rgba(74, 53, 117, 0.9)',
      title: 'Fewer engines, same journeys.',
      body: 'Every pooled passenger is one fewer solo trip idling in Dhaka traffic, and one more seat put to work.',
      href: '/impact',
    },
    {
      photo: PHOTOS.lecture,
      alt: 'Students listening in a lecture hall',
      stat: discount === null || discount === undefined ? '—' : `${Math.round(discount)}%`,
      statLabel: 'Avg. pool saving',
      tint: 'rgba(36, 53, 90, 0.9)',
      title: 'Fair fares you can check by hand.',
      body: 'Each rider’s discount is computed from their own shared distance, to the poysha, and shown line by line.',
      href: '/how-it-works#calculator',
    },
    {
      photo: PHOTOS.founders,
      alt: 'Three women smiling together',
      stat: impact ? String(impact.integrity.capacityViolations) : '—',
      statLabel: 'Overbookings',
      tint: 'rgba(76, 33, 64, 0.9)',
      title: 'A seat guarantee that holds.',
      body: 'Every pool is recounted from its raw bookings; capacity violations are measured live, never asserted.',
      href: '/safety#seat-guarantee',
    },
  ];

  return (
    <>
      <Hero metrics={metrics} />
      <Mission />
      <div className="bg-cream">
        <Services />
        <SafetyBanner />
      </div>
      <ImpactStories stories={stories} />
      <div className="bg-cream">
        <RightNow />
        <PromoBanner />
      </div>
    </>
  );
}
