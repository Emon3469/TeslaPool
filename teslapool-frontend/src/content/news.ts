export type NewsArt = 'feature' | 'receipt' | 'crew' | 'seats';

export interface NewsItem {
  slug: string;
  category: 'PRODUCT' | 'PAYMENTS' | 'COMMUNITY' | 'ENGINEERING';
  date: string;
  title: string;
  excerpt: string;
  art: NewsArt;
  body: { heading?: string; text: string }[];
  cta?: { href: string; label: string };
}

/** Product updates. Each one describes behaviour that exists in the running system. */
export const NEWS: NewsItem[] = [
  {
    slug: 'pooled-teslas-across-dhaka',
    category: 'PRODUCT',
    date: '2026-09-26',
    title: 'Pooled Tesla rides now run across ten Dhaka zones, from Uttara to Motijheel',
    excerpt: 'Request a seat, see which pools fit your route and why, and join one in a tap. Nobody waits for a full vehicle.',
    art: 'feature',
    body: [
      {
        text: 'TeslaPool matches passengers heading the same way into one auto-rickshaw: a "Tesla", as Dhaka affectionately calls its green CNGs. You choose a pickup and drop-off zone and the number of seats; we show the pools that can take you, the route each would follow and what you would pay.',
      },
      {
        heading: 'Why a pool accepts you (or not)',
        text: 'Every pool option comes with the checks it passed: seats available, pickup nearby, destination compatible, stop limit respected, and detour within the limit for every passenger already on board. When a pool cannot take you, you see the exact reason, for example "Only 1 seat left, 2 requested".',
      },
      {
        heading: 'Coverage',
        text: 'Banani, Gulshan, Mohakhali, Uttara, Mirpur, Dhanmondi, Farmgate, Azimpur, Bashundhara R/A and Motijheel. Distances come from a published zone graph, so the same trip always gets the same estimate.',
      },
    ],
    cta: { href: '/ride/new', label: 'Book a ride' },
  },
  {
    slug: 'fares-you-can-check-by-hand',
    category: 'PAYMENTS',
    date: '2026-09-24',
    title: 'Fares you can check by hand: every ride now carries its own itemised breakdown',
    excerpt: 'Base + distance + time, frozen on your ride the moment you request it. Change the price list tomorrow and yesterday’s receipt still adds up.',
    art: 'receipt',
    body: [
      {
        text: 'Your standard fare is a base charge plus a per-kilometre and a per-minute charge, rounded to the poysha. The three lines always sum exactly to the total, and the breakdown is stored on the ride itself, so a later price change never rewrites your history.',
      },
      {
        heading: 'Pool discounts are personal',
        text: 'When you share, your discount depends on how much of your own trip is shared. Two passengers in the same Tesla can pay different, individually fair amounts. Your ride page shows the calculation line by line.',
      },
      {
        heading: 'Cash or TeslaPay',
        text: 'Pay the driver in cash, or from your TeslaPay wallet. TeslaPay settles automatically when the trip completes and can never take your balance below zero.',
      },
    ],
    cta: { href: '/how-it-works#calculator', label: 'Try the fare calculator' },
  },
  {
    slug: 'meet-the-pilot-crew',
    category: 'COMMUNITY',
    date: '2026-09-20',
    title: 'Meet the pilot crew: Jashim, his Tesla "Bullet", and the Banani commuters',
    excerpt: 'Our first pool: Nusrat to Mohakhali, Rafiq to Gulshan, and a lesson in why the last seat matters.',
    art: 'crew',
    body: [
      {
        text: 'Jashim Uddin drives Bullet, a three-seat auto-rickshaw registered DHAKA-METRO-TA-11-2233. On the pilot morning, Nusrat requested a seat from Banani to Mohakhali and Rafiq from Banani to Gulshan. Their routes overlapped, so they pooled, and each paid less than riding alone.',
      },
      {
        heading: 'Shirin and the last seat',
        text: 'Shirin asked for two seats in the same pool when only one remained. TeslaPool declined with a plain reason instead of squeezing her in, and she was free to match elsewhere. Capacity is a promise, not a suggestion.',
      },
    ],
    cta: { href: '/drive', label: 'Drive with TeslaPool' },
  },
  {
    slug: 'zero-overbookings',
    category: 'ENGINEERING',
    date: '2026-09-15',
    title: 'Zero overbookings: ten riders racing for one last seat, exactly one wins',
    excerpt: 'Seat allocation is protected twice: once by the booking transaction and again by the database itself.',
    art: 'seats',
    body: [
      {
        text: 'When several people tap "join" for the last seat at the same moment, only one can have it. TeslaPool locks the pool while it re-checks every rule on fresh data, and a database guard independently refuses any booking that would exceed the vehicle’s seats.',
      },
      {
        heading: 'Measured, not claimed',
        text: 'Our live impact page recounts every pool from raw bookings and reports capacity violations. The number is computed on request, not typed in.',
      },
    ],
    cta: { href: '/impact', label: 'See live impact' },
  },
];

export function findNews(slug: string) {
  return NEWS.find((n) => n.slug === slug) ?? null;
}

export function formatNewsDate(iso: string, style: 'short' | 'long' = 'short') {
  return new Intl.DateTimeFormat('en-GB', style === 'short' ? { month: 'long', day: '2-digit' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}
