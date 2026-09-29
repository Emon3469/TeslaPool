import type { Metadata } from 'next';
import { SessionBoundary } from '@/components/app/SessionBoundary';

export const metadata: Metadata = { title: { default: 'Ops console', template: '%s · TeslaPool' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SessionBoundary>{children}</SessionBoundary>;
}
