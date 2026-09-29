import type { NextConfig } from 'next';

/**
 * The browser only ever talks to this origin. `/api/v1/*` is proxied to the TeslaPool API, so the
 * HttpOnly session cookie is first-party, no CORS is involved, and the backend URL stays server-side.
 */
const backend = (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

// Rewrites are baked in at build time. On a hosted build a missing BACKEND_URL would silently proxy to
// localhost and break every API call in production, so fail the build instead.
if ((process.env.VERCEL || process.env.CI) && !process.env.BACKEND_URL) {
  throw new Error('BACKEND_URL must be set at build time (e.g. https://teslapool-backend.onrender.com)');
}
if (!/^https?:\/\//.test(backend)) throw new Error(`BACKEND_URL must start with http:// or https:// (got "${backend}")`);

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${backend}/api/v1/:path*` },
      // Liveness / readiness live outside /api/v1 on the API; expose them for the system dashboard.
      { source: '/api/sys/health', destination: `${backend}/health` },
      { source: '/api/sys/ready', destination: `${backend}/health/ready` },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
