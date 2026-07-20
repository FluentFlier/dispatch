'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, AlertCircle, Check, Loader2, Settings } from 'lucide-react';
import Link from 'next/link';
import { isDashboardPlatform } from '@/lib/constants';

interface SocialAccount {
  id: string;
  platform: string;
  account_name: string | null;
  account_id: string | null;
  connected_at: string;
}

interface PublishResult {
  platform: string;
  success: boolean;
  url?: string;
  error?: string;
}

interface PublishPanelProps {
  postId: string;
  content: string;
  caption: string;
  onPublishSuccess?: () => void;
  /**
   * Tight single-row form for the editor's header, where publishing has to be
   * reachable without scrolling to the Schedule tab. Same publish call, minus
   * the character counters and the connect-accounts empty state.
   */
  compact?: boolean;
  /**
   * The platform this post is already live on - excluded from the targets, so
   * a published LinkedIn post is never offered back to LinkedIn.
   */
  publishedTo?: string | null;
}

const PLATFORM_CONFIG: Record<string, { label: string; color: string; charLimit: number; icon: string }> = {
  twitter: { label: 'X', color: '#E7E5E4', charLimit: 280, icon: '𝕏' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', charLimit: 3000, icon: 'in' },
};

export default function PublishPanel({ postId, content, caption, onPublishSuccess, compact = false, publishedTo = null }: PublishPanelProps) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, PublishResult>>({});

  useEffect(() => {
    fetchAccounts();
  }, []);

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/social-accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  async function handlePublish(platform: string) {
    setPublishing((prev) => ({ ...prev, [platform]: true }));
    setResults((prev) => {
      const next = { ...prev };
      delete next[platform];
      return next;
    });

    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          platform,
          content,
          caption,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setResults((prev) => ({
          ...prev,
          [platform]: { platform, success: true, url: data.url },
        }));
        onPublishSuccess?.();
      } else {
        setResults((prev) => ({
          ...prev,
          [platform]: { platform, success: false, error: data.error ?? 'Publishing failed' },
        }));
      }
    } catch {
      setResults((prev) => ({
        ...prev,
        [platform]: { platform, success: false, error: 'Network error. Try again.' },
      }));
    } finally {
      setPublishing((prev) => ({ ...prev, [platform]: false }));
    }
  }

  const publishText = caption || content;

  const visibleAccounts = accounts.filter(
    (a) => isDashboardPlatform(a.platform) && a.platform !== publishedTo,
  );

  if (compact) {
    if (loading || visibleAccounts.length === 0) return null;
    return (
      <div className="flex items-center gap-1.5">
        {visibleAccounts.map((account) => {
          const config = PLATFORM_CONFIG[account.platform];
          if (!config) return null;
          const result = results[account.platform];
          const isPublishing = publishing[account.platform];
          const overLimit = publishText.length > config.charLimit;
          return (
            <button
              key={account.id}
              type="button"
              disabled={isPublishing || result?.success || overLimit || !publishText.trim()}
              onClick={() => handlePublish(account.platform)}
              title={
                overLimit
                  ? `Too long for ${config.label} (${publishText.length}/${config.charLimit})`
                  : `Publish to ${config.label}`
              }
              className="flex min-h-[36px] items-center gap-1.5 rounded-md bg-accent-primary px-3 text-[12px] font-medium text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isPublishing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : result?.success ? (
                <Check size={12} />
              ) : null}
              {result?.success ? 'Posted' : `Publish to ${config.label}`}
            </button>
          );
        })}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 size={14} className="animate-spin text-text-secondary" />
        <span className="text-[11px] text-text-secondary">Loading accounts...</span>
      </div>
    );
  }

  if (visibleAccounts.length === 0 && publishedTo) {
    return (
      <p className="py-2 text-[11px] text-text-secondary">
        This post is already live on {PLATFORM_CONFIG[publishedTo]?.label ?? publishedTo}. Connect
        another account to cross-post it.
      </p>
    );
  }

  if (visibleAccounts.length === 0) {
    return (
      <div className="py-2">
        <p className="text-[11px] text-text-secondary mb-2">No accounts connected.</p>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-[11px] text-accent-primary hover:opacity-80 transition-opacity"
        >
          <Settings size={12} /> Connect accounts in Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {visibleAccounts.map((account) => {
        const config = PLATFORM_CONFIG[account.platform];
        if (!config) return null;

        const charCount = publishText.length;
        const overLimit = charCount > config.charLimit;
        const result = results[account.platform];
        const isPublishing = publishing[account.platform];

        return (
          <div key={account.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              {/* Platform button */}
              <button
                type="button"
                disabled={isPublishing || result?.success}
                onClick={() => handlePublish(account.platform)}
                className="flex-1 flex items-center gap-2 px-3 py-2 text-[11px] bg-bg-tertiary border border-border rounded-md hover:border-border-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span
                  className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                  style={{ backgroundColor: config.color }}
                >
                  {config.icon}
                </span>

                {isPublishing ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    <span className="text-text-tertiary">Posting...</span>
                  </>
                ) : result?.success ? (
                  <>
                    <Check size={12} className="text-[#3B6D11]" />
                    <span className="text-[#3B6D11]">Posted to {config.label}</span>
                  </>
                ) : (
                  <span className="text-text-primary">Post to {config.label}</span>
                )}

                {account.account_name && (
                  <span className="ml-auto text-[10px] text-text-secondary">{account.account_name}</span>
                )}
              </button>
            </div>

            {/* Character count */}
            <div className="flex items-center gap-1 px-1">
              {overLimit ? (
                <>
                  <AlertCircle size={10} className="text-accent-primary" />
                  <span className="text-[10px] text-accent-primary">
                    {charCount}/{config.charLimit} characters (over limit)
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-text-secondary">
                  {charCount}/{config.charLimit} characters
                </span>
              )}
            </div>

            {/* Success link */}
            {result?.success && result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-1 text-[10px] text-accent-primary hover:underline"
              >
                <ExternalLink size={10} /> View post
              </a>
            )}

            {/* Error message */}
            {result && !result.success && (
              <p className="px-1 text-[10px] text-accent-primary">{result.error}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
