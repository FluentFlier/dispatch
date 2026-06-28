"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Menu,
} from "lucide-react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { getInsforge } from "@/lib/insforge/client";
import type { Post } from "@/lib/types";
import { usePillars } from "@/hooks/usePillars";
import CalendarGrid from "@/components/calendar/CalendarGrid";
import CalendarSidebar from "@/components/calendar/CalendarSidebar";
import { ScheduleModal, FillWeekModal } from "@/components/calendar/CalendarModals";
import PostDetailModal from "@/components/calendar/PostDetailModal";
import { ClientOnly } from "@/components/ClientOnly";
import { useRouter } from "next/navigation";

type ViewMode = "month" | "week";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getWeekDays(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  const dayOfWeek = start.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  start.setDate(start.getDate() - diff);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start));
    start.setDate(start.getDate() + 1);
  }
  return days;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  const { pillars, getLabel } = usePillars();
  const router = useRouter();
  const today = useMemo(() => new Date(), []);

  // Data
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Layout
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return "week";
    return "month";
  });
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [weekBase, setWeekBase] = useState(today);

  // Pillar filters — all visible by default (populated once pillars load)
  const [visiblePillars, setVisiblePillars] = useState<Set<string>>(new Set());

  // Modal state
  const [scheduleModalDate, setScheduleModalDate] = useState<Date | null>(null);
  const [backlogPickPost, setBacklogPickPost] = useState<Post | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [fillWeekOpen, setFillWeekOpen] = useState(false);
  const [fillSuggestions, setFillSuggestions] = useState<
    { postId: string; date: string; title: string; pillar: string }[]
  >([]);
  const [fillLoading, setFillLoading] = useState(false);

  /* ---- Pillar init ---- */

  useEffect(() => {
    if (pillars.length > 0 && visiblePillars.size === 0) {
      setVisiblePillars(new Set(pillars.map((p) => p.value)));
    }
  }, [pillars, visiblePillars.size]);

  /* ---- Data fetching ---- */

  const fetchPosts = useCallback(async () => {
    try {
      const insforge = getInsforge();
      const { data: userData } = await insforge.auth.getCurrentUser();
      if (!userData?.user) return;
      const uid = userData.user.id;
      setUserId(uid);

      let wsId: string | null = null;
      try {
        const wsRes = await fetch("/api/workspaces", { cache: "no-store", credentials: "same-origin" });
        if (wsRes.ok) wsId = (await wsRes.json()).activeId ?? null;
      } catch { /* fall back to user scope */ }

      let query = insforge.database
        .from("posts")
        .select("*")
        .eq("user_id", uid)
        .order("scheduled_date", { ascending: true });
      if (wsId) query = query.eq("workspace_id", wsId);
      const { data } = await query;
      setPosts((data as Post[]) ?? []);
    } catch (err) {
      console.error("Failed to fetch posts", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  /* ---- Derived data ---- */

  const backlog = useMemo(
    () => posts.filter((p) => !p.scheduled_date && p.status !== "posted"),
    [posts]
  );

  // Posts filtered by visible pillars — passed to the calendar grid
  const filteredPosts = useMemo(() => {
    if (visiblePillars.size === 0) return posts;
    return posts.filter((p) => visiblePillars.has(p.pillar));
  }, [posts, visiblePillars]);

  // Set of date keys that have at least one post — used by mini-calendar dots
  const postDates = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) {
      if (p.scheduled_date) s.add(p.scheduled_date.slice(0, 10));
    }
    return s;
  }, [posts]);

  /* ---- Navigation ---- */

  function goToPrev() {
    if (viewMode === "month") {
      if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
      else setCurrentMonth((m) => m - 1);
    } else {
      const d = new Date(weekBase);
      d.setDate(d.getDate() - 7);
      setWeekBase(d);
    }
  }

  function goToNext() {
    if (viewMode === "month") {
      if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
      else setCurrentMonth((m) => m + 1);
    } else {
      const d = new Date(weekBase);
      d.setDate(d.getDate() + 7);
      setWeekBase(d);
    }
  }

  function goToToday() {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setWeekBase(today);
  }

  // Navigate main view to a specific date (called from mini-calendar clicks)
  function handleDateSelect(date: Date) {
    setCurrentYear(date.getFullYear());
    setCurrentMonth(date.getMonth());
    setWeekBase(date);
  }

  /* ---- Pillar toggle ---- */

  function handlePillarToggle(slug: string) {
    setVisiblePillars((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  /* ---- Period label ---- */

  const periodLabel = useMemo(() => {
    if (viewMode === "month") return `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    const weekDays = getWeekDays(weekBase);
    const start = weekDays[0];
    const end = weekDays[6];
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
  }, [viewMode, currentMonth, currentYear, weekBase]);

  /* ---- Schedule a post ---- */

  /**
   * Writes scheduled_date + scheduled_publish_at onto a post.
   * time is HH:MM in UTC.
   */
  const schedulePost = async (postId: string, date: Date, time: string = "12:00") => {
    if (!userId) return;
    const insforge = getInsforge();
    const dateKey = toDateKey(date);
    const [hours, minutes] = time.split(":").map(Number);
    const dt = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0));

    await insforge.database
      .from("posts")
      .update({
        scheduled_date: dateKey,
        scheduled_publish_at: dt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .eq("user_id", userId);
    await fetchPosts();
  };

  /* ---- Drag and drop ---- */

  const handleDragEnd = async (result: DropResult) => {
    const { draggableId, destination } = result;
    if (!destination) return;
    const droppableId = destination.droppableId;
    if (!droppableId.startsWith("day-") && !droppableId.startsWith("mday-")) return;
    const dateStr = droppableId.replace("day-", "").replace("mday-", "");
    const [year, month, day] = dateStr.split("-").map(Number);
    await schedulePost(draggableId, new Date(year, month - 1, day));
  };

  /* ---- Backlog click-to-assign flow ---- */

  const handleBacklogClick = (post: Post) => {
    setBacklogPickPost(post);
  };

  const handleDayCellClick = (day: Date) => {
    if (backlogPickPost) {
      schedulePost(backlogPickPost.id, day);
      setBacklogPickPost(null);
    } else {
      setScheduleModalDate(day);
    }
  };

  /* ---- Post card click → PostDetailModal ---- */

  const handlePostClick = (post: Post) => {
    setSelectedPost(post);
  };

  /* ---- Publish Now from calendar ---- */

  /**
   * Calls /api/publish to immediately publish a scheduled post.
   * Throws on failure so PostDetailModal can display the error.
   */
  const handlePublishNow = async (post: Post) => {
    const content = post.caption ?? post.script ?? post.hook ?? post.title ?? "";
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId: post.id,
        platform: post.platform,
        content,
        imageUrl: post.image_url ?? undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Publish failed");
    await fetchPosts();
  };

  /* ---- Unschedule ---- */

  /**
   * Clears the post's schedule and cancels any pending publish job.
   */
  const handleUnschedule = async (postId: string) => {
    const res = await fetch(`/api/posts/${postId}/unschedule`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Unschedule failed");
    await fetchPosts();
  };

  /* ---- Reschedule ---- */

  /**
   * Updates the scheduled date+time for an already-scheduled post.
   * date is YYYY-MM-DD, time is HH:MM (UTC).
   */
  const handleReschedule = async (postId: string, date: string, time: string) => {
    const [year, month, day] = date.split("-").map(Number);
    const [hours, minutes] = time.split(":").map(Number);
    const dt = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
    const insforge = getInsforge();
    const { error } = await insforge.database
      .from("posts")
      .update({
        scheduled_date: date,
        scheduled_publish_at: dt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .eq("user_id", userId!);
    if (error) throw new Error(error.message);
    await fetchPosts();
  };

  /* ---- AI Fill This Week ---- */

  const handleFillWeek = async () => {
    if (!userId || backlog.length === 0) return;
    setFillLoading(true);
    setFillWeekOpen(true);

    try {
      const weekDays = getWeekDays(viewMode === "week" ? weekBase : today);
      const weekStart = toDateKey(weekDays[0]);
      const weekEnd = toDateKey(weekDays[6]);

      const scheduledThisWeek = posts.filter((p) => {
        if (!p.scheduled_date) return false;
        const d = p.scheduled_date.slice(0, 10);
        return d >= weekStart && d <= weekEnd;
      });

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `You are a content scheduling assistant. Given the following context, suggest which unscheduled posts should be placed on which days this week (${weekStart} to ${weekEnd}). Aim for pillar balance and even spacing.

Already scheduled this week:
${scheduledThisWeek.map((p) => `- ${p.title} (${p.pillar}) on ${p.scheduled_date}`).join("\n") || "None"}

Unscheduled backlog:
${backlog.map((p) => `- id:${p.id} "${p.title}" (${p.pillar}, status: ${p.status})`).join("\n")}

Available days: ${weekDays.map((d) => toDateKey(d)).join(", ")}

Respond ONLY with a JSON array of objects: [{"postId":"...","date":"YYYY-MM-DD"}]. No explanation.`,
        }),
      });

      const result = await res.json();
      const raw = result.text || result.content || "";
      const jsonMatch = raw.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]) as { postId: string; date: string }[];
        const enriched = suggestions
          .map((s) => {
            const post = backlog.find((p) => p.id === s.postId);
            if (!post) return null;
            return { postId: s.postId, date: s.date, title: post.title, pillar: post.pillar };
          })
          .filter(Boolean) as { postId: string; date: string; title: string; pillar: string }[];
        setFillSuggestions(enriched);
      }
    } catch (err) {
      console.error("Fill week failed", err);
    } finally {
      setFillLoading(false);
    }
  };

  const confirmFillWeek = async () => {
    if (!userId) return;
    const insforge = getInsforge();
    for (const s of fillSuggestions) {
      await insforge.database
        .from("posts")
        .update({
          scheduled_date: s.date,
          scheduled_publish_at: `${s.date}T12:00:00.000Z`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", s.postId)
        .eq("user_id", userId);
    }
    setFillWeekOpen(false);
    setFillSuggestions([]);
    await fetchPosts();
  };

  /* ---- Loading skeleton ---- */

  if (loading) {
    return (
      <div className="flex h-full animate-pulse">
        <div className="w-[260px] bg-bg-tertiary border-r border-hair" />
        <div className="flex-1 flex flex-col gap-px">
          <div className="h-14 bg-bg-tertiary border-b border-hair" />
          <div className="flex-1 bg-bg-tertiary" />
        </div>
      </div>
    );
  }

  /* ---- Render ---- */

  const calendarSkeleton = (
    <div className="flex-1 bg-bg-tertiary rounded-lg animate-pulse" />
  );

  return (
    <ClientOnly fallback={calendarSkeleton}>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex h-full -m-4 lg:-m-6 overflow-hidden">

          {/* ── LEFT SIDEBAR ── */}
          {sidebarOpen && (
            <CalendarSidebar
              today={today}
              currentYear={currentYear}
              currentMonth={currentMonth}
              postDates={postDates}
              pillars={pillars}
              visiblePillars={visiblePillars}
              onPillarToggle={handlePillarToggle}
              backlog={backlog}
              selectedPostId={backlogPickPost?.id ?? null}
              onBacklogPostClick={handleBacklogClick}
              onDateSelect={handleDateSelect}
              onCreateScheduled={() => setScheduleModalDate(today)}
              onFillWeek={handleFillWeek}
              fillDisabled={backlog.length === 0}
            />
          )}

          {/* ── MAIN AREA ── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

            {/* ── Toolbar ── */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-hair bg-bg-secondary shrink-0 flex-wrap">

              {/* Hamburger */}
              <button
                onClick={() => setSidebarOpen((o) => !o)}
                className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors lg:flex hidden"
              >
                <Menu className="w-4 h-4" />
              </button>

              {/* Today button */}
              <button
                onClick={goToToday}
                className="px-3 py-1.5 text-[13px] font-medium border border-border rounded-md text-ink hover:border-border-hover transition-colors"
              >
                Today
              </button>

              {/* Prev / Next */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={goToPrev}
                  className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={goToNext}
                  className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Period label */}
              <span className="font-mono text-[13px] uppercase tracking-[0.06em] text-ink font-medium">
                {periodLabel}
              </span>

              {/* View switcher (right-aligned) */}
              <div className="ml-auto flex border border-hair rounded-md overflow-hidden">
                {(["month", "week"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] transition-colors ${
                      viewMode === v
                        ? "bg-accent-primary text-white"
                        : "text-ink3 hover:text-ink hover:bg-bg-tertiary"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Backlog pick banner ── */}
            {backlogPickPost && (
              <div className="flex items-center gap-2 mx-4 mt-3 bg-bg-secondary border border-accent-primary/40 rounded-lg px-4 py-2 text-[13px] text-text-primary shrink-0">
                <span className="text-accent-primary">→</span>
                Click a day to schedule{" "}
                <span className="font-medium">
                  &quot;{backlogPickPost.title.slice(0, 40)}{backlogPickPost.title.length > 40 ? "…" : ""}&quot;
                </span>
                <button
                  onClick={() => setBacklogPickPost(null)}
                  className="ml-auto text-text-secondary hover:text-text-primary text-[12px]"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* ── Calendar grid ── */}
            <div className="flex-1 overflow-auto p-4">
              <CalendarGrid
                viewMode={viewMode}
                currentYear={currentYear}
                currentMonth={currentMonth}
                weekBase={weekBase}
                posts={filteredPosts}
                today={today}
                isPickMode={!!backlogPickPost}
                onDayCellClick={handleDayCellClick}
                onPostClick={handlePostClick}
              />
            </div>
          </div>
        </div>
      </DragDropContext>

      {/* ── Modals ── */}

      {scheduleModalDate && !backlogPickPost && (
        <ScheduleModal
          date={scheduleModalDate}
          backlog={backlog}
          onSchedule={async (postId, time) => {
            await schedulePost(postId, scheduleModalDate, time);
            setScheduleModalDate(null);
          }}
          onClose={() => setScheduleModalDate(null)}
        />
      )}

      {fillWeekOpen && (
        <FillWeekModal
          loading={fillLoading}
          suggestions={fillSuggestions}
          getLabel={getLabel}
          onConfirm={confirmFillWeek}
          onClose={() => { setFillWeekOpen(false); setFillSuggestions([]); }}
        />
      )}

      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onPublishNow={handlePublishNow}
          onReschedule={handleReschedule}
          onUnschedule={handleUnschedule}
          onEdit={(p) => {
            setSelectedPost(null);
            router.push(`/library?post=${p.id}`);
          }}
        />
      )}
    </ClientOnly>
  );
}
