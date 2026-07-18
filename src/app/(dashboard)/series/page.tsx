"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus } from "lucide-react";
import { getInsforge } from "@/lib/insforge/client";
import type { Series, Post } from "@/lib/types";
import type { Status } from "@/lib/constants";
import SeriesCard from "@/components/series/SeriesCard";
import SeriesParts from "@/components/series/SeriesParts";
import { PageHeader } from "@/components/layout/PageHeader";

interface ProgressSummary {
  posted: number;
  inProduction: number;
  total: number;
}

export default function SeriesPage() {
  const router = useRouter();

  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [seriesPosts, setSeriesPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ProgressSummary>>({});

  // --- Data fetching ---

  const fetchSeries = useCallback(async () => {
    try {
      const insforge = getInsforge();
      const { data: userData } = await insforge.auth.getCurrentUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      setUserId(uid);

      const { data } = await insforge.database
        .from("series")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });

      if (data) setSeriesList(data as Series[]);
    } catch (err) {
      console.error("Failed to fetch series", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSeries();
  }, [fetchSeries]);

  const fetchSeriesPosts = useCallback(
    async (seriesId: string) => {
      if (!userId) return;
      setPostsLoading(true);
      try {
        const insforge = getInsforge();
        const { data } = await insforge.database
          .from("posts")
          .select("*")
          .eq("series_id", seriesId)
          .eq("user_id", userId)
          .order("series_position", { ascending: true });

        if (data) setSeriesPosts(data as Post[]);
      } catch (err) {
        console.error("Failed to fetch series posts", err);
      } finally {
        setPostsLoading(false);
      }
    },
    [userId]
  );

  // Progress summary per series, computed from a single scan of all series posts.
  const fetchProgress = useCallback(async () => {
    if (!userId || seriesList.length === 0) return;
    try {
      const insforge = getInsforge();
      const { data } = await insforge.database
        .from("posts")
        .select("series_id, status, caption, scheduled_date, script")
        .eq("user_id", userId)
        .in("series_id", seriesList.map((s) => s.id));

      const byId: Record<string, { posted: number; inProduction: number }> = {};
      for (const row of (data ?? []) as Pick<Post, "series_id" | "status" | "caption" | "scheduled_date" | "script">[]) {
        const sid = row.series_id;
        if (!sid) continue;
        byId[sid] ??= { posted: 0, inProduction: 0 };
        if (row.status === "posted") byId[sid].posted += 1;
        else if (row.status !== "idea" || row.caption || row.scheduled_date || row.script) {
          byId[sid].inProduction += 1;
        }
      }

      const next: Record<string, ProgressSummary> = {};
      for (const s of seriesList) {
        next[s.id] = {
          posted: byId[s.id]?.posted ?? 0,
          inProduction: byId[s.id]?.inProduction ?? 0,
          total: s.total_parts,
        };
      }
      setProgress(next);
    } catch (err) {
      console.error("Failed to fetch series progress", err);
    }
  }, [userId, seriesList]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  // --- Actions ---

  function toggleExpand(seriesId: string) {
    if (expandedId === seriesId) {
      setExpandedId(null);
      setSeriesPosts([]);
    } else {
      setExpandedId(seriesId);
      fetchSeriesPosts(seriesId);
    }
  }

  const onChanged = useCallback(() => {
    if (expandedId) fetchSeriesPosts(expandedId);
    fetchProgress();
  }, [expandedId, fetchSeriesPosts, fetchProgress]);

  async function setStatus(post: Post, status: Status) {
    if (!userId || busy) return;
    setBusy(true);
    setSeriesPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status } : p)));
    try {
      await getInsforge()
        .database.from("posts")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", post.id)
        .eq("user_id", userId);
      fetchProgress();
    } catch (err) {
      console.error("Failed to set status", err);
      if (expandedId) fetchSeriesPosts(expandedId);
    } finally {
      setBusy(false);
    }
  }

  async function swapPositions(postA: Post, postB: Post) {
    if (!userId || busy) return;
    setBusy(true);
    const posA = postA.series_position ?? 0;
    const posB = postB.series_position ?? 0;

    setSeriesPosts((prev) =>
      prev
        .map((p) => {
          if (p.id === postA.id) return { ...p, series_position: posB };
          if (p.id === postB.id) return { ...p, series_position: posA };
          return p;
        })
        .sort((a, b) => (a.series_position ?? 0) - (b.series_position ?? 0))
    );

    try {
      const insforge = getInsforge();
      await Promise.all([
        insforge.database.from("posts").update({ series_position: posB }).eq("id", postA.id).eq("user_id", userId),
        insforge.database.from("posts").update({ series_position: posA }).eq("id", postB.id).eq("user_id", userId),
      ]);
    } catch (err) {
      console.error("Failed to reorder posts", err);
      if (expandedId) fetchSeriesPosts(expandedId);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSeries(seriesId: string) {
    if (!userId) return;

    setSeriesList((prev) => prev.filter((s) => s.id !== seriesId));
    setConfirmDeleteId(null);
    if (expandedId === seriesId) {
      setExpandedId(null);
      setSeriesPosts([]);
    }

    try {
      const insforge = getInsforge();
      await insforge.database
        .from("posts")
        .update({ series_id: null, series_position: null })
        .eq("series_id", seriesId)
        .eq("user_id", userId);
      await insforge.database.from("series").delete().eq("id", seriesId).eq("user_id", userId);
    } catch (err) {
      console.error("Failed to delete series", err);
      await fetchSeries();
    }
  }

  function addPostToPart(series: Series, position: number) {
    const params = new URLSearchParams({
      series_id: series.id,
      series_position: String(position),
      pillar: series.pillar,
    });
    router.push(`/generate?${params.toString()}`);
  }

  // --- Render ---

  return (
    <div className="page-shell-wide">
      <PageHeader
        eyebrow="SERIES"
        title="Series"
        subtitle="Plan a multi-part arc, produce each part, then publish when it's ready."
        action={
          <button
            onClick={() => router.push("/generate?tab=series")}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" />
            Create series
          </button>
        }
      />

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-surface animate-pulse space-y-4 p-6">
              <div className="h-6 w-1/3 rounded bg-paper2" />
              <div className="h-2 w-full max-w-xl rounded bg-paper2" />
              <div className="h-4 w-1/4 rounded bg-paper2" />
            </div>
          ))}
        </div>
      ) : seriesList.length === 0 ? (
        <div className="empty-state flex flex-col items-center justify-center py-20 text-center">
          <Layers className="mb-4 h-12 w-12 text-ink3" />
          <h2 className="text-title text-ink">No series yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink2">
            A series is a multi-part arc. Plan the parts, produce each one, and publish when it&apos;s
            ready. Nothing gets scheduled until you say so.
          </p>
          <button
            onClick={() => router.push("/generate?tab=series")}
            className="btn-primary mt-6"
          >
            <Plus className="h-4 w-4" />
            Plan a new series
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {seriesList.map((series) => {
            const summary = progress[series.id] ?? {
              posted: 0,
              inProduction: 0,
              total: series.total_parts,
            };
            const isExpanded = expandedId === series.id;

            return (
              <SeriesCard
                key={series.id}
                series={series}
                progress={summary}
                isExpanded={isExpanded}
                onToggleExpand={() => toggleExpand(series.id)}
                onDelete={() => deleteSeries(series.id)}
                confirmingDelete={confirmDeleteId === series.id}
                onConfirmDelete={() => setConfirmDeleteId(series.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
              >
                {userId && (
                  <SeriesParts
                    series={series}
                    posts={seriesPosts}
                    loading={postsLoading}
                    userId={userId}
                    busy={busy}
                    onSetStatus={setStatus}
                    onSwap={swapPositions}
                    onAddPart={(position) => addPostToPart(series, position)}
                    onChanged={onChanged}
                  />
                )}
              </SeriesCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
