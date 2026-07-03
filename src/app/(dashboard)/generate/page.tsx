"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { SkeletonLines } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScriptGenerator } from "@/components/generate/ScriptGenerator";
import { VoiceCapture } from "@/components/generate/VoiceCapture";
import { StoryMine } from "@/components/generate/StoryMine";
import { CaptionHashtags } from "@/components/generate/CaptionHashtags";
import { HookGenerator } from "@/components/generate/HookGenerator";
import { Repurpose } from "@/components/generate/Repurpose";
import { TrendCatcher } from "@/components/generate/TrendCatcher";
import { CommentReplies } from "@/components/generate/CommentReplies";
import { SeriesPlanner } from "@/components/generate/SeriesPlanner";
import type { Platform } from "@/lib/constants";

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

const TAB_LIST: { id: TabId; label: string }[] = [
  { id: "script", label: "New post" },
  { id: "voice-note", label: "Voice note" },
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
  "voice-note": {
    title: "Voice note",
    description: "Speak your idea, we transcribe it, you edit, then generate a draft in your voice.",
    outcome: "Best for capturing ideas hands-free and turning talk into a post.",
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
          <PageHeader eyebrow="GENERATE" title="Write" subtitle="AI drafts in your voice." />
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
  const initialMentionsParam =
    searchParams.get("mentions") || searchParams.get("tag") || "";
  const isWelcome = searchParams.get("welcome") === "1";
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const welcomePlatform = (searchParams.get("platform") as Platform | null) ?? "linkedin";

  useEffect(() => {
    if (isWelcome && searchParams.get("tab") !== "script") {
      setActiveTab("script");
    }
  }, [isWelcome, searchParams]);

  const renderTab = () => {
    switch (activeTab) {
      case "script":
        return (
          <ScriptGenerator
            initialResult={initialResult}
            initialTopic={initialTopic}
            initialPillar={initialPillar}
            initialMentions={
              initialMentionsParam
                ? initialMentionsParam.split(/[,;\s]+/).filter(Boolean)
                : undefined
            }
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

  return (
    <div className="page-shell-wide">
      {isWelcome && !welcomeDismissed && (
        <section className="mb-6 rounded-lg border border-teal/30 bg-teal/5 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-teal">
                Your baseline is ready
              </p>
              <p className="mt-1 text-sm text-ink2">
                We learned your voice from your posts. Your first draft is generating below — edit before you publish.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setWelcomeDismissed(true)}
              className="shrink-0 text-sm font-medium text-teal hover:underline"
            >
              Got it
            </button>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-hair bg-paper2 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink3">
              <Sparkles className="h-3.5 w-3.5" />
              Voice-aware writing desk
            </div>
            <PageHeader
              eyebrow="GENERATE"
              title="Write"
              subtitle="Choose the job, give it context, then edit before anything leaves the building."
            />
          </div>
          <div className="rounded-lg border border-hair bg-paper px-4 py-3 text-sm text-ink2 lg:max-w-sm">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">{TAB_DETAILS[activeTab].title}:</span>{' '}
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
          <section className="rounded-lg border border-hair bg-paper2 p-5">
            <p className="section-label">Current tool</p>
            <h2 className="mt-2 font-serif text-lg font-normal tracking-[-0.025em] text-ink">{TAB_DETAILS[activeTab].title}</h2>
            <p className="mt-2 text-sm leading-6 text-ink2">{TAB_DETAILS[activeTab].description}</p>
          </section>
          <section className="rounded-lg border border-hair bg-paper2 p-5">
            <p className="section-label">Quality gate</p>
            <ul className="mt-4 space-y-3 text-sm text-ink2">
              {['Specific point of view', 'Matches your voice', 'Has a next action'].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <a href="/library" className="group flex items-center justify-between rounded-lg border border-hair bg-ink p-4 text-sm font-medium text-white">
            Review saved drafts
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </aside>
      </div>
    </div>
  );
}
