import { Textarea } from 'content-os';

const labelStyle = {
  fontFamily: 'DM Sans, system-ui, sans-serif',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
  display: 'block',
  opacity: 0.8,
};

// A caption editor pre-filled with a realistic social caption.
export function Caption() {
  return (
    <div style={{ maxWidth: 360 }}>
      <label style={labelStyle}>Caption</label>
      <Textarea
        rows={4}
        defaultValue={
          "Most creators quit at 30 days.\n\nThe ones who win treat the first 100 posts as research, not performance.\n\nHere are the 3 hooks I reused the most 👇"
        }
        placeholder="Write your caption..."
      />
    </div>
  );
}

// A short-form video script field.
export function Script() {
  return (
    <div style={{ maxWidth: 360 }}>
      <label style={labelStyle}>Video script</label>
      <Textarea
        rows={4}
        defaultValue={
          "Hook: Stop posting daily.\nBeat 1: Volume without a system burns you out.\nBeat 2: Batch one pillar per week instead.\nCTA: Save this for your next content sprint."
        }
        placeholder="Draft your script..."
      />
    </div>
  );
}
