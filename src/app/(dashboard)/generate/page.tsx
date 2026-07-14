"use client";

import { Suspense, useEffect, useState, type ComponentType } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Hash,
  Layers,
  MessageSquare,
  Mic,
  Recycle,
  TrendingUp,
  Zap,
} from "lucide-react";
import { SkeletonLines } from "@/components/ui/Skeleton";
import { ScriptGenerator } from "@/components/generate/ScriptGenerator";
import { VoiceCapture } from "@/components/generate/VoiceCapture";
import { StoryMine } from "@/components/generate/StoryMine";
import { CaptionHashtags } from "@/components/generate/CaptionHashtags";
import { HookGenerator } from "@/components/generate/HookGenerator";
import { Repurpose } from "@/components/generate/Repurpose";
import { TrendCatcher } from "@/components/generate/TrendCatcher";
import { CommentReplies } from "@/components/generate/CommentReplies";
import { SeriesPlanner } from "@/components/generate/SeriesPlanner";
import { parseMentionList } from '@/lib/mentions';
import { normalizeDashboardPlatform, type DashboardPlatform } from "@/lib/constants";

type TabId =
  | "script"
  | "voice-note"
  | "story-mine"
  | "caption"
  | "hooks"
  | "repurpose"
  | "trend"
  | "comments"
  | "series";

function isTabId(value: string | null): value is TabId {
  return value === "script"
    || value === "voice-note"
    || value === "story-mine"
    || value === "caption"
    || value === "hooks"
    || value === "repurpose"
    || value === "trend"
    || value === "comments"
    || value === "series";
}

/**
 * Secondary writing tools. Script is the hero (always shown); these are the
 * supporting modes, surfaced as a quiet "More tools" strip beneath it so they're
 * discoverable without competing with the primary write flow.
 */
const SECONDARY_TOOLS: {
  id: Exclude<TabId, "script">;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "voice-note", label: "Voice note", hint: "Talk it out, we transcribe", icon: Mic },
  { id: "story-mine", label: "Story mine", hint: "Turn experiences into posts", icon: BookOpen },
  { id: "caption", label: "Caption & hashtags", hint: "Captions for a video", icon: Hash },
  { id: "hooks", label: "Hooks", hint: "Scroll-stopping first lines", icon: Zap },
  { id: "repurpose", label: "Repurpose", hint: "One idea, many formats", icon: Recycle },
  { id: "trend", label: "Trends", hint: "Ride what's working now", icon: TrendingUp },
  { id: "comments", label: "Comment replies", hint: "Reply in your voice", icon: MessageSquare },
  { id: "series", label: "Series", hint: "Plan a multi-part arc", icon: Layers },
];

const TOOL_LABELS: Record<Exclude<TabId, "script">, string> = SECONDARY_TOOLS.reduce(
  (acc, t) => ({ ...acc, [t.id]: t.label }),
  {} as Record<Exclude<TabId, "script">, string>,
);

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-xl px-4 py-16">
          <SkeletonLines count={2} />
        </div>
      }
    >
      <GeneratePageInner />
    </Suspense>
  );
}

function GeneratePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabId>(
    tabParam && tabParam !== "script" && isTabId(tabParam) ? tabParam : "script",
  );

  useEffect(() => {
    const current = searchParams.get("tab") ?? "script";
    const next = activeTab === "script" ? "script" : activeTab;
    if (current !== next) {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "script") params.delete("tab");
      else params.set("tab", next);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [activeTab, searchParams, router]);

  const initialResult = searchParams.get("result") || "";
  const initialTopic = searchParams.get("topic") || "";
  const initialPillar = searchParams.get("pillar") || "";
  const initialMentionsParam =
    searchParams.get("mentions") || searchParams.get("tag") || "";
  const initialMentions = initialMentionsParam ? parseMentionList(initialMentionsParam) : undefined;
  const isWelcome = searchParams.get("welcome") === "1";
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const welcomePlatform: DashboardPlatform | undefined = isWelcome
    ? normalizeDashboardPlatform(searchParams.get("platform"))
    : undefined;

  useEffect(() => {
    if (isWelcome) setActiveTab("script");
  }, [isWelcome]);

  const renderTool = () => {
    switch (activeTab) {
      case "script":
        return (
          <ScriptGenerator
            initialResult={initialResult}
            initialTopic={initialTopic}
            initialPillar={initialPillar}
            initialMentions={initialMentions}
            initialPlatform={isWelcome ? welcomePlatform : undefined}
            autoGenerate={isWelcome && Boolean(initialTopic)}
          />
        );
      case "voice-note":
        return <VoiceCapture />;
      case "story-mine":
        return <StoryMine />;
      case "caption":
        return <CaptionHashtags />;
      case "hooks":
        return <HookGenerator />;
      case "repurpose":
        return <Repurpose />;
      case "trend":
        return <TrendCatcher />;
      case "comments":
        return <CommentReplies />;
      case "series":
        return <SeriesPlanner />;
      default:
        return null;
    }
  };

  if (activeTab !== "script") {
    return (
      <div className="page-shell-wide max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("script")}
            className="inline-flex items-center gap-1.5 text-sm text-ink2 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Write
          </button>
          <span className="text-ink3">/</span>
          <span className="text-sm font-medium text-ink">{TOOL_LABELS[activeTab]}</span>
        </div>
        <section className="card-surface">{renderTool()}</section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
      {isWelcome && !welcomeDismissed && (
        <p className="mb-4 text-center text-sm text-teal">
          Your voice is ready.{" "}
          <button type="button" onClick={() => setWelcomeDismissed(true)} className="underline">
            Dismiss
          </button>
        </p>
      )}

      {renderTool()}

      <div className="mt-10 border-t border-hair pt-6">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink3">
          More tools
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SECONDARY_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className="group flex items-start gap-2.5 rounded-lg border border-hair bg-paper2/50 px-3 py-2.5 text-left transition-colors hover:border-hair2 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30"
            >
              <t.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink3 group-hover:text-ink2" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{t.label}</span>
                <span className="block truncate text-[11px] text-ink3">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
