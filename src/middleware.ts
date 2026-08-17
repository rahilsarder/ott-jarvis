import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token) : null;
  if (!payload) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Excludes /login, /api/auth/*, /api/content (dual-auth, checked in-route),
  // static assets, and Next internals.
  matcher: ['/((?!login|api/auth|api/content|_next/static|_next/image|favicon.ico).*)'],
};
