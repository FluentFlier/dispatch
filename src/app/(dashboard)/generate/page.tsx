"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
        <button
          type="button"
          onClick={() => setActiveTab("script")}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink2 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Write
        </button>
        <section className="card-surface">{renderTool()}</section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
      {isWelcome && !welcomeDismissed && (
        <p className="mb-4 text-center text-sm text-ink">
          Your voice is ready.{" "}
          <button type="button" onClick={() => setWelcomeDismissed(true)} className="underline">
            Dismiss
          </button>
        </p>
      )}

      {renderTool()}
    </div>
  );
}
