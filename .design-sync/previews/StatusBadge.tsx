import { StatusBadge } from 'content-os';

// The content production pipeline: idea → scripted → filmed → edited → posted.
export function Pipeline() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <StatusBadge status="idea" />
      <StatusBadge status="scripted" />
      <StatusBadge status="filmed" />
      <StatusBadge status="edited" />
      <StatusBadge status="posted" />
    </div>
  );
}

export function InContext() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        maxWidth: 360,
      }}
    >
      <span style={{ fontFamily: 'DM Sans, system-ui, sans-serif', fontSize: 14, fontWeight: 500 }}>
        5 hooks that stopped the scroll
      </span>
      <StatusBadge status="posted" />
    </div>
  );
}
