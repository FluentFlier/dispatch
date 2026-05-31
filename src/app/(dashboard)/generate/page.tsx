"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
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

const TAB_DETAILS: Record<TabId, { title: string; description: string; outcome: string }> = {
  script: {
    title: "Draft a post",
    description: "Start with a topic, pick a pillar, and get a structured draft in your voice.",
    outcome: "Best for going from blank page to first draft.",
  },
  caption: {
    title: "Caption and hashtags",
    description: "Turn finished content into platform-native captions with usable hashtag sets.",
    outcome: "Best for packaging content before publishing.",
  },
  hooks: {
    title: "Hook lab",
    description: "Generate sharper openings before you commit to the full post.",
    outcome: "Best for improving click-through and watch time.",
  },
  comments: {
    title: "Reply writer",
    description: "Draft responses that sound like you and keep conversations moving.",
    outcome: "Best for clearing comment backlog quickly.",
  },
  "story-mine": {
    title: "Story mine",
    description: "Pull useful stories from your work, customers, and founder moments.",
    outcome: "Best for finding non-generic source material.",
  },
  repurpose: {
    title: "Repurpose",
    description: "Turn one asset into multiple platform-specific posts.",
    outcome: "Best for making one good idea travel farther.",
  },
  trend: {
    title: "Trend catcher",
    description: "Turn relevant trends into posts without sounding like everyone else.",
    outcome: "Best for timely commentary.",
  },
  series: {
    title: "Series planner",
    description: "Break a bigger idea into a sequence people can follow.",
    outcome: "Best for campaigns and recurring formats.",
  },
};

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
      <section className="rounded-lg border border-border bg-bg-secondary p-6 shadow-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-badge bg-accent-light px-2.5 py-1 text-xs font-medium text-accent-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Voice-aware writing desk
            </div>
            <PageHeader
              title="Write"
              subtitle="Choose the job, give it context, then edit before anything leaves the building."
            />
          </div>
          <div className="rounded-lg border border-border bg-bg-elevated px-4 py-3 text-sm text-text-secondary lg:max-w-sm">
            <span className="font-medium text-text-primary">{TAB_DETAILS[activeTab].title}:</span>{' '}
            {TAB_DETAILS[activeTab].outcome}
          </div>
        </div>
      </section>

      <div ref={tabBarRef} className="-mx-1 overflow-x-auto scrollbar-hide">
        <Tabs
          tabs={TAB_LIST}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as TabId)}
          variant="pill"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <section className="card-surface min-h-[360px]">{renderTab()}</section>
        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
            <p className="section-label">Current tool</p>
            <h2 className="mt-2 text-lg font-semibold text-text-primary">{TAB_DETAILS[activeTab].title}</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{TAB_DETAILS[activeTab].description}</p>
          </section>
          <section className="rounded-lg border border-border bg-bg-secondary p-5 shadow-card">
            <p className="section-label">Quality gate</p>
            <ul className="mt-4 space-y-3 text-sm text-text-secondary">
              {['Specific point of view', 'Matches your voice', 'Has a next action'].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent-secondary" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <a href="/library" className="group flex items-center justify-between rounded-lg border border-border bg-[#101312] p-4 text-sm font-medium text-white shadow-card">
            Review saved drafts
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </aside>
      </div>
    </div>
  );
}
