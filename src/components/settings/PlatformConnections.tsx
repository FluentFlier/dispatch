"use client";

import { useState } from "react";
import { DASHBOARD_PLATFORMS } from "@/lib/constants";
import {
  Eye,
  EyeOff,
  Check,
  Unplug,
  Loader2,
  KeyRound,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

interface ConnectedAccount {
  id: string;
  platform: string;
  account_name: string | null;
  account_id: string | null;
  connected_at: string;
  connection_method?: string | null;
}

interface PlatformConnectionsProps {
  connectedAccounts: ConnectedAccount[];
  onDisconnect: (platform: string) => void;
  disconnecting: string | null;
  onAccountsRefresh: () => void;
  /** Inline error surfaced after a failed Unipile connect redirect. */
  connectError?: string | null;
}

// Brand marks rendered as letter tiles — white on the platform's brand color.
const PLATFORM_META: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  instagram: { label: "Instagram", color: "#E4405F", icon: "IG" },
  linkedin: { label: "LinkedIn", color: "#0A66C2", icon: "in" },
  twitter: { label: "X / Twitter", color: "#000000", icon: "\u{1D54F}" },
  threads: { label: "Threads", color: "#000000", icon: "@" },
};

const BYOK_FIELDS: Record<string, [string, string][]> = {
  twitter: [
    ["api_key", "API Key"],
    ["api_secret", "API Secret"],
    ["access_token", "Access Token"],
    ["access_token_secret", "Access Token Secret"],
  ],
  linkedin: [["access_token", "Access Token"]],
  instagram: [["access_token", "Access Token"]],
  threads: [["access_token", "Access Token"]],
};

type ByokState = Record<string, Record<string, string>>;

