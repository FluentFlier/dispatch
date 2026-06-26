import { CopyButton } from 'content-os';

// The standalone copy control, as it appears next to any copyable field.
export function Standalone() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <CopyButton text="Build in public for 90 days. Here's what actually moved the needle." />
    </div>
  );
}

// Copy button paired with a generated caption, the way it sits in the Generate view.
export function WithCaption() {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 460,
        padding: 12,
        borderRadius: 10,
      }}
      className="bg-bg-secondary border border-border"
    >
      <span
        style={{
          fontFamily: 'DM Sans, system-ui, sans-serif',
          fontSize: 14,
          lineHeight: 1.4,
          flex: 1,
        }}
        className="text-text-primary"
      >
        I shipped 12 features in a weekend hackathon. Only 2 mattered. Here's how I tell the difference now.
      </span>
      <CopyButton text="I shipped 12 features in a weekend hackathon. Only 2 mattered. Here's how I tell the difference now." />
    </div>
  );
}
