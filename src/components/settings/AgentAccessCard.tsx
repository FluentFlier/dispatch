"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Copy, Loader2, Trash2 } from "lucide-react";
import type { AgentScope } from "@/lib/agent-auth/types";

interface AgentKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: AgentScope[];
  last_used_at: string | null;
  created_at: string;
}

const SCOPE_OPTIONS: { id: AgentScope; label: string; hint: string }[] = [
  { id: "read", label: "Read", hint: "List posts, inbox, signals" },
  { id: "write", label: "Write", hint: "Generate content, draft replies" },
  { id: "publish", label: "Publish", hint: "Post or schedule to connected accounts" },
  { id: "outreach", label: "Outreach", hint: "Send signal DMs (use carefully)" },
];

/**
 * Settings card for minting and revoking Content OS agent API keys.
 */
export default function AgentAccessCard() {
  const [keys, setKeys] = useState<AgentKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [name, setName] = useState("My agent");
  const [scopes, setScopes] = useState<AgentScope[]>(["read", "write"]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const appUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "";

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/keys");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load keys");
      setKeys(body.keys ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const toggleScope = (scope: AgentScope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const createKey = async () => {
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const res = await fetch("/api/agent/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create key");
      setNewKey(body.api_key as string);
      setKeys((prev) => [body.key as AgentKeyRow, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    setRevoking(id);
    setError(null);
    try {
      const res = await fetch(`/api/agent/keys/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to revoke key");
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setRevoking(null);
    }
  };

  const copyKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copySkillUrl = async () => {
    await navigator.clipboard.writeText(`${appUrl}/api/agent/v1/skill`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-accent-purple/12 flex items-center justify-center">
          <Bot className="w-4 h-4 text-accent-purple" />
        </div>
        <div>
          <p className="text-sm text-text-primary font-medium">
            Connect Claude, Cursor, or custom agents
          </p>
          <p className="text-xs text-text-secondary mt-1 max-w-xl">
            API keys let agents generate content, manage your library, sync comments, and
            triage Signals. Publish and outreach scopes are opt-in for safety.
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-accent-primary" role="alert">
          {error}
        </p>
      )}

      <div className="rounded-lg border border-border bg-bg-primary p-4 space-y-3">
        <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
          New key
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name"
          className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SCOPE_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover:border-accent-purple/40"
            >
              <input
                type="checkbox"
                checked={scopes.includes(opt.id)}
                onChange={() => toggleScope(opt.id)}
                className="mt-0.5"
              />
              <span>
                <span className="text-xs font-medium text-text-primary block">{opt.label}</span>
                <span className="text-[10px] text-text-secondary">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void createKey()}
          disabled={creating || !name.trim() || scopes.length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-accent-purple px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating && <Loader2 className="w-4 h-4 animate-spin" />}
          Create API key
        </button>
      </div>

      {newKey && (
        <div className="rounded-lg border border-accent-green/40 bg-accent-green/5 p-4 space-y-2">
          <p className="text-sm font-medium text-text-primary">Copy your key now</p>
          <p className="text-xs text-text-secondary">
            This secret is shown once. Store it in your agent env as{" "}
            <code className="text-accent-green">CONTENT_OS_API_KEY</code>.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 truncate rounded bg-bg-secondary px-3 py-2 text-xs text-text-primary">
              {newKey}
            </code>
            <button
              type="button"
              onClick={() => void copyKey()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs"
            >
              <Copy className="w-3 h-3" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
            Agent skill doc
          </p>
          <button
            type="button"
            onClick={() => void copySkillUrl()}
            className="text-xs text-accent-purple hover:underline"
          >
            Copy skill URL
          </button>
        </div>
        <p className="text-xs text-text-secondary">
          Point your agent at{" "}
          <code className="text-text-primary">{appUrl}/api/agent/v1/skill</code> for setup
          instructions and example curl commands.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
          Active keys
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-text-secondary">No agent keys yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-text-primary">{key.name}</p>
                  <p className="text-xs text-text-secondary">
                    {key.key_prefix}… · {key.scopes.join(", ")}
                    {key.last_used_at
                      ? ` · used ${new Date(key.last_used_at).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void revokeKey(key.id)}
                  disabled={revoking === key.id}
                  className="text-text-secondary hover:text-accent-primary p-1"
                  aria-label={`Revoke ${key.name}`}
                >
                  {revoking === key.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
