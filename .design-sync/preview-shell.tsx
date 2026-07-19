// Preview harness for full-page components synced to claude.ai/design.
// Pages assume the Next.js app-router context and a live /api backend;
// neither exists inside a static preview card. PreviewShell supplies a
// no-op router, an empty search-params/pathname context, the app's
// ToastProvider, and a fetch stub that answers same-origin /api requests
// with registered mock payloads (default: empty object) so pages render
// their real zero-data states instead of crashing.
//
// The fetch stub is installed lazily on first PreviewShell render - never
// at module load - so importing the design-system bundle in a real design
// leaves window.fetch untouched.
import React from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  PathnameContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ToastProvider } from '@/components/ui/Toast';

type MockPayload = unknown | ((url: string) => unknown);

const fetchMocks = new Map<string, MockPayload>();
let fetchPatched = false;

// Default mocks: endpoints whose consumers crash on a bare `{}` (unguarded
// property access). Each payload is the endpoint's real "nothing to show"
// shape so the page renders its genuine zero state.
fetchMocks.set('/api/loop/readiness', { complete: true });
fetchMocks.set('/api/voice-drift', {
  drifted: false,
  delta: 0,
  baselineFidelity: 0,
  currentFidelity: 0,
  message: 'Voice fidelity stable.',
});
fetchMocks.set('/api/engagement/inbox', { groups: [] });

/** Register a mock JSON payload for any /api URL containing `substring`. */
export function registerFetchMock(substring: string, payload: MockPayload) {
  fetchMocks.set(substring, payload);
}

function resolveMock(url: string): unknown {
  for (const [substring, payload] of fetchMocks) {
    if (url.includes(substring)) {
      return typeof payload === 'function' ? (payload as (u: string) => unknown)(url) : payload;
    }
  }
  return {};
}

function patchFetch() {
  if (fetchPatched || typeof window === 'undefined') return;
  fetchPatched = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const isApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
    if (!isApi) return realFetch(input as RequestInfo, init);
    return new Response(JSON.stringify(resolveMock(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

const noopRouter = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => Promise.resolve(),
  // Next 14 internals probe this on some code paths.
  fastRefresh: () => {},
} as never;

export function PreviewShell({
  children,
  pathname = '/dashboard',
  search = '',
  mocks,
}: {
  children: React.ReactNode;
  /** Pathname reported to usePathname() - set per page so nav state looks right. */
  pathname?: string;
  /** Query string reported to useSearchParams(). */
  search?: string;
  /** Per-preview fetch mocks: { '/api/leads': {...payload} }. */
  mocks?: Record<string, MockPayload>;
}) {
  patchFetch();
  if (mocks) {
    for (const [substring, payload] of Object.entries(mocks)) {
      if (!fetchMocks.has(substring)) fetchMocks.set(substring, payload);
    }
  }
  const searchParams = React.useMemo(
    () => new URLSearchParams(search) as never,
    [search],
  );
  return (
    <AppRouterContext.Provider value={noopRouter}>
      <PathnameContext.Provider value={pathname}>
        <SearchParamsContext.Provider value={searchParams}>
          <ToastProvider>{children}</ToastProvider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}
