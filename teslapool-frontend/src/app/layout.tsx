import type { Metadata, Viewport } from 'next';
import { Roboto } from 'next/font/google';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { Providers } from '@/components/Providers';
import './globals.css';

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700', '900'],
  variable: '--font-roboto',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'TeslaPool · Together, we make a greener Dhaka', template: '%s · TeslaPool' },
  description:
    'Pool an auto-rickshaw ("Tesla") across Dhaka. Explainable matching, an itemised fare for every passenger, and a seat guarantee that can never overbook.',
  applicationName: 'TeslaPool',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
  openGraph: { title: 'TeslaPool', description: 'Shared auto-rickshaw rides for Dhaka, with fares you can check by hand.', type: 'website' },
};

export const viewport: Viewport = {
  themeColor: '#C1F11D',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body className="min-h-screen overflow-x-hidden">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>
          <SiteHeader />
          <main id="main" tabIndex={-1} className="outline-none">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
