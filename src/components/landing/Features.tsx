import { PRODUCT_NAME } from './editorial/brand';

const FEATURES = [
  {
    title: 'Voice fingerprint',
    copy: 'Drafts are scored against your real posts and emails, not generic AI tone.',
    span: 'lg:col-span-2',
    tone: 'from-blue/8 to-white',
  },
  {
    title: 'One calendar',
    copy: 'Schedule LinkedIn and X from a single queue.',
    span: '',
    tone: 'from-teal/8 to-white',
  },
  {
    title: 'Engagement inbox',
    copy: "Reply in your voice. Flag what becomes next week's content.",
    span: '',
    tone: 'from-flame/8 to-white',
  },
  {
    title: 'Creator Brain',
    copy: 'Hooks, wins, and replies feed back into the next draft cycle.',
    span: 'lg:col-span-2',
    tone: 'from-paper2 to-white',
  },
] as const;

export default function Features() {
  return (
    <section id="product" className="scroll-mt-24">
      <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-10 sm:py-24">
        <div className="mb-10 max-w-2xl">
          <h2 className="m-0 text-[clamp(28px,4vw,44px)] font-semibold tracking-[-0.03em] text-ink">
            Not another caption generator.
          </h2>
          <p className="m-0 mt-4 text-[16px] leading-relaxed text-ink2">
            {PRODUCT_NAME} is built around your voice, your stories, and your publishing loop.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className={`rounded-2xl border border-hair bg-gradient-to-br ${feature.tone} p-6 ${feature.span}`}
            >
              <h3 className="m-0 text-[18px] font-semibold text-ink">{feature.title}</h3>
              <p className="m-0 mt-2 max-w-[36ch] text-[14px] leading-relaxed text-ink2">
                {feature.copy}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
