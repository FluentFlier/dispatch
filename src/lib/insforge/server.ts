import { createClient } from '@insforge/sdk';
import { cookies } from 'next/headers';
import { isProduction } from '@/lib/env';

/** Service-role client for cron/background jobs (no user cookie). */
export function getServiceClient(): ReturnType<typeof createClient> {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY?.trim();

  // In production the real service-role key is mandatory. Never silently fall
  // back to the public anon key: that would run cron/admin/webhook paths as an
  // anon user (RLS-blocked writes, broken billing) and conflate "service" with
  // a key that ships to the browser.
  if (isProduction() && !serviceKey) {
    throw new Error('INSFORGE_SERVICE_ROLE_KEY is required in production');
  }

  const key = serviceKey ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing InsForge env vars for service client');
  }

  return createClient({
    baseUrl: url,
    anonKey: key,
    isServerMode: true,
  });
}

export function getServerClient(): ReturnType<typeof createClient> {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing InsForge env vars');
  }

  const cookieStore = cookies();
  const token = cookieStore.get('content-os-token')?.value;

  return createClient({
    baseUrl: url,
    anonKey,
    isServerMode: true,
    edgeFunctionToken: token,
  });
}

export async function getAuthenticatedUser(): Promise<{ id: string; email: string } | null> {
  try {
    const client = getServerClient();
    const { data } = await client.auth.getCurrentUser();
    if (!data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? '' };
  } catch {
    return null;
  }
}
