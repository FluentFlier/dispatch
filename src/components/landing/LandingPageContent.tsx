'use client';

import type { FunnelState } from '@/lib/funnel-cta';
import QuietLanding from './quiet/QuietLanding';

interface Props {
  funnel: FunnelState;
}

export default function LandingPageContent({ funnel }: Props) {
  return <QuietLanding funnel={funnel} />;
}
