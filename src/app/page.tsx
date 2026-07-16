import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import LandingPageContent from '@/components/landing/LandingPageContent';
import type { FunnelState } from '@/lib/funnel-cta';
import { PRODUCT_NAME } from '@/lib/brand';
import JsonLd from '@/components/seo/JsonLd';
import { SITE_DESCRIPTION, SITE_URL, absoluteUrl } from '@/lib/seo';

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: PRODUCT_NAME,
      url: SITE_URL,
      logo: absoluteUrl('/icon.png'),
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: PRODUCT_NAME,
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      name: PRODUCT_NAME,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '19',
        highPrice: '99',
        priceCurrency: 'USD',
        offerCount: 3,
        url: absoluteUrl('/pricing'),
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
      <JsonLd data={structuredData} />
      <LandingPageContent funnel={funnel} />
    </>
  );
}
