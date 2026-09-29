import { AutoRickshaw } from '@/components/illustrations';
import { ButtonLink } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <section className="container-page flex flex-col items-center py-20 text-center">
      <svg viewBox="0 0 300 170" className="w-64" aria-hidden="true">
        <line x1="0" y1="152" x2="300" y2="152" stroke="#151515" strokeWidth="1.5" strokeDasharray="8 6" />
        <AutoRickshaw x={44} y={5} withRiders={false} />
      </svg>
      <p className="mt-6 text-sm font-bold uppercase tracking-wider text-muted">404</p>
      <h1 className="mt-2 text-4xl font-black tracking-tight">
        This stop is <span className="highlight-marker">not on the route</span>
      </h1>
      <p className="mt-3 max-w-md text-muted">The page you asked for doesn’t exist or has moved.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/">Back home</ButtonLink>
        <ButtonLink href="/ride/new" variant="outline">
          Book a ride
        </ButtonLink>
      </div>
    </section>
  );
}
