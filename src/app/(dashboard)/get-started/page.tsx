import Link from 'next/link';
import { redirect } from 'next/navigation';
import StartTrialButton from '@/components/book-demo/StartTrialButton';
import SignOutButton from '@/components/auth/SignOutButton';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { getPostAuthPath } from '@/lib/auth-routing';
import { getCalendlyUrl, isCalendlyConfigured } from '@/lib/calendly';
import { PRODUCT_NAME } from '@/lib/brand';

/**
 * Post-login gate: start the 7-day trial first; onboarding call is optional.
 */
export default async function GetStartedPage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect('/login');
  }

  const client = getServerClient();
  const [profileRes, sub] = await Promise.all([
    client.database
      .from('creator_profile')
      .select('onboarding_complete')
      .eq('user_id', user.id)
      .maybeSingle(),
    getOrCreateSubscription(user.id),
  ]);

  const nextPath = getPostAuthPath(profileRes.data, sub);
  if (nextPath !== '/get-started') {
    redirect(nextPath);
  }

  const calendlyUrl = getCalendlyUrl();

  return (
    <div className="mx-auto max-w-lg px-4 py-10 md:py-16">
      <p className="section-label mb-3">{PRODUCT_NAME.toUpperCase()} · GET STARTED</p>
      <h1 className="page-title">Start your free trial</h1>
      <p className="page-subtitle">
        7 days of Starter access. No card. Set up your voice, then publish from one place.
      </p>

      <div className="card-surface mt-8">
        <StartTrialButton />
      </div>

      <p className="mt-6 text-center text-sm text-text-secondary">
        After the trial, plans from $19/mo.{' '}
        <Link href="/pricing" className="text-accent-primary hover:text-accent-dark font-medium">
          See pricing
        </Link>
      </p>

      {(isCalendlyConfigured() || calendlyUrl) && (
        <div className="mt-10 rounded-lg border border-dashed border-border px-4 py-4 text-center">
          <p className="text-sm text-text-secondary">
            Want a live walkthrough?{' '}
            {calendlyUrl ? (
              <a
                href={calendlyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-primary hover:text-accent-dark"
              >
                Book a setup call →
              </a>
            ) : (
              <span className="text-text-tertiary">Scheduling opens soon.</span>
            )}
          </p>
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <SignOutButton className="text-sm text-text-tertiary hover:text-text-primary" />
      </div>
    </div>
  );
}
