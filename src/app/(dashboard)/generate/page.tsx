"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";
import { SkeletonLines } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScriptGenerator } from "@/components/generate/ScriptGenerator";
import { StoryMine } from "@/components/generate/StoryMine";
import { CaptionHashtags } from "@/components/generate/CaptionHashtags";
import { HookGenerator } from "@/components/generate/HookGenerator";
import { Repurpose } from "@/components/generate/Repurpose";
import { TrendCatcher } from "@/components/generate/TrendCatcher";
import { CommentReplies } from "@/components/generate/CommentReplies";
import { SeriesPlanner } from "@/components/generate/SeriesPlanner";

type TabId =
  | "script"
  | "story-mine"
  | "caption"
  | "hooks"
  | "repurpose"
  | "trend"
  | "comments"
  | "series";

const TAB_LIST: { id: TabId; label: string }[] = [
  { id: "script", label: "New post" },
  { id: "caption", label: "Caption" },
  { id: "hooks", label: "Hook" },
  { id: "comments", label: "Reply" },
  { id: "story-mine", label: "Story" },
  { id: "repurpose", label: "Repurpose" },
  { id: "trend", label: "Trend" },
  { id: "series", label: "Series" },
];

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="page-shell">
          <PageHeader title="Write" subtitle="AI drafts in your voice." />
          <div className="card-surface">
            <SkeletonLines count={3} />
          </div>
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
  const tabBarRef = useRef<HTMLDivElement>(null);

  const tabParam = searchParams.get("tab") as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(
    TAB_LIST.find((t) => t.id === tabParam)?.id || "script",
  );

  useEffect(() => {
    const current = searchParams.get("tab");
    if (current !== activeTab) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", activeTab);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [activeTab, searchParams, router]);

  useEffect(() => {
    if (!tabBarRef.current) return;
    const activeEl = tabBarRef.current.querySelector(`[data-tab="${activeTab}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeTab]);

  const initialResult = searchParams.get("result") || "";
  const initialTopic = searchParams.get("topic") || "";
  const initialPillar = searchParams.get("pillar") || "";

  const renderTab = () => {
    switch (activeTab) {
      case "script":
        return (
          <ScriptGenerator
            initialResult={initialResult}
            initialTopic={initialTopic}
            initialPillar={initialPillar}
          />
        );
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

  return (
    <div className="page-shell-wide">
      <PageHeader
        title="Write"
        subtitle="Pick a tool below. Everything is drafted in your voice — edit before you publish."
      />

      <div ref={tabBarRef} className="-mx-1 overflow-x-auto scrollbar-hide">
        <Tabs
          tabs={TAB_LIST}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as TabId)}
          variant="pill"
        />
      </div>

      <div className="card-surface min-h-[320px]">{renderTab()}</div>
    </div>
  );
}
