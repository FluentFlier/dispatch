import Nav from './editorial/Nav';
import Hero from './editorial/Hero';
import Problem from './editorial/Problem';
import Loop from './editorial/Loop';
import Voice from './editorial/Voice';
import Distribution from './editorial/Distribution';
import Week from './editorial/Week';
import Different from './editorial/Different';
import Icp from './editorial/Icp';
import Beta from './editorial/Beta';
import Footer from './editorial/Footer';

interface Props {
  loggedIn: boolean;
}

/**
 * Marketing landing — light Swiss-editorial theme. Composes the section-per-component
 * layout under a single `.editorial` scope so the light theme is isolated and the page
 * reads top-to-bottom: nav → hero → problem → loop → voice → distribution → week (the
 * one dark moment) → different → ICP → private beta → footer.
 */
export default function LandingPageContent({ loggedIn }: Props) {
  return (
    <main className="editorial relative min-h-screen overflow-x-hidden">
      <Nav loggedIn={loggedIn} />
      <Hero loggedIn={loggedIn} />
      <Problem />
      <Loop />
      <Voice />
      <Distribution />
      <Week />
      <Different />
      <Icp />
      <Beta />
      <Footer />
    </main>
  );
}
