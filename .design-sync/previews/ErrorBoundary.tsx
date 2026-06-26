import { ErrorBoundary } from 'content-os';

// A child that throws during render so the boundary's fallback UI is what the
// card shows — the only state of ErrorBoundary worth previewing.
function Boom(): React.ReactNode {
  throw new Error('Simulated render failure');
}

export function Fallback() {
  return (
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>
  );
}

export function Healthy() {
  return (
    <ErrorBoundary>
      <div style={{ fontFamily: 'DM Sans, system-ui, sans-serif', fontSize: 14, color: '#171717', padding: 8 }}>
        Dashboard loaded normally — no error to catch.
      </div>
    </ErrorBoundary>
  );
}
