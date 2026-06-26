import { Button } from 'content-os';

export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant="primary">Generate hooks</Button>
      <Button variant="secondary">Save draft</Button>
      <Button variant="ghost">Cancel</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Publish now</Button>
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button loading>Publishing</Button>
      <Button disabled>Disabled</Button>
      <Button variant="secondary" disabled>
        Unavailable
      </Button>
    </div>
  );
}
