'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

const LINKS = [
  { href: '/deployments', label: 'Deployments' },
  { href: '/content', label: 'Content' },
  { href: '/sources', label: 'FTP Sources' },
] as const;

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <nav className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-wide text-white">Jarvis</span>
          <div className="flex items-center gap-1">
            {LINKS.map((link) => {
              const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors ' +
                    (active ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white')
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
        <button
          onClick={logout}
          disabled={loggingOut}
          className="rounded px-3 py-1.5 text-sm font-medium text-neutral-400 transition-colors hover:text-white disabled:opacity-60"
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </nav>
  );
}
