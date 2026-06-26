import { Tabs } from 'content-os';

const TABS = [
  { id: 'hooks', label: 'Hooks' },
  { id: 'script', label: 'Script' },
  { id: 'caption', label: 'Caption' },
  { id: 'hashtags', label: 'Hashtags' },
];

const noop = () => {};

export function Underline() {
  return <Tabs tabs={TABS} activeTab="hooks" onChange={noop} />;
}

export function Pill() {
  return <Tabs tabs={TABS} activeTab="script" onChange={noop} variant="pill" />;
}
