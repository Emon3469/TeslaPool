import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/LegalPage';

export const metadata: Metadata = { title: 'Terms of use' };

export default function TermsPage() {
  return (
    <LegalPage
      tag="Legal"
      title="Terms of use"
      updated="29 September 2026"
      sections={[
        { heading: 'What TeslaPool is', body: 'TeslaPool connects passengers with independent auto-rickshaw, rickshaw and bike drivers and groups passengers with compatible routes into shared rides.' },
        { heading: 'Fares', body: 'Each passenger is quoted a solo fare from the published formula before booking. The fare you pay never exceeds that quote, is locked when your trip starts, and is shown itemised on your ride.' },
        { heading: 'Seats and cancellations', body: 'Book only the seats you need. You may leave a pool before the driver arrives or cancel until pickup without charge. Rides are charged only when completed.' },
        { heading: 'TeslaPay', body: 'TeslaPay is a prepaid in-app balance. In this version top-ups are simulated and no real money moves. A TeslaPay payment never takes a balance below zero; if the balance is short at drop-off, the fare is collected in cash.' },
        { heading: 'Conduct', body: 'Treat co-riders and drivers with respect. Accounts that abuse the service, other users or drivers may be deactivated.' },
      ]}
    />
  );
}
