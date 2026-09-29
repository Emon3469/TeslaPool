import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = process.env.AUTH_COOKIE_NAME ?? 'tp_session';

/**
 * Fast path for signed-out visitors: app pages redirect to login before any HTML is sent.
 * This is only a UX gate. The API authorises every request, and pages still handle an expired
 * cookie (401) by sending the user back here.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/verify-email', '/passenger/:path*', '/ride/:path*', '/rides/:path*', '/pools/:path*', '/wallet/:path*', '/profile/:path*', '/driver/:path*', '/ops/:path*'],
};
