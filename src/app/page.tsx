import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import LandingPageContent from '@/components/landing/LandingPageContent';
import Image from 'next/image';
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
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[60]" aria-label="By Ada">
          <div className="mx-auto flex h-[72px] max-w-[1240px] items-center px-5 sm:px-8">
            <div className="ml-[104px] border-l border-ink/20 pl-2.5 sm:ml-[108px] sm:pl-3">
              <Image
                src="/brand-assets/by-ada/by-ada-lockup.svg"
                alt="by Ada"
                width={212}
                height={51}
                className="h-auto w-[62px] sm:w-[72px]"
              />
            </div>
          </div>
        </div>
        <LandingPageContent funnel={funnel} />
      </div>
    </>
  );
}
