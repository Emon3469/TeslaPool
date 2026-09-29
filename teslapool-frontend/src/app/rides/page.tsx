'use client';

import { Suspense } from 'react';
import { AppPage } from '@/components/app/AppPage';
import { RideList } from '@/components/app/RideList';
import { ButtonLink } from '@/components/ui/Button';

export default function RidesPage() {
  return (
    <AppPage title="My rides" subtitle="Every trip, with its fare breakdown and permanent timeline." roles={['PASSENGER', 'ADMIN']} actions={<ButtonLink href="/ride/new">Book a ride</ButtonLink>}>
      {(user) => (
        <Suspense>
          <RideList emptyAction={user.role === 'PASSENGER'} />
        </Suspense>
      )}
    </AppPage>
  );
}
