'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getInsforgeClient } from '@/lib/insforge/client';
import { primaryNav, moreNav } from '@/lib/nav-config';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userLabel, setUserLabel] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const client = getInsforgeClient();
        const { data } = await client.auth.getCurrentUser();
        if (!data?.user) return;
        const { data: profile } = await client.database
          .from('creator_profile')
          .select('display_name')
          .eq('user_id', data.user.id)
          .single();
        setUserLabel(profile?.display_name || data.user.email || '');
      } catch {
        /* optional */
      }
    })();
  }, []);

  const handleSignOut = async () => {
    await getInsforgeClient().auth.signOut();
    router.push('/login');
  };

  return (
    <aside className="hidden md:flex md:flex-col fixed left-0 top-0 bottom-0 w-[240px] h-screen z-40 bg-bg-secondary border-r border-border">
      <div className="px-5 pt-6 pb-4">
        <p className="text-xs font-semibold tracking-wide text-accent-primary uppercase">
          Dispatch
        </p>
        {userLabel && (
          <p className="text-sm text-text-secondary mt-2 truncate">Hi, {userLabel.split(' ')[0]}</p>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {primaryNav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center min-h-[44px] px-4 rounded-md text-[15px] font-medium transition-colors ${
                active
                  ? 'bg-coral-light text-accent-primary'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4 border-t border-border pt-4 mx-3">
        <p className="px-4 mb-2 text-xs font-medium text-text-tertiary uppercase tracking-wide">
          More
        </p>
        {moreNav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center min-h-[40px] px-4 rounded-md text-sm transition-colors ${
                active ? 'text-accent-primary font-medium' : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {item.name}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-3 w-full text-left px-4 py-2 text-sm text-text-tertiary hover:text-text-secondary min-h-[40px]"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
