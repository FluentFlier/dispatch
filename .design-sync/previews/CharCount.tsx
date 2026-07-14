import { CharCount } from 'content-os';

function Row({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360, padding: 12, borderRadius: 10 }}
      className="bg-bg-secondary border border-border"
    >
      <span
        style={{ fontFamily: 'DM Sans, system-ui, sans-serif', fontSize: 13, lineHeight: 1.4 }}
        className="text-text-primary"
      >
        {caption}
      </span>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  );
}

// Well under the limit - neutral gray count.
export function UnderLimit() {
  const text = 'Shipped a new feature today. Quietly proud.';
  return (
    <Row caption={text}>
      <CharCount text={text} platform="twitter" />
    </Row>
  );
}

// Approaching the limit (~80%) - turns amber.
export function NearLimit() {
  const text =
    'Most founders think growth is a marketing problem. It is not. It is a retention problem dressed up as one, and once you really see that, everything about how you choose to spend your critical first 90 days completely changes for the better.';
  return (
    <Row caption={text}>
      <CharCount text={text} platform="twitter" />
    </Row>
  );
}

// Over the limit - red count.
export function OverLimit() {
  const text =
    'Hot take: your content calendar is killing your reach. Posting daily for the algorithm trains you to ship mediocre work on a schedule instead of one undeniable post a week that people actually remember, share, and quote back to you in DMs months later when it finally clicks for them too.';
  return (
    <Row caption={text}>
      <CharCount text={text} platform="twitter" />
    </Row>
  );
}
