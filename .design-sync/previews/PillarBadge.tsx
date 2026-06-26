import { PillarBadge } from 'content-os';

// All six content pillars as labeled badges, the way they tag posts in the Library.
export function AllPillars() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: 420 }}>
      <PillarBadge pillar="hot-take" />
      <PillarBadge pillar="hackathon" />
      <PillarBadge pillar="founder" />
      <PillarBadge pillar="explainer" />
      <PillarBadge pillar="origin" />
      <PillarBadge pillar="research" />
    </div>
  );
}

// Label-less dots, used as compact pillar indicators in dense list rows.
export function DotsOnly() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <PillarBadge pillar="hot-take" showLabel={false} />
      <PillarBadge pillar="hackathon" showLabel={false} />
      <PillarBadge pillar="founder" showLabel={false} />
      <PillarBadge pillar="explainer" showLabel={false} />
      <PillarBadge pillar="origin" showLabel={false} />
      <PillarBadge pillar="research" showLabel={false} />
    </div>
  );
}
