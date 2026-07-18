"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Menu, Search, X } from "lucide-react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { getInsforge } from "@/lib/insforge/client";
import type { Post } from "@/lib/types";
import { postPillars } from "@/lib/pillars";
import { usePillars } from "@/hooks/usePillars";
import CalendarGrid from "@/components/calendar/CalendarGrid";
import CalendarDayView from "@/components/calendar/CalendarDayView";
import CalendarSidebar from "@/components/calendar/CalendarSidebar";
import { ScheduleModal, FillWeekModal } from "@/components/calendar/CalendarModals";
import PostDetailModal from "@/components/calendar/PostDetailModal";
import { ClientOnly } from "@/components/ClientOnly";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

type ViewMode = "month" | "week" | "day";

const VIEW_LABELS: Record<ViewMode, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

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
const DAY_NAMES_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  const { getLabel } = usePillars();
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
  const [selectedDay, setSelectedDay] = useState(today);

  // Search
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Content filters (platform + published) - replaces the old pillar filter.
  const [platformFilter, setPlatformFilter] = useState<Set<string>>(new Set());
  const [publishedOnly, setPublishedOnly] = useState(false);

  // Modals
  const [scheduleModalDate, setScheduleModalDate] = useState<Date | null>(null);
  const [scheduleModalTime, setScheduleModalTime] = useState<string | undefined>(undefined);
  const [backlogPickPost, setBacklogPickPost] = useState<Post | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [fillWeekOpen, setFillWeekOpen] = useState(false);
  const [fillSuggestions, setFillSuggestions] = useState<
    { postId: string; date: string; title: string; pillar: string }[]
  >([]);
  const [fillLoading, setFillLoading] = useState(false);

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
        const wsRes = await fetchWithAuth("/api/workspaces", { cache: "no-store" });
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

  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      if (platformFilter.size > 0 && !platformFilter.has(p.platform)) return false;
      if (publishedOnly && p.status !== "posted") return false;
      return true;
    });
  }, [posts, platformFilter, publishedOnly]);

  const postDates = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) {
      if (p.scheduled_date) s.add(p.scheduled_date.slice(0, 10));
    }
    return s;
  }, [posts]);

  // Search results - filter all posts (including backlog) by query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return posts.filter((p) =>
      p.title?.toLowerCase().includes(q) ||
      p.caption?.toLowerCase().includes(q) ||
      p.script?.toLowerCase().includes(q) ||
      p.hook?.toLowerCase().includes(q)
    );
  }, [posts, searchQuery]);

  /* ---- Navigation ---- */
  const goToPrev = useCallback(() => {
    if (viewMode === "month") {
      if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
      else setCurrentMonth((m) => m - 1);
    } else if (viewMode === "week") {
      const d = new Date(weekBase);
      d.setDate(d.getDate() - 7);
      setWeekBase(d);
    } else if (viewMode === "day") {
      const d = new Date(selectedDay);
      d.setDate(d.getDate() - 1);
      setSelectedDay(d);
    }
  }, [viewMode, currentMonth, weekBase, selectedDay]);

  const goToNext = useCallback(() => {
    if (viewMode === "month") {
      if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
      else setCurrentMonth((m) => m + 1);
    } else if (viewMode === "week") {
      const d = new Date(weekBase);
      d.setDate(d.getDate() + 7);
      setWeekBase(d);
    } else if (viewMode === "day") {
      const d = new Date(selectedDay);
      d.setDate(d.getDate() + 1);
      setSelectedDay(d);
    }
  }, [viewMode, currentMonth, weekBase, selectedDay]);

  const goToToday = useCallback(() => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setWeekBase(today);
    setSelectedDay(today);
  }, [today]);

  function handleDateSelect(date: Date) {
    setCurrentYear(date.getFullYear());
    setCurrentMonth(date.getMonth());
    setWeekBase(date);
    setSelectedDay(date);
  }

  /* ---- Period label ---- */
  const periodLabel = useMemo(() => {
    if (viewMode === "month") return `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    if (viewMode === "day") {
      return selectedDay.toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      });
    }
    const weekDays = getWeekDays(weekBase);
    const start = weekDays[0];
    const end = weekDays[6];
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
  }, [viewMode, currentMonth, currentYear, weekBase, selectedDay]);

  /* ---- Platform filter toggle ---- */
  function handlePlatformToggle(slug: string) {
    setPlatformFilter((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  /* ---- Schedule a post ---- */
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

  /* ---- Click-to-assign flow ---- */
  const handleBacklogClick = (post: Post) => setBacklogPickPost(post);

  const handleDayCellClick = (day: Date) => {
    if (backlogPickPost) {
      schedulePost(backlogPickPost.id, day);
      setBacklogPickPost(null);
    } else {
      setScheduleModalTime(undefined);
      setScheduleModalDate(day);
    }
  };

  const handlePostClick = (post: Post) => setSelectedPost(post);

  /* ---- Day view: time slot click ---- */
  const handleTimeSlotClick = (date: Date, time: string) => {
    setScheduleModalTime(time);
    setScheduleModalDate(date);
  };

  /* ---- Publish Now ---- */
  const handlePublishNow = async (post: Post) => {
    const content = post.caption ?? post.script ?? post.hook ?? post.title ?? "";
    const res = await fetchWithAuth("/api/publish", {
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
  const handleUnschedule = async (postId: string) => {
    const res = await fetchWithAuth(`/api/posts/${postId}/unschedule`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Unschedule failed");
    await fetchPosts();
  };

  /* ---- Reschedule ---- */
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
      const res = await fetchWithAuth("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `You are a content scheduling assistant. Suggest which unscheduled posts to place on which days this week (${weekStart} to ${weekEnd}). Aim for pillar balance and even spacing.

Already scheduled this week:
${scheduledThisWeek.map((p) => `- ${p.title} (${postPillars(p).join(", ")}) on ${p.scheduled_date}`).join("\n") || "None"}

Unscheduled backlog:
${backlog.map((p) => `- id:${p.id} "${p.title}" (${postPillars(p).join(", ")}, status: ${p.status})`).join("\n")}

Available days: ${weekDays.map((d) => toDateKey(d)).join(", ")}

Respond ONLY with a JSON array: [{"postId":"...","date":"YYYY-MM-DD"}]. No explanation.`,
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

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;

      switch (e.key) {
        case "t": goToToday(); break;
        case "m": case "1": setViewMode("month"); break;
        case "w": case "2": setViewMode("week"); break;
        case "d": case "3": setViewMode("day"); break;
        case "ArrowLeft": case "j": goToPrev(); break;
        case "ArrowRight": case "k": goToNext(); break;
        case "/":
          e.preventDefault();
          setSearchActive(true);
          setTimeout(() => searchInputRef.current?.focus(), 50);
          break;
        case "c":
          if (!scheduleModalDate) setScheduleModalDate(today);
          break;
        case "Escape":
          setSelectedPost(null);
          setScheduleModalDate(null);
          setBacklogPickPost(null);
          setSearchActive(false);
          setSearchQuery("");
          break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [today, scheduleModalDate, goToPrev, goToNext, goToToday]);

  /* ---- Search activation ---- */
  function openSearch() {
    setSearchActive(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }

  function closeSearch() {
    setSearchActive(false);
    setSearchQuery("");
  }

  /* ---- Loading skeleton ---- */
  if (loading) {
    return (
      <div className="flex h-full animate-pulse">
        <div className="flex-1 flex flex-col gap-px">
          <div className="h-14 bg-bg-tertiary border-b border-hair" />
          <div className="flex-1 bg-bg-tertiary" />
        </div>
        <div className="w-[260px] bg-bg-tertiary border-l border-hair" />
      </div>
    );
  }

  const calendarSkeleton = <div className="flex-1 bg-bg-tertiary rounded-lg animate-pulse" />;

  return (
    <ClientOnly fallback={calendarSkeleton}>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex h-full -m-4 lg:-m-6 overflow-hidden">

          {/* ── MAIN AREA ── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

            {/* ── Toolbar ── */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-hair bg-bg-secondary shrink-0">

              {/* Today */}
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
              <span className="text-[13px] tracking-[0.06em] text-ink font-medium hidden sm:block">
                {periodLabel}
              </span>

              {/* Search icon */}
              <button
                onClick={openSearch}
                className="ml-auto p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                title="Search posts (/ key)"
              >
                <Search className="w-4 h-4" />
              </button>

              {/* View switcher */}
              <div className="flex border border-hair rounded-md overflow-hidden">
                {(["month", "week", "day"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`px-3 py-2 text-[11px] tracking-[0.08em] transition-colors ${
                      viewMode === v
                        ? "bg-accent-primary text-white"
                        : "text-ink3 hover:text-ink hover:bg-bg-tertiary"
                    }`}
                  >
                    {VIEW_LABELS[v]}
                  </button>
                ))}
              </div>

              {/* Hamburger - opens the mini-calendar + filters panel on the right */}
              <button
                onClick={() => setSidebarOpen((o) => !o)}
                className="hidden lg:flex p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                title="Toggle mini calendar & filters"
              >
                <Menu className="w-4 h-4" />
              </button>
            </div>

            {/* ── Search bar (slides in below toolbar) ── */}
            {searchActive && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-hair bg-bg-tertiary shrink-0">
                <Search className="w-4 h-4 text-ink3 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search posts by title, caption, hook..."
                  className="flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink3 focus:outline-none"
                />
                {searchQuery && (
                  <span className="text-[12px] text-ink3">
                    {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                  </span>
                )}
                <button
                  onClick={closeSearch}
                  className="p-1 text-text-secondary hover:text-text-primary rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

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

            {/* ── Main content area ── */}
            <div className="flex-1 overflow-auto p-4 flex justify-center">
              <div className="w-full max-w-6xl min-h-full flex flex-col justify-center">

              {/* Search results view */}
              {searchActive && searchQuery.trim() ? (
                <div className="space-y-1">
                  {searchResults.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-[14px] text-text-secondary">No posts match &ldquo;{searchQuery}&rdquo;</p>
                    </div>
                  ) : (
                    <div className="border border-hair rounded-lg overflow-hidden bg-bg-secondary divide-y divide-hair/50">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => { handlePostClick(p); }}
                          className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-bg-tertiary transition-colors group"
                        >
                          <div className="w-24 shrink-0">
                            <p className="text-[11px] text-ink3">
                              {p.scheduled_date
                                ? new Date(p.scheduled_date + "T12:00:00Z").toLocaleDateString("en-US", {
                                    month: "short", day: "numeric", year: "numeric",
                                  })
                                : "Unscheduled"}
                            </p>
                            {p.scheduled_publish_at && (
                              <p className="text-[10px] text-ink3">
                                {new Date(p.scheduled_publish_at).toLocaleTimeString("en-US", {
                                  hour: "numeric", minute: "2-digit", timeZone: "UTC",
                                })} UTC
                              </p>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-text-primary truncate group-hover:text-ink">
                              {p.title}
                            </p>
                            <p className="text-[11px] text-ink3 tracking-[0.06em]">
                              {p.platform} · {postPillars(p).join(" · ")}
                            </p>
                          </div>
                          <span className={`text-[10px] tracking-[0.08em] px-2 py-0.5 rounded ${
                            p.status === "posted" ? "bg-green-100 text-green-700" : "bg-bg-tertiary text-ink3"
                          }`}>
                            {p.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : viewMode === "day" ? (
                <CalendarDayView
                  selectedDay={selectedDay}
                  today={today}
                  posts={filteredPosts}
                  onPostClick={handlePostClick}
                  onTimeSlotClick={handleTimeSlotClick}
                />
              ) : (
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
              )}
              </div>
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          {sidebarOpen && (
            <CalendarSidebar
              today={today}
              currentYear={currentYear}
              currentMonth={currentMonth}
              postDates={postDates}
              platformFilter={platformFilter}
              onPlatformToggle={handlePlatformToggle}
              publishedOnly={publishedOnly}
              onTogglePublished={() => setPublishedOnly((v) => !v)}
              backlog={backlog}
              selectedPostId={backlogPickPost?.id ?? null}
              onBacklogPostClick={handleBacklogClick}
              onDateSelect={handleDateSelect}
              onCreateScheduled={() => {
                setScheduleModalTime(undefined);
                setScheduleModalDate(today);
              }}
              onFillWeek={handleFillWeek}
              fillDisabled={backlog.length === 0}
            />
          )}
        </div>
      </DragDropContext>

      {/* ── Modals ── */}

      {scheduleModalDate && !backlogPickPost && (
        <ScheduleModal
          date={scheduleModalDate}
          backlog={backlog}
          onSchedule={async (postId, time) => {
            await schedulePost(postId, scheduleModalDate, scheduleModalTime ?? time);
            setScheduleModalDate(null);
            setScheduleModalTime(undefined);
          }}
          onClose={() => { setScheduleModalDate(null); setScheduleModalTime(undefined); }}
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
