/**
 * Public demo logins for reviewers, shown on the login page. They must match the API's seed
 * (SEED_PASSENGER_PASSWORD / SEED_DRIVER_PASSWORD / SEED_ADMIN_PASSWORD, README "Demo accounts").
 * Set NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false to hide them on a non-demo deployment.
 */
const PASSENGER = 'Passenger@2026';
const DRIVER = 'Driver@2026';
const ADMIN = 'Admin@2026';

const ALL = [
  { name: 'Nusrat Jahan', role: 'passenger', email: 'nusrat@teslapool.dev', password: PASSENGER },
  { name: 'Rafiq Islam', role: 'passenger', email: 'rafiq@teslapool.dev', password: PASSENGER },
  { name: 'Arif Hossain', role: 'passenger', email: 'arif@teslapool.dev', password: PASSENGER },
  { name: 'Shirin Akter', role: 'passenger', email: 'shirin@teslapool.dev', password: PASSENGER },
  { name: 'Jashim Uddin', role: 'driver', email: 'jashim@teslapool.dev', password: DRIVER },
  { name: 'TeslaPool Ops', role: 'admin', email: 'ops@teslapool.dev', password: ADMIN },
] as const;

export const DEMO_ACCOUNTS = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === 'false' ? [] : ALL;
