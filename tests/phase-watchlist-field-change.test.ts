import { describe, expect, it } from 'vitest';
import { detectFieldChanges, type ProfileState } from '@/lib/signals/profile/detect';

const base: ProfileState = {
  profileKey: 'acme-inc',
  fullName: 'Acme Inc',
  headline: 'We make anvils',
  description: 'Anvils for coyotes since 1949.',
};

describe('detectFieldChanges', () => {
  it('returns [] on first sight (no baseline)', () => {
    expect(detectFieldChanges(null, base, 'company')).toEqual([]);
  });

  it('detects company tagline (headline) change as field_change', () => {
    const current = { ...base, headline: 'We make rockets' };
    const out = detectFieldChanges(base, current, 'company');
    expect(out).toHaveLength(1);
    expect(out[0].signalType).toBe('field_change');
    expect(out[0].dedupeKey).toBe('field_change|headline|acme-inc|we make rockets');
    expect(out[0].signalSummary).toContain('We make anvils');
    expect(out[0].signalSummary).toContain('We make rockets');
  });

  it('detects description change as field_change', () => {
    const current = { ...base, description: 'Now also rockets.' };
    const out = detectFieldChanges(base, current, 'company');
    expect(out).toHaveLength(1);
    expect(out[0].dedupeKey).toBe('field_change|description|acme-inc|now also rockets.');
  });

  it('person headline change stays role_change (delegates)', () => {
    const prev: ProfileState = { profileKey: 'jane-doe', fullName: 'Jane Doe', headline: 'CTO at Acme' };
    const current = { ...prev, headline: 'VP Eng at Rocket Co' };
    const out = detectFieldChanges(prev, current, 'person');
    expect(out).toHaveLength(1);
    expect(out[0].signalType).toBe('role_change');
  });

  it('empty new value never fires (failed fetch must not fabricate)', () => {
    const current = { ...base, description: '' };
    expect(detectFieldChanges(base, current, 'company')).toEqual([]);
  });

  it('multiple fields changed -> one signal per field', () => {
    const current = { ...base, headline: 'We make rockets', description: 'Rockets only.' };
    expect(detectFieldChanges(base, current, 'company')).toHaveLength(2);
  });
});
