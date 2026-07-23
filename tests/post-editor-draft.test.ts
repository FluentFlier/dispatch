import { describe, expect, it } from 'vitest';
import {
  clearPostEditorDraft,
  formsMatch,
  postEditorDraftKey,
  readPostEditorDraft,
  writePostEditorDraft,
} from '@/components/library/post-editor-draft';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('post editor browser draft recovery', () => {
  it('round-trips a per-post draft and preserves multiline content', () => {
    const storage = new MemoryStorage();
    const form = { title: 'Draft', script: 'First line\n\nSecond line' };

    writePostEditorDraft(storage, 'post-1', form);

    expect(readPostEditorDraft(storage, 'post-1')?.form).toEqual(form);
    expect(readPostEditorDraft(storage, 'post-2')).toBeNull();
  });

  it('clears saved and malformed drafts safely', () => {
    const storage = new MemoryStorage();
    storage.setItem(postEditorDraftKey('post-1'), '{bad json');

    expect(readPostEditorDraft(storage, 'post-1')).toBeNull();
    expect(storage.getItem(postEditorDraftKey('post-1'))).toBeNull();

    writePostEditorDraft(storage, 'post-1', { script: 'work' });
    clearPostEditorDraft(storage, 'post-1');
    expect(readPostEditorDraft(storage, 'post-1')).toBeNull();
  });

  it('detects whether the current form differs from the last server save', () => {
    const saved = { script: 'Original', status: 'draft' };
    expect(formsMatch(saved, { ...saved })).toBe(true);
    expect(formsMatch(saved, { ...saved, script: 'Edited' })).toBe(false);
  });

  it('does not crash editing when browser storage is unavailable', () => {
    const unavailable = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    };

    expect(() => writePostEditorDraft(unavailable, 'post-1', { script: 'work' })).not.toThrow();
    expect(() => clearPostEditorDraft(unavailable, 'post-1')).not.toThrow();
  });
});
