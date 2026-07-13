"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getInsforge } from "@/lib/insforge/client";
import type { ContentIdea } from "@/lib/types";
import { postPillars, normalizePillars, DEFAULT_PILLAR_WEIGHT } from "@/lib/pillars";
import type { Priority } from "@/lib/constants";
import { usePillars } from "@/hooks/usePillars";
import { Lightbulb, Sparkles, Target, TrendingUp } from "lucide-react";
import IdeaForm from "@/components/ideas/IdeaForm";
import IdeaRow from "@/components/ideas/IdeaRow";
import { PageHeader } from "@/components/layout/PageHeader";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

/** A ranked hook from GET /api/hooks/intelligence. */
interface IntelligenceHook {
  text: string;
  author?: string;
  verticals?: string[];
  score?: number | string;
}

/** Response shape from POST /api/research. */
interface ResearchResult {
  status?: string;
  error?: string;
  intelligence?: { hooks?: string };
}

type FilterMode = "all" | "unconverted" | "converted";

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export default function IdeasPage() {
  const router = useRouter();
  const { pillars: pillarList, loading: pillarsLoading, getLabel } = usePillars();
  const { toast } = useToast();

  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Intelligence & Research Lab surfaces.
  const [topHooks, setTopHooks] = useState<IntelligenceHook[]>([]);
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [hooksLoading, setHooksLoading] = useState(true);

  // Quick-add form state
  const [newIdea, setNewIdea] = useState("");
  const [newPillars, setNewPillars] = useState<string[]>([]);
  const [newWeights, setNewWeights] = useState<Record<string, number>>({});

  // Default the new-idea pillar selection once custom pillars finish loading.
  useEffect(() => {
    if (pillarsLoading || pillarList.length === 0) return;
    if (newPillars.length === 0) {
      const first = pillarList[0].value;
      setNewPillars([first]);
      setNewWeights({ [first]: DEFAULT_PILLAR_WEIGHT });
    }
  }, [pillarsLoading, pillarList, newPillars.length]);
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [adding, setAdding] = useState(false);

  // Filter state
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterPillar, setFilterPillar] = useState<string | "all">("all");

  // Converting state
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // --- Data fetching ---

  const fetchIdeas = useCallback(async () => {
    try {
      const insforge = getInsforge();
      const { data: userData } = await insforge.auth.getCurrentUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      setUserId(uid);

      const { data } = await insforge.database
        .from("content_ideas")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });

      if (data) setIdeas(data as ContentIdea[]);
    } catch (err) {
      console.error("Failed to fetch ideas", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  // Research Lab: fetch live RAG-ranked hooks.
  useEffect(() => {
    const loadIntelligence = async () => {
      try {
        const res = await fetchWithAuth('/api/hooks/intelligence?limit=8');
        if (res.ok) {
          const data = await res.json();
          setTopHooks(data.hooks || []);
        }
      } finally {
        setHooksLoading(false);
      }
    };
    loadIntelligence();
  }, []);

  // --- Sorting and filtering ---

  const filtered = useMemo(() => {
    let list = [...ideas];

    if (filterMode === "unconverted") list = list.filter((i) => !i.converted);
    if (filterMode === "converted") list = list.filter((i) => i.converted);
    if (filterPillar !== "all") list = list.filter((i) => postPillars(i).includes(filterPillar));

    list.sort((a, b) => {
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pDiff !== 0) return pDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return list;
  }, [ideas, filterMode, filterPillar]);

  const unconvertedCount = ideas.filter((i) => !i.converted).length;

  // --- Actions ---

  async function addIdea() {
    const text = newIdea.trim();
    if (!text || !userId) return;

    setAdding(true);

    // Keep primary pillar + pillars[] + weights in sync (primary = highest weight).
    const { pillar, pillars, pillar_weights } = normalizePillars({
      pillars: newPillars,
      pillar_weights: newWeights,
    });

    const optimistic: ContentIdea = {
      id: `temp-${Date.now()}`,
      user_id: userId,
      idea: text,
      pillar,
      pillars,
      pillar_weights,
      priority: newPriority,
      notes: null,
      converted: false,
      created_at: new Date().toISOString(),
    };
    setIdeas((prev) => [optimistic, ...prev]);
    setNewIdea("");

    try {
      const insforge = getInsforge();
      await insforge.database.from("content_ideas").insert([{
        user_id: userId,
        idea: text,
        pillar,
        pillars,
        pillar_weights,
        priority: newPriority,
      }]);
      await fetchIdeas();
    } catch (err) {
      console.error("Failed to add idea", err);
      setIdeas((prev) => prev.filter((i) => i.id !== optimistic.id));
    } finally {
      setAdding(false);
    }
  }

  async function updateIdeaText(ideaId: string, newText: string) {
    const trimmed = newText.trim();
    if (!trimmed || !userId) return;

    setIdeas((prev) =>
      prev.map((i) => (i.id === ideaId ? { ...i, idea: trimmed } : i))
    );

    try {
      const insforge = getInsforge();
      await insforge.database
        .from("content_ideas")
        .update({ idea: trimmed, updated_at: new Date().toISOString() })
        .eq("id", ideaId)
        .eq("user_id", userId);
    } catch (err) {
      console.error("Failed to update idea", err);
      await fetchIdeas();
    }
  }

  async function toggleConverted(idea: ContentIdea) {
    setIdeas((prev) =>
      prev.map((i) =>
        i.id === idea.id ? { ...i, converted: !i.converted } : i
      )
    );

    try {
      const insforge = getInsforge();
      await insforge.database
        .from("content_ideas")
        .update({ converted: !idea.converted })
        .eq("id", idea.id);
    } catch (err) {
      console.error("Failed to toggle converted", err);
      await fetchIdeas();
    }
  }

  async function deleteIdea(ideaId: string) {
    setIdeas((prev) => prev.filter((i) => i.id !== ideaId));

    try {
      const insforge = getInsforge();
      await insforge.database
        .from("content_ideas")
        .delete()
        .eq("id", ideaId)
        .eq("user_id", userId);
    } catch (err) {
      console.error("Failed to delete idea", err);
      await fetchIdeas();
    }
  }

  async function convertToScript(idea: ContentIdea) {
    setConvertingId(idea.id);

    try {
      const pillarLabel = getLabel(idea.pillar);
      const prompt = `Write a short-form video script about: ${idea.idea}\n\nContent pillar: ${pillarLabel}`;

      const res = await fetchWithAuth("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) throw new Error("Generate request failed");

      const { text } = await res.json();

      const insforge = getInsforge();
      await insforge.database
        .from("content_ideas")
        .update({ converted: true })
        .eq("id", idea.id);

      setIdeas((prev) =>
        prev.map((i) => (i.id === idea.id ? { ...i, converted: true } : i))
      );

      const params = new URLSearchParams({
        result: text,
        topic: idea.idea,
        pillar: idea.pillar,
      });
      router.push(`/generate?${params.toString()}`);
    } catch (err) {
      console.error("Failed to convert idea", err);
    } finally {
      setConvertingId(null);
    }
  }

  // --- Render ---

  return (
    <div className="page-shell space-y-6">
      <PageHeader
        eyebrow="IDEAS"
        title="Ideas"
        subtitle={
          !loading && ideas.length > 0
            ? `${ideas.length} saved, ${unconvertedCount} ready to turn into posts`
            : 'Save ideas before you forget them. Turn any idea into a post in one tap.'
        }
      />

      {/* Quick add form */}
      <IdeaForm
        value={newIdea}
        pillars={newPillars}
        weights={newWeights}
        priority={newPriority}
        adding={adding}
        onValueChange={setNewIdea}
        onPillarsChange={(next) => {
          setNewPillars(next.pillars);
          setNewWeights(next.weights);
        }}
        onPriorityChange={setNewPriority}
        onSubmit={addIdea}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-bg-tertiary border border-border rounded-md overflow-hidden">
          {(
            [
              ["all", "All"],
              ["unconverted", "Unconverted"],
              ["converted", "Converted"],
            ] as [FilterMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-3 py-2 min-h-[44px] text-[11px] tracking-[0.08em] transition-colors ${
                filterMode === mode
                  ? "bg-coral-light text-accent-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={filterPillar}
          onChange={(e) => setFilterPillar(e.target.value)}
          className="bg-bg-tertiary border border-border rounded-md px-2.5 py-2 min-h-[44px] text-[11px] text-text-primary focus:outline-none focus:border-border-hover transition-colors"
        >
          <option value="all">All pillars</option>
          {pillarList.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Ideas list */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3 bg-bg-tertiary rounded-md animate-pulse">
              <div className="w-4 h-4 rounded bg-bg-elevated shrink-0" />
              <div className="flex-1 h-4 bg-bg-elevated rounded" />
              <div className="w-16 h-5 bg-bg-elevated rounded shrink-0" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          {ideas.length === 0 && (
            <Lightbulb className="w-12 h-12 text-text-secondary mb-4" />
          )}
          <h2 className="font-normal tracking-[-0.025em] text-ink text-[20px] mb-1">
            {ideas.length === 0 ? "Nothing queued" : "No ideas match your filters"}
          </h2>
          <p className="text-text-secondary text-[13px]">
            {ideas.length === 0
              ? "Add an idea before you forget it."
              : "Try adjusting your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((idea) => (
            <IdeaRow
              key={idea.id}
              idea={idea}
              onToggleConverted={() => toggleConverted(idea)}
              onUpdateText={(newText) => updateIdeaText(idea.id, newText)}
              onConvertToScript={() => convertToScript(idea)}
              onDelete={() => deleteIdea(idea.id)}
              converting={convertingId === idea.id}
            />
          ))}
        </div>
      )}

      {/* Intelligence & Research Lab: ranked hooks to spark your next idea. */}
      <section id="intelligence" className="space-y-6 pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[24px] font-normal tracking-[-0.025em] text-ink flex items-center gap-2.5">
              <Sparkles className="h-5 w-5 text-accent-primary" />
              Intelligence &amp; Research Lab
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              Hooks ranked from top-performing posts to spark your next idea.
            </p>
          </div>
          <button
            onClick={async () => {
              setResearchLoading(true);
              try {
                const res = await fetchWithAuth('/api/research', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ brief: 'improve content performance and lead generation', vertical: 'indie_maker' }),
                });
                const data = await res.json();
                setResearchResult(data);
              } catch {
                setResearchResult({ error: 'Research is temporarily unavailable.' });
              } finally {
                setResearchLoading(false);
              }
            }}
            disabled={researchLoading}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-60 transition-colors"
          >
            {researchLoading ? 'Refreshing...' : 'Refresh hooks'}
            <Target className="h-4 w-4" />
          </button>
        </div>

        {/* Hook lab */}
        <div className="rounded-xl border border-border bg-bg-secondary p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-coral" />
            <h3 className="font-semibold">Top performing hooks</h3>
          </div>

          {hooksLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-bg-tertiary rounded-lg animate-pulse" />
              ))}
            </div>
          ) : topHooks.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {topHooks.slice(0, 8).map((hook, idx) => (
                <div key={idx} className="rounded-lg border border-border/70 bg-bg p-4 hover:border-accent-primary/40 transition-colors group flex flex-col">
                  <div className="text-sm leading-snug text-text-primary line-clamp-3 flex-1">“{hook.text}”</div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <div className="text-text-secondary">@{String(hook.author ?? '').replace(/^@+/, '')} • {hook.verticals?.[0] || 'general'}</div>
                    <div className="text-accent-primary font-semibold">{hook.score}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <CopyButton text={hook.text} className="text-[10px] px-2 py-0.5" />
                    <a href="/generate" className="text-[10px] text-accent-primary hover:underline">Use in Generate</a>
                    <button onClick={async () => {
                      try {
                        const res = await fetchWithAuth('/api/brain/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: hook.text, type: 'hook', source: 'intelligence' }) });
                        if (!res.ok) throw new Error('save failed');
                        toast('Saved to Creator Brain');
                      } catch { toast('Could not save. Try again.', 'error'); }
                    }} className="text-[10px] text-sage hover:underline">Save to Brain</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-text-secondary py-4">No hooks yet. Hit &ldquo;Refresh hooks&rdquo; to pull the current top performers.</div>
          )}

          {researchResult && (
            <div className="mt-4 rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-4 text-sm">
              {researchResult.status === 'hook-context-only' ? (
                <>
                  <div className="font-medium mb-2 flex items-center gap-2">
                    Hook context refreshed
                    <span className="text-xs opacity-70">(local intelligence dataset)</span>
                  </div>
                  <p className="text-xs text-text-secondary mb-2">
                    Surfaced high-performing hook patterns for your brief. These refresh automatically as your posts
                    collect engagement.
                  </p>
                </>
              ) : researchResult.error ? (
                <div className="font-medium text-accent-primary">{researchResult.error}</div>
              ) : (
                <div className="font-medium mb-2 flex items-center gap-2">
                  Research complete
                  <span className="text-xs opacity-70">(intelligence updated)</span>
                </div>
              )}
              {researchResult.intelligence?.hooks && (
                <div className="mb-2">
                  <div className="text-xs font-semibold mb-1">Top hooks surfaced:</div>
                  <div className="text-xs bg-bg/50 p-2 rounded max-h-24 overflow-auto">{researchResult.intelligence.hooks.substring(0, 300)}...</div>
                </div>
              )}
              <div className="text-[10px] text-text-tertiary">Use these in Generate, or let engagement sync keep them fresh.</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
