import type { Metadata } from 'next';
import { PoolMatches } from './PoolMatches';

export const metadata: Metadata = { title: 'Pool matches' };

export default async function PoolMatchesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PoolMatches id={id} />;
}
