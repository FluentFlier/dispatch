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
  /** True while the post-connect sync verifies the bind - rows without an
      account show "Confirming connection…" instead of a Connect button. */
  confirming?: boolean;
}

// Brand marks rendered as letter tiles - white on the platform's brand color.
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
  confirming = false,
}: PlatformConnectionsProps) {
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [byokPlatform, setByokPlatform] = useState<string | null>(null);
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

  // Per-platform Unipile hosted connect. Full-page redirect to the hosted login;
  // on success Unipile returns to /settings?tab=connections&connected=true, on
  // failure to ?error=unipile_failed - both land back on this connections page.
  function connectPlatform(platform: string) {
    setConnectingPlatform(platform);
    window.location.href = `/api/social-accounts/connect/unipile?return=settings&provider=${platform}`;
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
        setByokPlatform(null);
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

  async function syncFromUnipile() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/social-accounts/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // The server distinguishes "Unipile really is empty" from "you are not
        // mid-connect, so there is nothing to bind" - collapsing both into
        // "No accounts found in Unipile" made a working connection look broken.
        setSyncResult(
          data.synced > 0
            ? `Synced ${data.synced} account(s)`
            : (data.message ?? 'Nothing to sync'),
        );
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
      {/* Inline failure - no fallback UI swap, no raw JSON page. */}
      {connectError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-coral/30 bg-coral/5 p-3 text-[12px] text-coral">
          <AlertCircle size={14} className="mt-px shrink-0" />
          <span>{connectError}</span>
        </div>
      )}

      {/* One row per platform: brand icon + name on the left, connect/status on the right. */}
      <div className="rounded-lg border border-border divide-y divide-hair">
        {DASHBOARD_PLATFORMS.map((platform) => {
          const meta = PLATFORM_META[platform];
          if (!meta) return null;
          const account = connectedAccounts.find((a) => a.platform === platform);
          const status = getConnectionStatus(platform);
          const isConnected = status !== "none";
          const isConnecting = connectingPlatform === platform;
          const isDisconnecting = disconnecting === platform;
          const showByok = byokPlatform === platform;

          return (
            <div key={platform}>
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Icon */}
                <span
                  className="w-10 h-10 rounded-[10px] flex items-center justify-center text-[15px] font-bold text-white shrink-0 ring-1 ring-black/5"
                  style={{ backgroundColor: meta.color }}
                >
                  {meta.icon}
                </span>

                {/* Name + status */}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-text-primary leading-tight">
                    {meta.label}
                  </p>
                  <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                    {isConnected ? (
                      <span className="text-[#3B6D11]">
                        Connected
                        {account?.account_name ? ` as ${account.account_name}` : ""}
                        {status === "byok" ? " (API keys)" : ""}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setByokPlatform(showByok ? null : platform)}
                        className="text-text-tertiary hover:text-text-secondary transition-colors inline-flex items-center gap-1"
                      >
                        <KeyRound size={11} />
                        {showByok ? "Hide API keys" : "Use API keys instead"}
                      </button>
                    )}
                  </p>
                </div>

                {/* Right action */}
                {isConnected ? (
                  <button
                    type="button"
                    disabled={isDisconnecting}
                    onClick={() => onDisconnect(platform)}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-text-tertiary border border-border rounded-[6px] hover:border-border-hover transition-colors disabled:opacity-60 shrink-0"
                  >
                    <Unplug size={12} />
                    {isDisconnecting ? "..." : "Disconnect"}
                  </button>
                ) : confirming ? (
                  /* Post-redirect: the bind isn't verified yet - never flash a
                     Connect button (or claim Connected) until sync confirms. */
                  <span className="flex items-center gap-2 px-4 py-1.5 text-[12px] text-text-secondary shrink-0">
                    <Loader2 size={12} className="animate-spin" />
                    Confirming connection…
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isConnecting}
                    onClick={() => connectPlatform(platform)}
                    className="flex items-center gap-2 px-4 py-1.5 text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 transition-colors disabled:opacity-60 shrink-0"
                  >
                    {isConnecting && <Loader2 size={12} className="animate-spin" />}
                    {isConnecting ? "Opening sign-in…" : "Connect"}
                  </button>
                )}
              </div>

              {/* Manual API keys - backup path, toggled from the row. */}
              {showByok && (
                <div className="px-4 pb-4">
                  <ByokSection
                    platform={platform}
                    byokValues={byokValues[platform] ?? {}}
                    onFieldChange={(field, value) => updateByokField(platform, field, value)}
                    onSaveKeys={() => handleSaveKeys(platform)}
                    onTestConnection={() => handleTestConnection(platform)}
                    saving={savingPlatform === platform}
                    testing={testingPlatform === platform}
                    testResult={testResult[platform] ?? null}
                    saveError={saveError[platform] ?? null}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Secondary: pull already-connected accounts from Unipile. */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={syncing}
          onClick={syncFromUnipile}
          className="flex items-center gap-2 text-[11px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
        >
          <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Sync from Unipile"}
        </button>
        {syncResult && <span className="text-[11px] text-text-secondary">{syncResult}</span>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

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
}) {
  const fields = BYOK_FIELDS[platform] ?? [];

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary/40 p-4">
      <p className="text-[11px] text-text-secondary mb-3">
        Enter your own API credentials as a backup to Unipile.
      </p>

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
          className="px-4 py-2 min-h-[40px] text-[12px] text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {saving ? "Saving..." : "Save Keys"}
        </button>
        <button
          type="button"
          disabled={testing}
          onClick={onTestConnection}
          className="px-4 py-2 min-h-[40px] text-[12px] text-text-primary border border-border rounded-md hover:border-border-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
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
