'use client';

import { useEffect, useRef, useState } from 'react';
import {
  X, Image as ImageIcon, Link2, AtSign, Globe2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { getInitials, normalizeUrl } from '@/lib/compose-preview';
import { LinkedInPostPreview } from '@/components/generate/LinkedInPostPreview';
import type { Platform } from '@/lib/constants';

interface LinkedInComposerProps {
  open: boolean;
  onClose: () => void;
  initialText: string;
  platform: Platform;
  /** Called after a successful publish with the post URL if available. */
  onPublished?: (url?: string) => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads',
};

/**
 * LinkedIn-style compose + live preview step. Mirrors LinkedIn's posting UI
 * layout and functionality (editor on top, live feed-style preview below) so the
 * user sees exactly how their post will look before publishing - plus image,
 * link, and mention controls. Uses app theme colors, not LinkedIn's palette.
 */
export function LinkedInComposer({ open, onClose, initialText, platform, onPublished }: LinkedInComposerProps) {
  const { toast } = useToast();
  const [text, setText] = useState(initialText);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [name, setName] = useState('You');
  const [headline, setHeadline] = useState<string | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the draft each time the composer opens with new content.
  useEffect(() => {
    if (open) {
      setText(initialText);
      setImageUrl(null);
      setShowLinkInput(false);
    }
  }, [open, initialText]);

  // Pull the creator's name + headline for a realistic preview.
  useEffect(() => {
    if (!open) return;
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.profile?.displayName) setName(data.profile.displayName);
        if (data?.profile?.headline) setHeadline(data.profile.headline);
      })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const label = PLATFORM_LABELS[platform] ?? platform;
  const initials = getInitials(name);

  async function handleImageUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetchWithAuth('/api/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast((data as { error?: string }).error ?? 'Upload failed', 'error'); return; }
      setImageUrl((data as { url?: string }).url ?? null);
    } catch {
      toast('Image upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  /** Insert a snippet at the cursor (or append) and refocus. */
  function insertAtCursor(snippet: string) {
    const el = textareaRef.current;
    if (!el) { setText((t) => t + snippet); return; }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function addLink() {
    const withScheme = normalizeUrl(linkValue);
    if (!withScheme) { setShowLinkInput(false); return; }
    insertAtCursor(`\n${withScheme}\n`);
    setLinkValue('');
    setShowLinkInput(false);
  }

  async function handlePublish() {
    if (!text.trim()) return;
    setPublishing(true);
    try {
      const res = await fetchWithAuth('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, content: text, caption: text, imageUrl: imageUrl ?? undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { error?: string }).error ?? 'Publish failed';
        toast(res.status === 402 || res.status === 403 ? 'Publishing requires a paid plan.' : msg, 'error');
        return;
      }
      const url = (data as { url?: string; provider_url?: string }).url ?? (data as { provider_url?: string }).provider_url;
      toast(`Published to ${label}`);
      onPublished?.(url);
      onClose();
    } catch {
      toast('Publish failed', 'error');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-xl rounded-xl border border-hair bg-paper shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hair px-5 py-3">
          <h2 className="text-lg text-ink">Post to {label}</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink3 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Editor (drop an image anywhere here to attach) */}
        <div
          className={`px-5 pt-4 ${dragActive ? 'rounded-lg ring-2 ring-accent-primary ring-inset' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const f = Array.from(e.dataTransfer.files).find((file) => file.type.startsWith('image/'));
            if (f) void handleImageUpload(f);
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-primary text-sm font-semibold text-white">
              {initials}
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">{name}</p>
              <span className="inline-flex items-center gap-1 rounded-full border border-hair px-2 py-0.5 text-[11px] text-ink2">
                <Globe2 className="h-3 w-3" /> Anyone
              </span>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="mt-3 w-full resize-none bg-transparent font-body text-[15px] leading-relaxed text-ink placeholder:text-ink3 focus:outline-none"
            placeholder="What do you want to talk about?"
          />

          {imageUrl && (
            <div className="relative mt-2 overflow-hidden rounded-lg border border-hair">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Attachment" className="max-h-72 w-full object-cover" />
              <button
                onClick={() => setImageUrl(null)}
                className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
                aria-label="Remove image"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {showLinkInput && (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLink()}
                placeholder="Paste a URL"
                className="flex-1 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-ink focus:outline-none focus:border-border-hover"
              />
              <Button size="sm" variant="secondary" onClick={addLink}>Add</Button>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="mt-3 flex items-center gap-1 border-t border-hair px-4 py-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-ink2 hover:bg-paper2">
            <ImageIcon className="h-4 w-4" /> {uploading ? 'Uploading...' : 'Photo'}
            <input
              type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); e.target.value = ''; }}
            />
          </label>
          <button onClick={() => setShowLinkInput((s) => !s)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-ink2 hover:bg-paper2">
            <Link2 className="h-4 w-4" /> Link
          </button>
          <button onClick={() => insertAtCursor('@')} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-ink2 hover:bg-paper2">
            <AtSign className="h-4 w-4" /> Mention
          </button>
        </div>

        {/* Live preview */}
        <div className="border-t border-hair bg-paper2 px-5 py-4">
          <p className="mb-2 text-[11px] font-medium tracking-wide text-ink3">Preview</p>
          <LinkedInPostPreview name={name} headline={headline} text={text} imageUrl={imageUrl} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-hair px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handlePublish} loading={publishing} disabled={!text.trim()}>
            Post to {label}
          </Button>
        </div>
      </div>
    </div>
  );
}
