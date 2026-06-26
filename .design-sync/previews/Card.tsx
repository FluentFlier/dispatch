import { Card } from 'content-os';

// A KPI stat card from the analytics dashboard (elevated by default).
export function Stat() {
  return (
    <div style={{ maxWidth: 240 }}>
      <Card>
        <div style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
          <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>1,284</div>
          <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.7, marginTop: 4 }}>
            Saves this week
          </div>
        </div>
      </Card>
    </div>
  );
}

// A scheduled-post summary card with a heading and body line.
export function PostSummary() {
  return (
    <div style={{ maxWidth: 320 }}>
      <Card>
        <div style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            The 3 hooks I never stop using
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.75 }}>
            Scheduled for Thursday, 9:00 AM on LinkedIn and X.
          </div>
        </div>
      </Card>
    </div>
  );
}

// Same content without elevation, to show the shadow difference.
export function Flat() {
  return (
    <div style={{ maxWidth: 320 }}>
      <Card elevated={false}>
        <div style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            Draft caption
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.75 }}>
            No shadow — flat card used inside nested panels.
          </div>
        </div>
      </Card>
    </div>
  );
}
