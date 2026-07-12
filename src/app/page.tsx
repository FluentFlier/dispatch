import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import LandingPageContent from '@/components/landing/LandingPageContent';
import type { FunnelState } from '@/lib/funnel-cta';
import { PRODUCT_NAME } from '@/lib/brand';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://contentos.us';

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${BASE_URL}/#organization`,
      name: PRODUCT_NAME,
      url: BASE_URL,
      logo: `${BASE_URL}/icon.png`,
    },
    {
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      name: PRODUCT_NAME,
      url: BASE_URL,
      publisher: { '@id': `${BASE_URL}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      name: PRODUCT_NAME,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: BASE_URL,
      description:
        'Create in your voice, publish to LinkedIn and X, reply faster, and turn the response into what you do next.',
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '19',
        highPrice: '99',
        priceCurrency: 'USD',
        offerCount: 3,
        url: `${BASE_URL}/pricing`,
      },
    },
  ],
};

export default async function LandingPage() {
  const user = await getAuthenticatedUser();
  const loggedIn = Boolean(user);

  let onboardingComplete = false;
  let sub: FunnelState['sub'] = null;

  if (user) {
    const client = getServerClient();
    const [profileRes, subscription] = await Promise.all([
      client.database
        .from('creator_profile')
        .select('onboarding_complete')
        .eq('user_id', user.id)
        .maybeSingle(),
      getOrCreateSubscription(user.id),
    ]);
    onboardingComplete = Boolean(profileRes.data?.onboarding_complete);
    sub = subscription;
  }

  const funnel: FunnelState = { loggedIn, onboardingComplete, sub };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <LandingPageContent funnel={funnel} />
    </>
  );
}
