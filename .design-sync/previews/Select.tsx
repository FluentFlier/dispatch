import { Select } from 'content-os';

const labelStyle = {
  fontFamily: 'DM Sans, system-ui, sans-serif',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
  display: 'block',
  opacity: 0.8,
};

// Platform picker for where a post will publish.
export function Platform() {
  return (
    <div style={{ maxWidth: 240 }}>
      <label style={labelStyle}>Publish to</label>
      <Select defaultValue="linkedin">
        <option value="x">X / Twitter</option>
        <option value="linkedin">LinkedIn</option>
        <option value="instagram">Instagram</option>
        <option value="threads">Threads</option>
      </Select>
    </div>
  );
}

// Content pillar selector used when drafting.
export function Pillar() {
  return (
    <div style={{ maxWidth: 240 }}>
      <label style={labelStyle}>Content pillar</label>
      <Select defaultValue="howto">
        <option value="story">Founder Story</option>
        <option value="howto">How-To</option>
        <option value="hottake">Hot Take</option>
        <option value="casestudy">Case Study</option>
      </Select>
    </div>
  );
}
