import { SessionBoundary } from '@/components/app/SessionBoundary';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SessionBoundary>{children}</SessionBoundary>;
}
