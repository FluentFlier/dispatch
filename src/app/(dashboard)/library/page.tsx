'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Grid3X3, List, Plus, Search, Trash2, ChevronDown, RefreshCw } from 'lucide-react';
import type { Post, Series } from '@/lib/types';
import type { Platform, Status } from '@/lib/constants';
import { PLATFORM_LABELS, DASHBOARD_PLATFORMS, STATUSES, STATUS_LABELS } from '@/lib/constants';
import { getInsforgeClient } from '@/lib/insforge/client';
import { usePillars } from '@/hooks/usePillars';
import { postPillars } from '@/lib/pillars';
import PostGrid from '@/components/library/PostGrid';
import PostTable from '@/components/library/PostTable';
import PostEditorDrawer from '@/components/library/PostEditorDrawer';
import { PageHeader } from '@/components/layout/PageHeader';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

export default function LibraryPage() {
  const { pillars: pillarList, getLabel } = usePillars();
  const [posts, setPosts] = useState<Post[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importing, setImporting] = useState<Platform | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const PAGE_SIZE = 50;

  // View
  const [view, setView] = useState<'card' | 'table'>('card');

  // Filters
  const [search, setSearch] = useState('');
  const [pillarFilter, setPillarFilter] = useState<string | 'all'>('all');
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [seriesFilter, setSeriesFilter] = useState<string | 'all'>('all');

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);

  // Editor drawer
  const [editorPost, setEditorPost] = useState<Post | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Posts load via /api/posts, which authenticates from the httpOnly session
      // cookie server-side. Do NOT gate this on the browser SDK's getCurrentUser():
      // right after the onboarding redirect the browser session can lag the cookie,
      // and the old early-return here left freshly imported posts invisible.
      const res = await fetchWithAuth(`/api/posts?page=1&limit=${PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json();
        setPosts((data.posts as Post[]) ?? []);
        setHasMore((data.posts?.length ?? 0) >= PAGE_SIZE);
        setPage(1);
      }

      // Best-effort: user id + series are browser-RLS scoped. If the browser
      // session isn't ready yet, skip them - posts above already rendered.
      const client = getInsforgeClient();
      const { data: userData } = await client.auth.getCurrentUser();
      const uid = userData?.user?.id;
      if (uid) {
        setUserId(uid);
        const { data: seriesData } = await client.database
          .from('series')
          .select('*')
          .eq('user_id', uid)
          .order('name', { ascending: true });
        setSeries((seriesData as Series[]) ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch library data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Deep-link: /library?post=<id> opens that post in the editor drawer.
  // Falls back to fetching the single post when it is not on the first page.
  useEffect(() => {
    if (loading) return;
    const postId = new URLSearchParams(window.location.search).get('post');
    if (!postId) return;
    const existing = posts.find((p) => p.id === postId);
    if (existing) {
      setEditorPost(existing);
      setEditorOpen(true);
      return;
    }
    let cancelled = false;
    fetchWithAuth(`/api/posts/${postId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = (d?.post ?? d) as Post | null;
        if (!cancelled && p?.id) {
          setEditorPost(p);
          setEditorOpen(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Run once after the initial load settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Posts after every filter EXCEPT platform - the tab bar counts + filters
  // operate on this so each tab shows how many posts it holds.
  const nonPlatformFiltered = useMemo(() => {
    let result = posts;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) => p.title.toLowerCase().includes(q) || (p.script && p.script.toLowerCase().includes(q))
      );
    }
    if (pillarFilter !== 'all') result = result.filter((p) => postPillars(p).includes(pillarFilter));
    if (statusFilter !== 'all') result = result.filter((p) => p.status === statusFilter);
    if (seriesFilter !== 'all') result = result.filter((p) => p.series_id === seriesFilter);
    return result;
  }, [posts, search, pillarFilter, statusFilter, seriesFilter]);

  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = { all: nonPlatformFiltered.length };
    for (const p of DASHBOARD_PLATFORMS) {
      counts[p] = nonPlatformFiltered.filter((post) => post.platform === p).length;
    }
    return counts;
  }, [nonPlatformFiltered]);

  const filtered = useMemo(
    () =>
      platformFilter === 'all'
        ? nonPlatformFiltered
        : nonPlatformFiltered.filter((p) => p.platform === platformFilter),
    [nonPlatformFiltered, platformFilter],
  );

  // Selection
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  };

  // Bulk actions
  const handleBulkDelete = async () => {
    // Server authenticates from the httpOnly cookie - don't gate on the browser
    // SDK's userId (it can lag), and use fetchWithAuth so a 401 refreshes+retries
    // instead of silently failing (the old plain fetch() left delete broken).
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} post(s)?`)) return;
    const ids = Array.from(selected);
    await Promise.all(
      ids.map((id) => fetchWithAuth(`/api/posts/${id}`, { method: 'DELETE' }))
    );
    setSelected(new Set());
    fetchData();
  };

  const handleBulkStatus = async (status: Status) => {
    if (!userId || selected.size === 0) return;
    const ids = Array.from(selected);
    await Promise.all(
      ids.map((id) =>
        fetchWithAuth(`/api/posts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
        })
      )
    );
    setSelected(new Set());
    fetchData();
  };

  // New post
  const handleNewPost = async () => {
    if (!userId) return;
    const res = await fetchWithAuth('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Untitled',
        pillar: pillarList[0]?.value || 'general',
        platform: 'linkedin',
        status: 'idea',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await fetchData();
      setEditorPost(data.post as Post);
      setEditorOpen(true);
    }
  };

  // Import a platform's posts from the connected Unipile account. Works for both
  // LinkedIn and X - the route already accepts either platform.
  const handleReimport = async (platform: Platform) => {
    const label = PLATFORM_LABELS[platform];
    setImporting(platform);
    setImportMessage(null);
    setImportError(null);

    try {
      const res = await fetchWithAuth('/api/voice-lab/import-from-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setImportError(data.error ?? `Could not import ${label} posts.`);
        return;
      }

      const persisted = data.persisted ?? {};
      const changed = (persisted.created ?? 0) + (persisted.repaired ?? 0);
      if (changed > 0) {
        setImportMessage(`Imported ${changed} ${label} post${changed === 1 ? '' : 's'}.`);
      } else if ((data.count ?? 0) > 0) {
        setImportMessage(`${label} posts are already imported.`);
      } else {
        const fetched = data.fetchedCount ?? 0;
        if (fetched > 0) {
          setImportMessage(`Found ${fetched} ${label} post${fetched === 1 ? '' : 's'}, but none were long original posts that can be restored.`);
        } else {
          setImportMessage(`No ${label} posts came back. Sync your account in Settings, then try again.`);
        }
      }
      await fetchData();
    } catch {
      setImportError(`Network error while importing ${label} posts.`);
    } finally {
      setImporting(null);
    }
  };

  // The header import button targets the active platform tab; on "All" it pulls both.
  const runImport = async () => {
    if (platformFilter === 'all') {
      await handleReimport('linkedin');
      await handleReimport('twitter');
    } else {
      await handleReimport(platformFilter);
    }
  };

  // Load more pagination
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await fetchWithAuth(`/api/posts?page=${nextPage}&limit=${PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json();
        const newPosts = (data.posts as Post[]) ?? [];
        setPosts((prev) => [...prev, ...newPosts]);
        setHasMore(newPosts.length >= PAGE_SIZE);
        setPage(nextPage);
      }
    } catch (err) {
      console.error('Failed to load more posts', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Editor
  const openEditor = (post: Post) => {
    setEditorPost(post);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorPost(null);
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-32 bg-bg-tertiary rounded-md animate-pulse" />
          <div className="h-9 w-28 bg-bg-tertiary rounded-md animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 bg-bg-tertiary rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-wide space-y-4">
      <PageHeader
        eyebrow="LIBRARY"
        title="Posts"
        subtitle="All your drafts, scheduled posts, and published content."
        action={
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[150px] sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="text"
              placeholder="Search posts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-bg-tertiary border border-border rounded-md pl-8 pr-3 py-2 min-h-[44px] text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover w-full sm:w-56 transition-colors"
            />
          </div>
          {/* View toggle */}
          <button
            onClick={() => setView('card')}
            className={`p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md border transition-all duration-100 ${
              view === 'card' ? 'border-accent-primary text-accent-primary' : 'border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView('table')}
            className={`p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md border transition-all duration-100 ${
              view === 'table' ? 'border-accent-primary text-accent-primary' : 'border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
          {/* New Post */}
          <button
            onClick={runImport}
            disabled={importing !== null}
            className="flex items-center gap-1.5 border border-border bg-bg-secondary text-text-primary text-[13px] font-medium px-4 py-[10px] min-h-[44px] rounded-md hover:border-border-hover transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${importing !== null ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">
              {importing !== null
                ? 'Importing'
                : platformFilter === 'all'
                  ? 'Import posts'
                  : `Import ${PLATFORM_LABELS[platformFilter]}`}
            </span>
            <span className="sm:hidden">Import</span>
          </button>
          <button
            onClick={handleNewPost}
            className="flex items-center gap-1.5 bg-accent-primary text-text-inverse text-[13px] font-medium px-5 py-[10px] min-h-[44px] rounded-md hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Post</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
        }
      />

      {(importMessage || importError) && (
        <div className={`rounded-md border px-3 py-2 text-[12px] ${
            importError
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-border bg-sage-light text-accent-secondary'
          }`}
        >
          {importError ?? importMessage}
        </div>
      )}

      {/* Tabs + filters on one line: All/LinkedIn/X left, select-all + filters right */}
      <div className="flex flex-wrap items-center gap-3">
        <PlatformTabs value={platformFilter} onChange={setPlatformFilter} counts={platformCounts} />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {view === 'card' && selected.size > 0 && (
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-secondary px-3 py-2 min-h-[44px] text-[13px] font-medium text-text-primary hover:border-border-hover transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length;
                }}
                readOnly
                className="w-4 h-4 accent-accent-primary pointer-events-none"
              />
              {selected.size === filtered.length && filtered.length > 0
                ? 'Deselect all'
                : `Select all (${filtered.length})`}
            </button>
          )}
          <FilterDropdown
            label="Status"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as Status | 'all')}
            options={[{ value: 'all', label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]}
          />
          {series.length > 0 && (
            <FilterDropdown
              label="Series"
              value={seriesFilter}
              onChange={(v) => setSeriesFilter(v)}
              options={[{ value: 'all', label: 'All' }, ...series.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-bg-tertiary border border-hair rounded-lg px-4 py-2">
          <span className="text-[12px] text-ink3">{selected.size} selected</span>
          <button onClick={handleBulkDelete} className="flex items-center gap-1 text-[13px] text-accent-primary hover:opacity-80">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={bulkStatusOpen}
              onClick={() => setBulkStatusOpen((o) => !o)}
              className="flex min-h-[44px] items-center gap-1 text-[13px] text-text-secondary hover:text-text-primary"
            >
              Change Status <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {bulkStatusOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden
                  onClick={() => setBulkStatusOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1 bg-bg-secondary border border-border rounded-lg py-1 shadow-card z-20">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        handleBulkStatus(s);
                        setBulkStatusOpen(false);
                      }}
                      className="block w-full min-h-[44px] text-left px-4 py-1.5 text-[13px] text-text-primary hover:bg-bg-tertiary capitalize"
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          {posts.length === 0 && (
            <FileText className="w-12 h-12 text-text-secondary mb-4" />
          )}
          <h2 className="text-[22px] font-normal tracking-[-0.025em] text-ink mb-1">
            {posts.length === 0 ? 'Nothing scripted yet' : 'No posts match your filters'}
          </h2>
          <p className="text-text-secondary text-[13px] mb-4">
            {posts.length === 0 ? 'Generate a script or convert an idea to get started.' : 'Try adjusting your filters.'}
          </p>
          {posts.length === 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={runImport}
                disabled={importing !== null}
                className="flex min-h-[40px] items-center gap-1.5 rounded-md border border-border bg-bg-secondary px-4 py-[10px] text-[13px] font-medium text-text-primary transition-colors hover:border-border-hover disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${importing !== null ? 'animate-spin' : ''}`} />
                {importing !== null
                  ? 'Importing'
                  : platformFilter === 'all'
                    ? 'Import posts'
                    : `Import ${PLATFORM_LABELS[platformFilter]} posts`}
              </button>
              <a
                href="/generate"
                className="flex items-center gap-1.5 bg-accent-primary text-text-inverse text-[13px] font-medium px-5 py-[10px] rounded-md hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" /> Generate a Script
              </a>
            </div>
          )}
        </div>
      ) : view === 'card' ? (
        <PostGrid
          posts={filtered}
          selected={selected}
          onSelect={toggleSelect}
          onClickPost={openEditor}
        />
      ) : (
        <PostTable
          posts={filtered}
          selected={selected}
          onSelect={toggleSelect}
          onSelectAll={toggleSelectAll}
          onClickPost={openEditor}
        />
      )}

      {hasMore && filtered.length > 0 && (
        <div className="flex justify-center pt-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-[13px] text-text-secondary hover:text-text-primary bg-bg-tertiary border border-border rounded-md px-6 py-2 min-h-[44px] transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {/* Post Editor Drawer */}
      {editorOpen && editorPost && (
        <PostEditorDrawer
          post={editorPost}
          series={series}
          onClose={closeEditor}
          onSave={fetchData}
          onDelete={() => { closeEditor(); fetchData(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform Tabs (All / LinkedIn / X)
// ---------------------------------------------------------------------------

function PlatformTabs({
  value,
  onChange,
  counts,
}: {
  value: Platform | 'all';
  onChange: (v: Platform | 'all') => void;
  counts: Record<string, number>;
}) {
  const tabs: { value: Platform | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'linkedin', label: PLATFORM_LABELS.linkedin },
    { value: 'twitter', label: PLATFORM_LABELS.twitter },
  ];
  return (
    <div className="flex items-center gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={`relative -mb-px flex min-h-[44px] items-center gap-1.5 border-b-2 px-4 py-2 text-[13px] font-medium transition-colors ${
              active
                ? 'border-accent-primary text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 py-0.5 font-mono text-[11px] ${
                active ? 'bg-coral-light text-accent-primary' : 'bg-bg-tertiary text-text-tertiary'
              }`}
            >
              {counts[t.value] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter Dropdown
// ---------------------------------------------------------------------------

function FilterDropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-bg-tertiary border border-border rounded-md pl-3 pr-7 py-2 min-h-[44px] text-[13px] text-text-primary focus:outline-none focus:border-border-hover cursor-pointer transition-colors"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary pointer-events-none" />
    </div>
  );
}
