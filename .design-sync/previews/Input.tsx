import { Input } from 'content-os';

const labelStyle = {
  fontFamily: 'DM Sans, system-ui, sans-serif',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
  display: 'block',
  opacity: 0.8,
};

// A labeled post-title field with a realistic default value.
export function PostTitle() {
  return (
    <div style={{ maxWidth: 320 }}>
      <label style={labelStyle}>Post title</label>
      <Input defaultValue="5 hooks that stopped the scroll" placeholder="Give your post a title" />
    </div>
  );
}

// A handle field, empty with placeholder to show the resting state.
export function Handle() {
  return (
    <div style={{ maxWidth: 320 }}>
      <label style={labelStyle}>Creator handle</label>
      <Input placeholder="@yourhandle" defaultValue="@buildinpublic" />
    </div>
  );
}

// A scheduling slug field showing a filled value.
export function ScheduleSlug() {
  return (
    <div style={{ maxWidth: 320 }}>
      <label style={labelStyle}>Campaign tag</label>
      <Input defaultValue="q3-launch-teaser" placeholder="campaign-slug" />
    </div>
  );
}
