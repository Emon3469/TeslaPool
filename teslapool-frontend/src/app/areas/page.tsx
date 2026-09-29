import type { Metadata } from 'next';
import { AreasExplorer } from '@/components/marketing/AreasExplorer';
import { PageHero } from '@/components/marketing/PageHero';
import { getMeta } from '@/lib/server';

export const metadata: Metadata = {
  title: 'Dhaka areas',
  description: 'The Dhaka areas TeslaPool serves, from Uttara to Motijheel, with coordinates and distances.',
};

export const revalidate = 300;

export default async function AreasPage() {
  const meta = await getMeta();
  return (
    <>
      <PageHero
        tag="Coverage"
        title="Ten Dhaka areas,"
        highlight="one shared ride."
        subtitle="Banani, Gulshan, Mohakhali, Uttara, Mirpur, Dhanmondi, Farmgate, Azimpur, Bashundhara and Motijheel. Pick one to see where it is and how far the rest are."
      />
      <section className="container-page py-12 md:py-16">
        {meta ? <AreasExplorer meta={meta} /> : <p className="rounded-2xl bg-red-50 p-5 text-sm text-red-700">Areas can’t be loaded because the API is unreachable. Please try again shortly.</p>}
      </section>
    </>
  );
}
