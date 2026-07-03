import Nav from './editorial/Nav';
import Hero from './editorial/Hero';
import Problem from './editorial/Problem';
import Loop from './editorial/Loop';
import Voice from './editorial/Voice';
import Distribution from './editorial/Distribution';
import Week from './editorial/Week';
import Beta from './editorial/Beta';
import Footer from './editorial/Footer';
import type { FunnelState } from '@/lib/funnel-cta';

interface Props {
  funnel: FunnelState;
}

/** Marketing landing — nav → hero → problem → loop → voice → distribution → week → CTA → footer. */
export default function LandingPageContent({ funnel }: Props) {
  return (
    <main className="editorial relative min-h-screen overflow-x-hidden">
      <a
        href="#problem"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>
      <Nav funnel={funnel} />
      <Hero funnel={funnel} />
      <Problem />
      <Loop />
      <Voice />
      <Distribution />
      <Week />
      <Beta funnel={funnel} />
      <Footer />
    </main>
  );
}
