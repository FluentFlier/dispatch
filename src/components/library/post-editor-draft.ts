const DRAFT_VERSION = 1;
const DRAFT_PREFIX = 'content-os:post-editor-draft:';

export interface PostEditorDraft<T> {
  version: typeof DRAFT_VERSION;
  postId: string;
  savedAt: string;
  form: T;
}

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function postEditorDraftKey(postId: string): string {
  return `${DRAFT_PREFIX}${postId}`;
}

export function readPostEditorDraft<T>(storage: DraftStorage, postId: string): PostEditorDraft<T> | null {
  try {
    const raw = storage.getItem(postEditorDraftKey(postId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PostEditorDraft<T>>;
    if (
      parsed.version !== DRAFT_VERSION ||
      parsed.postId !== postId ||
      typeof parsed.savedAt !== 'string' ||
      !parsed.form ||
      typeof parsed.form !== 'object'
    ) {
      storage.removeItem(postEditorDraftKey(postId));
      return null;
    }
    return parsed as PostEditorDraft<T>;
  } catch {
    // A corrupt or unavailable localStorage entry should never stop the editor.
    try {
      storage.removeItem(postEditorDraftKey(postId));
    } catch {}
    return null;
  }
}

export function writePostEditorDraft<T>(storage: DraftStorage, postId: string, form: T): void {
  const draft: PostEditorDraft<T> = {
    version: DRAFT_VERSION,
    postId,
    savedAt: new Date().toISOString(),
    form,
  };
  try {
    storage.setItem(postEditorDraftKey(postId), JSON.stringify(draft));
  } catch {
    // Storage can be unavailable (privacy mode) or full. Server autosave and
    // close protection should continue to work even without local recovery.
  }
}

export function clearPostEditorDraft(storage: DraftStorage, postId: string): void {
  try {
    storage.removeItem(postEditorDraftKey(postId));
  } catch {}
}

export function formsMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
