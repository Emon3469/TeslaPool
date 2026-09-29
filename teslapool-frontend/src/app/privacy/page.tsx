import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/LegalPage';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <LegalPage
      tag="Legal"
      title="Privacy"
      updated="29 September 2026"
      sections={[
        { heading: 'What we store', body: 'Your name, email, optional phone number, your ride requests (zones, seats, times), fares, payments and a history of each ride’s status changes.' },
        { heading: 'What co-riders see', body: 'Only your first name, the number of seats you booked, and your pickup and drop-off zones. Never your email, phone, fare or ride identifiers.' },
        { heading: 'What drivers see', body: 'The first name, seats and zones of passengers in their pool or waiting for a compatible pool, so they can plan stops.' },
        { heading: 'Sessions', body: 'You stay signed in with a secure, HttpOnly cookie that scripts on the page cannot read. Logging out clears it.' },
        { heading: 'Ride history', body: 'Ride timelines are append-only so that any fare or decision can be explained later. They are used for support, safety and to compute the anonymous figures on our impact page.' },
      ]}
    />
  );
}
