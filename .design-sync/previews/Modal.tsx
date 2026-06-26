import { Modal, Button } from 'content-os';

// The Modal renders a position:fixed full-screen overlay. The transformed,
// sized wrapper becomes its containing block so the centered dialog renders
// fully inside the preview card instead of escaping the viewport.
const stage: React.CSSProperties = {
  position: 'relative',
  height: 340,
  transform: 'translateZ(0)',
  overflow: 'hidden',
  borderRadius: 8,
};

export function Confirm() {
  return (
    <div style={stage}>
      <Modal open title="Publish to LinkedIn?" onClose={() => {}}>
        <p style={{ fontFamily: 'DM Sans, system-ui, sans-serif', fontSize: 14, color: '#525252', margin: 0, lineHeight: 1.5 }}>
          This post will go live immediately on your connected LinkedIn account. You can still edit
          or delete it afterward.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm">
            Cancel
          </Button>
          <Button size="sm">Publish now</Button>
        </div>
      </Modal>
    </div>
  );
}
