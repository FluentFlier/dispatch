import { Drawer, Button, Textarea } from 'content-os';

// The Drawer is a position:fixed right-side panel. The transformed, sized
// wrapper becomes its containing block so the full-height panel renders inside
// the preview card instead of escaping the viewport.
const stage: React.CSSProperties = {
  position: 'relative',
  height: 420,
  transform: 'translateZ(0)',
  overflow: 'hidden',
  borderRadius: 8,
};

export function PostEditor() {
  return (
    <div style={stage}>
      <Drawer open onClose={() => {}}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#171717' }}>Edit post</h3>
          <Textarea
            defaultValue={'5 hooks that stopped the scroll this week — and the one pattern they share.'}
            rows={5}
          />
          <Button size="sm">Save changes</Button>
        </div>
      </Drawer>
    </div>
  );
}
