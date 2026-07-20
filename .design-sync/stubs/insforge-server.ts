// Browser-safe stub for '@/lib/insforge/server', aliased in via
// .design-sync/tsconfig.json for the design-system bundle only.
// OnboardingPage imports its server actions file, which drags this
// server-only module (and node:crypto) into the browser bundle. Pages never
// actually call these in a preview - actions fire on user interaction against
// a live backend - so the stub only has to exist, not work.
export function getServiceClient(): never {
  throw new Error('insforge server client is unavailable in design previews');
}

export function getServerClient(): never {
  throw new Error('insforge server client is unavailable in design previews');
}

export async function getSessionUser(): Promise<{ id: string; email: string; name?: string } | null> {
  return null;
}

export type EffectiveUser = {
  id: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
};

export async function getAuthenticatedUser(): Promise<EffectiveUser | null> {
  return null;
}
