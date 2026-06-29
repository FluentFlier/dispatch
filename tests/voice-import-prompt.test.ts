import { describe, expect, it } from 'vitest';
import { stripJsonFences } from '@/lib/voice-import-prompt';

describe('stripJsonFences', () => {
  it('removes json code fences', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('leaves plain json unchanged', () => {
    expect(stripJsonFences('{"voice_description":"casual"}')).toBe('{"voice_description":"casual"}');
  });
});
