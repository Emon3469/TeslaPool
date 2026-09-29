/**
 * Navigate after the session changes (login, sign-up, email verified). A full page load is used on
 * purpose: Next.js may have prefetched signed-in pages while the visitor was signed out (e.g. footer
 * links), and a client-side navigation would reuse that cached "redirect to login" answer.
 */
export function goAfterAuth(path: string): void {
  window.location.assign(path);
}

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith('/login') || next.startsWith('/register')) return null;
  return next;
}
