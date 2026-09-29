'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="container-page flex flex-col items-center py-24 text-center">
      <p className="text-sm font-bold uppercase tracking-wider text-muted">Unexpected error</p>
      <h1 className="mt-2 text-4xl font-black tracking-tight">
        Something <span className="highlight-marker">went wrong</span>
      </h1>
      <p className="mt-3 max-w-md text-muted">Please try again. If it keeps happening, quote this reference to support.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">ref {error.digest}</p>}
      <div className="mt-8 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="outline">
          Back home
        </ButtonLink>
      </div>
    </section>
  );
}
