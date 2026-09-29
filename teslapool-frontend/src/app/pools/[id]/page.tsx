import type { Metadata } from 'next';
import { PoolView } from './PoolView';

export const metadata: Metadata = { title: 'Pool' };

export default async function PoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PoolView id={id} />;
}
