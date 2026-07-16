import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { PRODUCT_NAME } from '@/lib/brand';

type HeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryCta?: string;
  secondaryCta?: string;
};

export function PublicHeader(): JSX.Element {
  return (
    <header className="border-b border-hair bg-paper/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="text-[15px] font-semibold text-ink">
          {PRODUCT_NAME}
        </Link>
        <div className="hidden items-center gap-6 text-sm text-ink2 sm:flex">
          <Link href="/features" className="hover:text-ink">
            Features
          </Link>
          <Link href="/use-cases" className="hover:text-ink">
            Use cases
          </Link>
          <Link href="/templates" className="hover:text-ink">
            Templates
          </Link>
          <Link href="/pricing" className="hover:text-ink">
            Pricing
          </Link>
        </div>
        <Link href="/get-started" className="btn-secondary min-h-10 px-4 text-sm">
          Start free trial
        </Link>
      </nav>
    </header>
  );
}

export function PublicHero({
  eyebrow,
  title,
  description,
  primaryCta = 'Start free trial',
  secondaryCta = 'Book a demo',
}: HeroProps): JSX.Element {
  return (
    <section className="border-b border-hair bg-paper2">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <p className="page-eyebrow">{eyebrow}</p>
          <h1 className="mt-4 max-w-4xl font-serif text-[clamp(38px,6vw,72px)] font-normal leading-[0.95] text-ink">
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-[18px] leading-8 text-ink2">{description}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/get-started" className="btn-primary">
              {primaryCta}
              <ArrowRight size={16} />
            </Link>
            <Link href="/book-demo" className="btn-secondary">
              {secondaryCta}
            </Link>
          </div>
        </div>
        <div className="grid gap-3 rounded-surface border border-hair bg-white p-4">
          {['Voice-aware drafts', 'LinkedIn and X publishing', 'Engagement replies', 'Performance learning loop'].map(
            (item) => (
              <div key={item} className="flex items-center gap-3 rounded-card border border-hair bg-paper px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-teal" />
                <span className="text-sm font-medium text-ink">{item}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

export function PublicFooter(): JSX.Element {
  return (
    <footer className="border-t border-hair bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-ink2 sm:flex-row sm:items-center sm:justify-between">
        <p>{PRODUCT_NAME}</p>
        <div className="flex gap-5">
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link href="/book-demo" className="hover:text-ink">
            Demo
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function PublicPage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <PublicHeader />
      <main>{children}</main>
      <PublicFooter />
    </div>
  );
}

export function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="mx-auto max-w-6xl px-5 py-14">
      <div className="max-w-2xl">
        <h2 className="font-serif text-[clamp(28px,4vw,44px)] font-normal leading-tight text-ink">{title}</h2>
        {intro && <p className="mt-4 text-[16px] leading-7 text-ink2">{intro}</p>}
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function FeatureGrid({
  items,
}: {
  items: Array<{ title: string; description: string }>;
}): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => (
        <article key={item.title} className="rounded-card border border-hair bg-white p-5">
          <h3 className="text-[18px] font-semibold text-ink">{item.title}</h3>
          <p className="mt-3 text-[14px] leading-6 text-ink2">{item.description}</p>
        </article>
      ))}
    </div>
  );
}
