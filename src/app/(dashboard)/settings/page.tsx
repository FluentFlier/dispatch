"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { getInsforge } from "@/lib/insforge/client";
import type { ContentPillarConfig, PlatformConfig, CreatorProfile, UserSetting } from "@/types/database";
import type { DashboardPlatform, Platform } from "@/lib/constants";
import { normalizeDashboardPlatform } from "@/lib/constants";
import { Loader2 } from "lucide-react";

import ContextEditor from "@/components/settings/ContextEditor";
import PillarWeights from "@/components/settings/PillarWeights";
import WeeklySchedule from "@/components/settings/WeeklySchedule";
import PlatformDefaults from "@/components/settings/PlatformDefaults";
import BioGenerator from "@/components/settings/BioGenerator";
import PlatformConnections from "@/components/settings/PlatformConnections";
import CalendarConnectionCard from "@/components/calendar/CalendarConnectionCard";
import GmailConnectionCard from "@/components/settings/GmailConnectionCard";
import ProfileEditor from "@/components/settings/ProfileEditor";
import AutoOptimizeToggle from "@/components/settings/AutoOptimizeToggle";
import VoiceDefaultToggle from "@/components/settings/VoiceDefaultToggle";
import HookWatchlistEditor from "@/components/settings/HookWatchlistEditor";
import AgentAccessCard from "@/components/settings/AgentAccessCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { integrationNoticeFromSearchParams } from "@/lib/composio/integration-messages";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface BioCard {
  platform: string;
  bio: string;
  limit: number;
}

interface ConnectedAccount {
  id: string;
  platform: string;
  account_name: string | null;
  account_id: string | null;
  connected_at: string;
  connection_method?: string | null;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-secondary border border-border rounded-lg p-6 shadow-card">
      <h2 className="section-label mb-4 border-b border-hair pb-3">{title}</h2>
      {children}
    </div>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-text-secondary mb-3">
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------------ */
/*  Main settings page                                                 */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'connections', label: 'Connections' },
  { id: 'billing', label: 'Billing' },
  { id: 'profile', label: 'Profile' },
  { id: 'content', label: 'Content' },
  { id: 'tools', label: 'Tools' },
] as const;

