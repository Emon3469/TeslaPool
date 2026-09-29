import type { Metadata } from 'next';
import { RideDetail } from './RideDetail';

export const metadata: Metadata = { title: 'Your ride' };

export default async function RidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RideDetail id={id} />;
}
