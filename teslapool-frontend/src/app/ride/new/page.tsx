import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BookRide } from './BookRide';

export const metadata: Metadata = { title: 'Request a ride' };

export default function BookRidePage() {
  return (
    <Suspense>
      <BookRide />
    </Suspense>
  );
}