type SettingsTab = (typeof TABS)[number]['id'];

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as SettingsTab) || 'connections';
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Section 1: Context
  const [contextAdditions, setContextAdditions] = useState("");
  const [contextSaving, setContextSaving] = useState(false);
  const [contextSaved, setContextSaved] = useState(false);

  // Section 2: Pillar weights
  const [pillarWeights, setPillarWeights] = useState<Record<string, number>>({});
  const [weightsSaving, setWeightsSaving] = useState(false);
  const [weightsSaved, setWeightsSaved] = useState(false);

  // Section 3: Weekly schedule
  const [weeklySchedule, setWeeklySchedule] = useState<Record<string, string>>(
    () => {
      const schedule: Record<string, string> = {};
      DAYS_OF_WEEK.forEach((d) => (schedule[d] = "Rest"));
      return schedule;
    }
  );
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);

  // Section 4: Platform defaults
  const [defaultPlatform, setDefaultPlatform] = useState<DashboardPlatform>("linkedin");
  const [crossPostReminders, setCrossPostReminders] = useState(false);
  const [platformDefaultsSaving, setPlatformDefaultsSaving] = useState(false);
  const [platformDefaultsSaved, setPlatformDefaultsSaved] = useState(false);

  // Section 5: Bio generator
  const [bioGenerating, setBioGenerating] = useState(false);
  const [bios, setBios] = useState<BioCard[]>([]);

  // Section 6: Platform connections
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>({
    instagram: { accessToken: "", igUserId: "", enabled: false },
    x: {
      apiKey: "",
      apiSecret: "",
      accessToken: "",
      accessSecret: "",
      enabled: false,
    },
    linkedin: {
      clientId: "",
      clientSecret: "",
      accessToken: "",
      refreshToken: "",
      personId: "",
      enabled: false,
    },
    threads: { accessToken: "", threadsUserId: "", enabled: false },
  });
  const [platformSaving, setPlatformSaving] = useState(false);
  const [platformSaved, setPlatformSaved] = useState(false);

  // Section 7: Profile editor
  const [displayName, setDisplayName] = useState("");
  const [bioFacts, setBioFacts] = useState("");
  const [voiceDescription, setVoiceDescription] = useState("");
  const [voiceRules, setVoiceRules] = useState("");
  const [pillars, setPillars] = useState<ContentPillarConfig[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");

  // Section 8: Auto-Optimize
  const [autoOptimize, setAutoOptimize] = useState(false);
  const [autoOptimizeSaving, setAutoOptimizeSaving] = useState(false);
  const [autoOptimizeSaved, setAutoOptimizeSaved] = useState(false);

  // Connected Accounts (OAuth)
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<{
    plan: string;
    isPaid: boolean;
    usage: { publishes: number; scheduled: number };
    limits: { publishesPerMonth: number };
  } | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [unipileConfigured, setUnipileConfigured] = useState<boolean | null>(null);
  const [composioConfigured, setComposioConfigured] = useState<boolean | null>(null);
  const [integrationsRefreshKey, setIntegrationsRefreshKey] = useState(0);
  const [integrationNotice, setIntegrationNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  /* ---- Helpers ---- */

  const flashSaved = useCallback((setter: (v: boolean) => void) => {
    setter(true);
    setTimeout(() => setter(false), 2000);
  }, []);

  async function upsertSetting(key: string, value: string) {
    if (!userId) return;
    const insforge = getInsforge();
    await insforge.database.from("user_settings").upsert(
      {
        user_id: userId,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key" }
    );
  }

  /* ---- Load data ---- */

  useEffect(() => {
    async function load() {
      try {
        const insforge = getInsforge();
        const { data: userData } = await insforge.auth.getCurrentUser();
        const uid = userData?.user?.id;
        if (!uid) return;
        setUserId(uid);

        // Connections data is only needed on the Connections tab and the
        // /api/social-accounts fetch (Unipile) can be slow. Load it separately so
        // it never blocks the Profile/Content tabs from rendering.
        fetch("/api/social-accounts")
          .then((r) => (r.ok ? r.json() : { accounts: [] }))
          .then((social) => setConnectedAccounts(social.accounts ?? []))
          .catch(() => setConnectedAccounts([]));

        const [settingsRes, profileRes] = await Promise.all([
          insforge.database
            .from("user_settings")
            .select("*")
            .eq("user_id", uid),
          insforge.database
            .from("creator_profile")
            .select("*")
            .eq("user_id", uid)
            .maybeSingle(),
        ]);

        const settings: UserSetting[] = settingsRes.data ?? [];
        const prof: CreatorProfile | null = profileRes.data;

        for (const s of settings) {
          if (s.key === "context_additions") {
            setContextAdditions(s.value);
          } else if (s.key === "pillar_weights") {
            try {
              setPillarWeights(JSON.parse(s.value));
            } catch { /* ignore parse errors */ }
          } else if (s.key === "weekly_schedule") {
            try {
              setWeeklySchedule((prev) => ({ ...prev, ...JSON.parse(s.value) }));
            } catch { /* ignore parse errors */ }
          } else if (s.key === "platform_defaults") {
            try {
              const parsed = JSON.parse(s.value);
              if (parsed.defaultPlatform) {
                setDefaultPlatform(normalizeDashboardPlatform(parsed.defaultPlatform));
              }
              if (parsed.crossPostReminders !== undefined)
                setCrossPostReminders(parsed.crossPostReminders);
            } catch { /* ignore parse errors */ }
          } else if (s.key === "auto_optimize_on_save") {
            setAutoOptimize(s.value === "true");
          }
        }

        if (prof) {
          setProfile(prof);
          setDisplayName(prof.display_name);
          setBioFacts(prof.bio_facts);
          setVoiceDescription(prof.voice_description);
          setVoiceRules(prof.voice_rules);

          const parsedPillars: ContentPillarConfig[] =
            typeof prof.content_pillars === "string"
              ? JSON.parse(prof.content_pillars)
              : prof.content_pillars;
          setPillars(parsedPillars);

          const existingWeights: Record<string, number> = {};
          for (const p of parsedPillars) {
            existingWeights[p.name] = pillarWeights[p.name] ?? 3;
          }
          setPillarWeights((prev) => ({ ...existingWeights, ...prev }));

          const parsedPlatformConfig: PlatformConfig =
            typeof prof.platform_config === "string"
              ? JSON.parse(prof.platform_config)
              : prof.platform_config;
          setPlatformConfig((prev) => ({
            ...prev,
            ...parsedPlatformConfig,
          }));
        }
      } catch (err) {
        console.error("[Settings] Load error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const notice = integrationNoticeFromSearchParams(searchParams);
    if (notice) {
      setActiveTab('connections');
      setIntegrationNotice(notice);
    }

    const shouldRefreshIntegrations =
      searchParams.get('outreach_connected') ||
      searchParams.get('calendar_error') ||
      searchParams.get('outreach_error');

    if (shouldRefreshIntegrations) {
      setIntegrationsRefreshKey((k) => k + 1);
    }

    // Unipile success redirect lands on /settings?tab=connections&connected=true.
    // Call /api/social-accounts/sync first — this is the fallback for local dev
    // where the Unipile webhook can't reach localhost. In production the webhook
    // already stored the account, so the sync is a fast no-op (accounts already exist).
    if (searchParams.get('connected') === 'true') {
      fetch('/api/social-accounts/sync', { method: 'POST' })
        .catch(() => undefined)
        .finally(() => refreshAccounts());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    fetch('/api/entitlements')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setEntitlements(data))
      .catch(() => undefined);
    fetch('/api/health')
      .then((r) => r.json().catch(() => null))
      .then((data) => {
        if (!data?.checks) return;
        setUnipileConfigured(data.checks.social === 'ok');
        setComposioConfigured(data.checks.composio === 'ok');
      })
      .catch(() => {
        setUnipileConfigured(null);
        setComposioConfigured(null);
      });
    fetch('/api/signals/integrations')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.composio_configured === 'boolean') {
          setComposioConfigured(data.composio_configured);
        }
      })
      .catch(() => undefined);
  }, []);

  async function openBillingPortal() {
    setBillingLoading(true);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setBillingLoading(false);
    }
  }

  /* ---- Save handlers ---- */

  async function saveContext() {
    setContextSaving(true);
    await upsertSetting("context_additions", contextAdditions);
    setContextSaving(false);
    flashSaved(setContextSaved);
  }

  async function savePillarWeights() {
    setWeightsSaving(true);
    await upsertSetting("pillar_weights", JSON.stringify(pillarWeights));
    setWeightsSaving(false);
    flashSaved(setWeightsSaved);
  }

  async function saveWeeklySchedule() {
    setScheduleSaving(true);
    await upsertSetting("weekly_schedule", JSON.stringify(weeklySchedule));
    setScheduleSaving(false);
    flashSaved(setScheduleSaved);
  }

  async function savePlatformDefaults() {
    setPlatformDefaultsSaving(true);
    await upsertSetting(
      "platform_defaults",
      JSON.stringify({ defaultPlatform, crossPostReminders })
    );
    setPlatformDefaultsSaving(false);
    flashSaved(setPlatformDefaultsSaved);
  }

  async function saveAutoOptimize() {
    setAutoOptimizeSaving(true);
    await upsertSetting("auto_optimize_on_save", String(autoOptimize));
    setAutoOptimizeSaving(false);
    flashSaved(setAutoOptimizeSaved);
  }

  async function savePlatformConfig() {
    if (!userId) return;
    setPlatformSaving(true);
    const insforge = getInsforge();
    await insforge.database
      .from("creator_profile")
      .upsert(
        {
          user_id: userId,
          display_name: displayName || "Creator",
          platform_config: JSON.stringify(platformConfig),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    setPlatformSaving(false);
    flashSaved(setPlatformSaved);
  }

  async function saveProfile() {
    if (!userId) return;
    setProfileSaving(true);
    setProfileError("");
    const insforge = getInsforge();
    // Surface real failures instead of always flashing "Saved!" — previously an
    // upsert error (e.g. RLS) was ignored and the UI still claimed success.
    const { error } = await insforge.database
      .from("creator_profile")
      .upsert(
        {
          user_id: userId,
          display_name: displayName || "Creator",
          bio_facts: bioFacts,
          voice_description: voiceDescription,
          voice_rules: voiceRules,
          content_pillars: JSON.stringify(pillars),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    setProfileSaving(false);
    if (error) {
      setProfileError("Could not save profile. Please try again.");
      return;
    }
    flashSaved(setProfileSaved);
  }

  /* ---- Connected accounts ---- */

  async function refreshAccounts() {
    try {
      const res = await fetch("/api/social-accounts");
      if (res.ok) {
        const data = await res.json();
        setConnectedAccounts(data.accounts ?? []);
      }
    } catch {
      // silently fail
    }
  }

  async function disconnectAccount(platform: string) {
    setDisconnecting(platform);
    try {
      const res = await fetch(`/api/social-accounts/${platform}`, { method: "DELETE" });
      if (res.ok) {
        setConnectedAccounts((prev) => prev.filter((a) => a.platform !== platform));
      }
    } catch {
      // silently fail
    } finally {
      setDisconnecting(null);
    }
  }

  /* ---- Bio generator ---- */

  async function generateBios() {
    setBioGenerating(true);
    setBios([]);

    try {
      const name = profile?.display_name ?? displayName;
      const prompt = `Write optimized profile bios for ${name} for LinkedIn and X (Twitter). Character limits: LinkedIn 220, X 160. Bio must convey the key facts from their profile. Voice: punchy, specific, no fluff.\n\nProfile facts: ${bioFacts}\n\nReturn ONLY a JSON array with objects like: [{"platform":"LinkedIn","bio":"...","limit":220},{"platform":"X (Twitter)","bio":"...","limit":160}]`;

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) throw new Error("Generation failed");

      const { text } = await res.json();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed: BioCard[] = JSON.parse(jsonMatch[0]);
        setBios(parsed);
      }
    } catch (err) {
      console.error("[Settings] Bio generation error:", err);
    } finally {
      setBioGenerating(false);
    }
  }

  /* ---- Render ---- */

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-text-secondary" />
      </div>
    );
  }

  const pillarOptions = pillars.map((p) => p.name).filter(Boolean);

  // Unipile hosted connect returns here with ?error=unipile_failed on failure.
  const connectError =
    searchParams.get('error') === 'unipile_failed'
      ? 'Could not connect to Unipile. Try again, or add your API keys manually below.'
      : null;

  return (
    <div className="page-shell space-y-6">
      <PageHeader eyebrow="SETTINGS" title="Settings" subtitle="Profile, connected accounts, and how Content OS writes for you." />

      {/* Tab bar */}
      <div className="flex gap-1 bg-bg-tertiary rounded-[10px] p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-2 rounded-md text-[13px] font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-bg-secondary text-text-primary shadow-card'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'connections' && (
        <>
          {integrationNotice && (
            <div
              className={`rounded-lg border p-4 text-sm ${
                integrationNotice.type === 'success'
                  ? 'border-[#10B981]/30 bg-[rgba(16,185,129,0.08)] text-[#10B981]'
                  : 'border-coral/30 bg-coral/5 text-coral'
              }`}
            >
              {integrationNotice.message}
            </div>
          )}

          <Section title="Platform Connections">
            {/* Social Media */}
            <SubHeader>Social Media</SubHeader>
            {unipileConfigured === false && (
              <div className="mb-4 rounded-lg border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
                Unipile is not configured on this deployment. Add{' '}
                <code className="text-xs">UNIPILE_API_KEY</code> and{' '}
                <code className="text-xs">UNIPILE_DSN</code> to hosting secrets, then redeploy.
              </div>
            )}
            <PlatformConnections
              connectedAccounts={connectedAccounts}
              onDisconnect={disconnectAccount}
              disconnecting={disconnecting}
              onAccountsRefresh={refreshAccounts}
              connectError={connectError}
            />

            {/* Email */}
            <div className="border-t border-hair my-6" />
            <SubHeader>Email</SubHeader>
            {composioConfigured === false && (
              <div className="mb-4 rounded-lg border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
                Composio is not configured on this deployment. Add{' '}
                <code className="text-xs">COMPOSIO_API_KEY</code>, auth config IDs, and{' '}
                <code className="text-xs">NEXT_PUBLIC_APP_URL</code> to hosting secrets, then redeploy.
              </div>
            )}
            <GmailConnectionCard refreshKey={integrationsRefreshKey} />

            {/* Calendar */}
            <div className="border-t border-hair my-6" />
            <SubHeader>Calendar</SubHeader>
            <CalendarConnectionCard refreshKey={integrationsRefreshKey} />
          </Section>

          <Section title="Platform Defaults">
            <PlatformDefaults
              defaultPlatform={defaultPlatform}
              onDefaultPlatformChange={setDefaultPlatform}
              crossPostReminders={crossPostReminders}
              onCrossPostRemindersChange={setCrossPostReminders}
              onSave={savePlatformDefaults}
              saving={platformDefaultsSaving}
              saved={platformDefaultsSaved}
            />
          </Section>
        </>
      )}

      {activeTab === 'billing' && (
        <Section title="Plan & billing">
          {entitlements ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-[10px] bg-bg-tertiary border border-border">
                <div>
                  <p className="text-[13px] text-text-primary font-medium capitalize">{entitlements.plan} plan</p>
                  <p className="text-[11px] text-text-secondary mt-1">
                    {entitlements.usage.publishes} / {entitlements.limits.publishesPerMonth} publishes this month
                  </p>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-[3px] ${
                    entitlements.isPaid
                      ? 'bg-sage-light text-accent-secondary'
                      : 'bg-bg-tertiary text-text-secondary'
                  }`}
                >
                  {entitlements.isPaid ? 'Active' : 'Free'}
                </span>
              </div>
              {!entitlements.isPaid && (
                <a
                  href="/pricing"
                  className="inline-block px-4 py-2 text-[12px] text-text-inverse bg-accent-primary rounded-md hover:bg-accent-dark transition-colors"
                >
                  Upgrade to publish
                </a>
              )}
              {entitlements.isPaid && (
                <button
                  type="button"
                  disabled={billingLoading}
                  onClick={openBillingPortal}
                  className="px-4 py-2 text-[12px] text-text-primary border border-border rounded-md hover:border-border-hover disabled:opacity-60"
                >
                  {billingLoading ? 'Opening…' : 'Manage subscription'}
                </button>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-text-secondary">Loading billing…</p>
          )}
        </Section>
      )}

      {activeTab === 'profile' && (
        <>
          <Section title="Profile Editor">
            <ProfileEditor
              displayName={displayName}
              onDisplayNameChange={setDisplayName}
              bioFacts={bioFacts}
              onBioFactsChange={setBioFacts}
              voiceDescription={voiceDescription}
              onVoiceDescriptionChange={setVoiceDescription}
              voiceRules={voiceRules}
              onVoiceRulesChange={setVoiceRules}
              pillars={pillars}
              onPillarsChange={setPillars}
              onSave={saveProfile}
              saving={profileSaving}
              saved={profileSaved}
            />
            {profileError && (
              <p className="mt-3 text-sm text-accent-primary">{profileError}</p>
            )}
          </Section>

          <Section title="Personal Context">
            <ContextEditor
              contextAdditions={contextAdditions}
              onContextChange={setContextAdditions}
              onSave={saveContext}
              saving={contextSaving}
              saved={contextSaved}
            />
          </Section>
        </>
      )}

      {activeTab === 'content' && (
        <>
          <Section title="Voice">
            <VoiceDefaultToggle />
          </Section>

          <Section title="Pillar Weights">
            <PillarWeights
              pillars={pillars}
              pillarWeights={pillarWeights}
              onWeightChange={setPillarWeights}
              onSave={savePillarWeights}
              saving={weightsSaving}
              saved={weightsSaved}
            />
          </Section>

          <Section title="Weekly Schedule Template">
            <WeeklySchedule
              weeklySchedule={weeklySchedule}
              onScheduleChange={setWeeklySchedule}
              pillarOptions={pillarOptions}
              onSave={saveWeeklySchedule}
              saving={scheduleSaving}
              saved={scheduleSaved}
            />
          </Section>

          <Section title="Auto-Optimize">
            <AutoOptimizeToggle
              enabled={autoOptimize}
              onChange={setAutoOptimize}
              onSave={saveAutoOptimize}
              saving={autoOptimizeSaving}
              saved={autoOptimizeSaved}
            />
          </Section>
        </>
      )}

      {activeTab === 'tools' && (
        <>
          <Section title="Agent access">
            <AgentAccessCard />
          </Section>
          <Section title="Hook mining watchlist">
            <HookWatchlistEditor />
          </Section>
          <Section title="Profile Bio Generator">
            <BioGenerator
              bioGenerating={bioGenerating}
              bios={bios}
              onGenerate={generateBios}
              onBiosChange={setBios}
            />
          </Section>
        </>
      )}
    </div>
  );
}