export default function PlatformConnections({
  connectedAccounts,
  onDisconnect,
  disconnecting,
  onAccountsRefresh,
  connectError = null,
}: PlatformConnectionsProps) {
  const [unipileLoading, setUnipileLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [byokValues, setByokValues] = useState<ByokState>({});
  const [savingPlatform, setSavingPlatform] = useState<string | null>(null);
  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { valid: boolean; message: string } | null>>({});
  const [saveError, setSaveError] = useState<Record<string, string | null>>({});

  function getConnectionStatus(platform: string): "oauth" | "byok" | "none" {
    const account = connectedAccounts.find((a) => a.platform === platform);
    if (!account) return "none";
    if (account.connection_method === "byok") return "byok";
    return "oauth";
  }

  function updateByokField(platform: string, field: string, value: string) {
    setByokValues((prev) => ({
      ...prev,
      [platform]: { ...(prev[platform] ?? {}), [field]: value },
    }));
  }

  async function handleSaveKeys(platform: string) {
    const creds = byokValues[platform] ?? {};
    const fields = BYOK_FIELDS[platform] ?? [];
    const missing = fields.filter(([key]) => !creds[key]?.trim());
    if (missing.length > 0) {
      setSaveError((prev) => ({
        ...prev,
        [platform]: `Missing: ${missing.map(([, label]) => label).join(", ")}`,
      }));
      return;
    }

    setSavingPlatform(platform);
    setSaveError((prev) => ({ ...prev, [platform]: null }));

    try {
      const res = await fetch("/api/social-accounts/byok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, credentials: creds }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveError((prev) => ({ ...prev, [platform]: data.error ?? "Save failed" }));
      } else {
        setSaveError((prev) => ({ ...prev, [platform]: null }));
        setByokValues((prev) => ({ ...prev, [platform]: {} }));
        onAccountsRefresh();
      }
    } catch {
      setSaveError((prev) => ({ ...prev, [platform]: "Network error" }));
    } finally {
      setSavingPlatform(null);
    }
  }

  async function handleTestConnection(platform: string) {
    const creds = byokValues[platform] ?? {};
    const fields = BYOK_FIELDS[platform] ?? [];
    const missing = fields.filter(([key]) => !creds[key]?.trim());
    if (missing.length > 0) {
      setTestResult((prev) => ({
        ...prev,
        [platform]: { valid: false, message: `Missing: ${missing.map(([, label]) => label).join(", ")}` },
      }));
      return;
    }

    setTestingPlatform(platform);
    setTestResult((prev) => ({ ...prev, [platform]: null }));

    try {
      const res = await fetch("/api/social-accounts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, credentials: creds }),
      });

      const data = await res.json().catch(() => ({ valid: false, error: "Test failed" }));
      if (data.valid) {
        const name = data.profile?.name ?? "";
        const username = data.profile?.username ?? "";
        setTestResult((prev) => ({
          ...prev,
          [platform]: { valid: true, message: `Connected as ${name} (@${username})` },
        }));
      } else {
        setTestResult((prev) => ({
          ...prev,
          [platform]: { valid: false, message: data.error ?? "Invalid credentials" },
        }));
      }
    } catch {
      setTestResult((prev) => ({
        ...prev,
        [platform]: { valid: false, message: "Network error" },
      }));
    } finally {
      setTestingPlatform(null);
    }
  }

  function connectAllViaUnipile() {
    setUnipileLoading(true);
    // Full-page redirect to the Unipile hosted flow. On failure Unipile returns
    // to /settings?tab=connections&error=unipile_failed, surfaced via connectError.
    window.location.href = '/api/social-accounts/connect/unipile?return=settings';
  }

  async function syncFromUnipile() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/social-accounts/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSyncResult(data.synced > 0 ? `Synced ${data.synced} account(s)` : 'No accounts found in Unipile');
        onAccountsRefresh();
      } else {
        setSyncResult(data.error ?? 'Sync failed');
      }
    } catch {
      setSyncResult('Network error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      {/* Primary connect: Unipile hosted flow links all social platforms at once. */}
      <div className="mb-6 p-4 rounded-lg border border-accent-primary/25 bg-coral-light">
        <p className="text-[13px] text-text-primary font-medium mb-1">Connect all platforms at once</p>
        <p className="text-[11px] text-text-secondary mb-3">
          Powered by Unipile. Link LinkedIn and X in one secure flow.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={unipileLoading}
            onClick={connectAllViaUnipile}
            className="px-4 py-2 text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 disabled:opacity-60 flex items-center gap-2"
          >
            {unipileLoading && <Loader2 size={12} className="animate-spin" />}
            Connect accounts
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={syncFromUnipile}
            className="px-4 py-2 text-[12px] text-text-primary border border-border rounded-md hover:border-border-hover disabled:opacity-60 flex items-center gap-2 transition-colors"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync from Unipile'}
          </button>
        </div>
        {/* Inline failure — no fallback UI swap, no raw JSON page. */}
        {connectError && (
          <div className="mt-3 flex items-start gap-2 text-[11px] text-coral">
            <AlertCircle size={13} className="mt-px shrink-0" />
            <span>{connectError}</span>
          </div>
        )}
        {syncResult && (
          <p className="text-[11px] text-text-secondary mt-2">{syncResult}</p>
        )}
      </div>

      {/* Per-platform status grid. Tap a tile to see status or add manual keys. */}
      <div className="flex flex-wrap gap-x-6 gap-y-5">
        {DASHBOARD_PLATFORMS.map((platform) => {
          const meta = PLATFORM_META[platform];
          if (!meta) return null;
          const status = getConnectionStatus(platform);
          const isConnected = status !== "none";
          const isExpanded = expandedPlatform === platform;

          return (
            <button
              key={platform}
              type="button"
              onClick={() => setExpandedPlatform(isExpanded ? null : platform)}
              className="group flex flex-col items-center gap-2 w-[72px] focus:outline-none"
              aria-expanded={isExpanded}
              aria-label={`${meta.label} — ${isConnected ? "connected" : "not connected"}`}
            >
              <span className="relative">
                <span
                  className={`w-14 h-14 rounded-[16px] flex items-center justify-center text-[18px] font-bold text-white shadow-card transition-all duration-150 group-hover:-translate-y-0.5 ${
                    isExpanded ? "ring-2 ring-accent-primary ring-offset-2 ring-offset-bg-secondary" : "ring-1 ring-black/5"
                  }`}
                  style={{ backgroundColor: meta.color }}
                >
                  {meta.icon}
                </span>
                {isConnected && (
                  <span className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-[#10B981] flex items-center justify-center ring-2 ring-bg-secondary">
                    <Check size={11} className="text-white" strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="text-[11px] text-text-primary text-center leading-tight">
                {meta.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Detail panel for the expanded platform: status + manual-key backup. */}
      {expandedPlatform && PLATFORM_META[expandedPlatform] && (
        <PlatformDetail
          platform={expandedPlatform}
          meta={PLATFORM_META[expandedPlatform]}
          account={connectedAccounts.find((a) => a.platform === expandedPlatform) ?? null}
          status={getConnectionStatus(expandedPlatform)}
          disconnecting={disconnecting === expandedPlatform}
          onDisconnect={() => onDisconnect(expandedPlatform)}
          byokValues={byokValues[expandedPlatform] ?? {}}
          onFieldChange={(field, value) => updateByokField(expandedPlatform, field, value)}
          onSaveKeys={() => handleSaveKeys(expandedPlatform)}
          onTestConnection={() => handleTestConnection(expandedPlatform)}
          saving={savingPlatform === expandedPlatform}
          testing={testingPlatform === expandedPlatform}
          testResult={testResult[expandedPlatform] ?? null}
          saveError={saveError[expandedPlatform] ?? null}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PlatformDetail({
  platform,
  meta,
  account,
  status,
  disconnecting,
  onDisconnect,
  byokValues,
  onFieldChange,
  onSaveKeys,
  onTestConnection,
  saving,
  testing,
  testResult,
  saveError,
}: {
  platform: string;
  meta: { label: string; color: string; icon: string };
  account: ConnectedAccount | null;
  status: "oauth" | "byok" | "none";
  disconnecting: boolean;
  onDisconnect: () => void;
  byokValues: Record<string, string>;
  onFieldChange: (field: string, value: string) => void;
  onSaveKeys: () => void;
  onTestConnection: () => void;
  saving: boolean;
  testing: boolean;
  testResult: { valid: boolean; message: string } | null;
  saveError: string | null;
}) {
  return (
    <div className="mt-5 rounded-lg border border-border p-4 space-y-4">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <span
          className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[13px] font-bold text-white shrink-0"
          style={{ backgroundColor: meta.color }}
        >
          {meta.icon}
        </span>
        <span className="text-[13px] font-medium text-text-primary">{meta.label}</span>
        <StatusBadge status={status} />
        {status !== "none" && (
          <button
            type="button"
            disabled={disconnecting}
            onClick={onDisconnect}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 text-[11px] text-text-tertiary border border-border rounded-[6px] hover:border-border-hover transition-colors disabled:opacity-60"
          >
            <Unplug size={12} />
            {disconnecting ? "..." : "Disconnect"}
          </button>
        )}
      </div>

      {status === "oauth" && (
        <div className="flex items-center gap-2">
          <Check size={14} className="text-[#3B6D11]" />
          <span className="text-[12px] text-[#3B6D11]">
            Connected{account?.account_name ? ` as ${account.account_name}` : ""} via Unipile
          </span>
        </div>
      )}

      {status === "none" && (
        <p className="text-[11px] text-text-secondary">
          Use <span className="font-medium text-text-primary">Connect accounts</span> above to link via Unipile.
          If that fails, add your own API keys below as a backup.
        </p>
      )}

      {/* Manual API keys — backup path when Unipile can't connect. */}
      <ByokSection
        platform={platform}
        byokValues={byokValues}
        onFieldChange={onFieldChange}
        onSaveKeys={onSaveKeys}
        onTestConnection={onTestConnection}
        saving={saving}
        testing={testing}
        testResult={testResult}
        saveError={saveError}
        isByokConnected={status === "byok"}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: "oauth" | "byok" | "none" }) {
  if (status === "oauth") {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-[3px] bg-[rgba(16,185,129,0.15)] text-[#10B981]">
        Connected
      </span>
    );
  }
  if (status === "byok") {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-[3px] bg-[rgba(139,92,246,0.15)] text-[#8B5CF6]">
        Manual Keys
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-[3px] bg-bg-tertiary text-text-secondary">
      Not connected
    </span>
  );
}

function ByokSection({
  platform,
  byokValues,
  onFieldChange,
  onSaveKeys,
  onTestConnection,
  saving,
  testing,
  testResult,
  saveError,
  isByokConnected,
}: {
  platform: string;
  byokValues: Record<string, string>;
  onFieldChange: (field: string, value: string) => void;
  onSaveKeys: () => void;
  onTestConnection: () => void;
  saving: boolean;
  testing: boolean;
  testResult: { valid: boolean; message: string } | null;
  saveError: string | null;
  isByokConnected: boolean;
}) {
  const fields = BYOK_FIELDS[platform] ?? [];

  return (
    <div className="border-t border-hair pt-4">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound size={12} className="text-text-secondary" />
        <span className="text-[10px] font-medium tracking-[0.10em] uppercase text-text-secondary">
          USE API KEYS
        </span>
      </div>
      <p className="text-[11px] text-text-secondary mb-3">
        Enter your own API credentials as a backup to Unipile.
      </p>

      {isByokConnected && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-[rgba(139,92,246,0.1)] rounded-md">
          <Check size={14} className="text-[#8B5CF6]" />
          <span className="text-[12px] text-[#8B5CF6]">
            Manual keys configured
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(([field, label]) => (
          <PasswordField
            key={field}
            label={label}
            value={byokValues[field] ?? ""}
            onChange={(v) => onFieldChange(field, v)}
          />
        ))}
      </div>

      {saveError && (
        <p className="text-[11px] text-red-400 mt-2">{saveError}</p>
      )}

      {testResult && (
        <p
          className={`text-[11px] mt-2 ${
            testResult.valid ? "text-[#10B981]" : "text-red-400"
          }`}
        >
          {testResult.message}
        </p>
      )}

      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          disabled={saving}
          onClick={onSaveKeys}
          className="px-4 py-2 min-h-[44px] text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {saving ? "Saving..." : "Save Keys"}
        </button>
        <button
          type="button"
          disabled={testing}
          onClick={onTestConnection}
          className="px-4 py-2 min-h-[44px] text-[12px] text-text-primary border border-border rounded-md hover:border-border-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {testing && <Loader2 size={12} className="animate-spin" />}
          {testing ? "Testing..." : "Test Connection"}
        </button>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="block text-xs text-text-secondary mb-1">{label}</label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
          className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 pr-10 text-sm font-mono text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-[44px] h-[44px] flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
          aria-label={visible ? "Hide" : "Show"}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
