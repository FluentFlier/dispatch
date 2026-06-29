"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getInsforgeClient } from "@/lib/insforge/client";
import { getClientTokens } from "@/lib/auth-client";

/**
 * Sync access + refresh tokens into httpOnly cookies via /api/auth.
 *
 * Strategy (in order):
 * 1. refreshSession() — official SDK call, guaranteed to return both tokens when it works.
 *    May fail immediately after OAuth (SDK not yet fully initialized).
 * 2. getClientTokens() — reads SDK internals; reliably gets the access token, may get
 *    the refresh token depending on where the SDK stored it after the OAuth exchange.
 *
 * Even if only the access token is synced (no refresh token), login succeeds.
 * The refresh token path is the fix for forced re-login every ~1 hour.
 */
async function syncTokenToCookie(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = getInsforgeClient();

    // Path 1: refreshSession() — gives both tokens reliably when SDK is ready.
    try {
      const { data, error } = await client.auth.refreshSession();
      if (!error && data?.accessToken) {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            token: data.accessToken,
            refreshToken: (data as { refreshToken?: string }).refreshToken ?? null,
          }),
        });
        if (res.ok) return true;
      }
    } catch {
      /* fall through to SDK-internal path */
    }

    // Path 2: SDK internals fallback — access token always present, refresh token best-effort.
    const { accessToken, refreshToken } = getClientTokens(client);
    if (accessToken) {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ token: accessToken, refreshToken }),
        });
        if (res.ok) return true;
      } catch {
        /* retry */
      }
    }

    await new Promise((r) => setTimeout(r, (attempt + 1) * 300));
  }
  return false;
}

async function finishSessionSync(): Promise<boolean> {
  const synced = await syncTokenToCookie();
  if (!synced) return false;

  const res = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) return false;
  const session = (await res.json()) as { authenticated?: boolean };
  return Boolean(session.authenticated);
}

export default function LoginPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Checking session...");

  useEffect(() => {
    handleAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAuth() {
    // IMPORTANT: read URL params BEFORE constructing the InsForge client.
    // SDK's detectAuthCallback() strips ?insforge_code from the URL synchronously
    // in the constructor, so by the time getInsforgeClient() returns the param is gone.
    const params = new URLSearchParams(window.location.search);
    const hasOAuthCode = params.has("insforge_code");

    const client = getInsforgeClient();

    if (hasOAuthCode) {
      setStatus("Completing sign-in...");
      // authCallbackHandled is the SDK promise that exchanges the code for tokens.
      // It resolves (or rejects) when the PKCE exchange is done.
      const authReady = (client.auth as unknown as { authCallbackHandled?: Promise<void> }).authCallbackHandled;
      if (authReady) {
        try {
          await authReady;
        } catch {
          /* exchange error — fall through to getCurrentUser check */
        }
      }

      // Small buffer to allow token propagation into http.refreshToken
      await new Promise((r) => setTimeout(r, 300));

      try {
        const { data } = await client.auth.getCurrentUser();
        if (data?.user) {
          setStatus("Syncing session...");
          const synced = await finishSessionSync();
          if (!synced) {
            setError("Sign-in completed, but the app could not create your session. Please try again.");
            setReady(true);
            return;
          }
          window.location.replace("/dashboard");
          return;
        }
      } catch {
        /* fall through */
      }

      setError("Sign-in failed. Please try again.");
      window.history.replaceState(null, "", "/login");
      setReady(true);
      return;
    }

    try {
      const { data } = await client.auth.getCurrentUser();
      if (data?.user) {
        setStatus("Syncing session...");
        const synced = await finishSessionSync();
        if (synced) {
          window.location.replace("/dashboard");
          return;
        }
      }
    } catch {
      /* no browser session */
    }

    try {
      const res = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const session = (await res.json()) as { authenticated?: boolean };
      if (session.authenticated) {
        setStatus("Syncing session...");
        window.location.replace("/dashboard");
        return;
      }
    } catch {
      /* no session */
    }

    if (params.get("expired") === "1") {
      setError("Your session expired. Please sign in again.");
      window.history.replaceState(null, "", "/login");
    } else if (params.has("error")) {
      setError("Sign-in failed. Please try again.");
      window.history.replaceState(null, "", "/login");
    }

    setReady(true);
  }

  async function signInWith(provider: "google" | "github") {
    setError("");
    try {
      const client = getInsforgeClient();
      const { error: err } = await client.auth.signInWithOAuth({
        provider,
        redirectTo: `${window.location.origin}/login`,
      });
      if (err) setError(err.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col lg:flex-row">
      <div className="hidden lg:flex lg:w-[42%] flex-col justify-between p-12 bg-bg-tertiary border-r border-border">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-primary mb-4">
            Content OS
          </p>
          <h1 className="text-3xl font-semibold text-text-primary leading-tight tracking-tight">
            Write, schedule, and reply, all in one calm place.
          </h1>
          <p className="text-[15px] text-text-secondary mt-4 max-w-sm leading-relaxed">
            Built for everyday creators. No jargon, no juggling five apps. Just your voice and your posts.
          </p>
        </div>
        <blockquote className="border-l-2 border-accent-primary/40 pl-4">
          <p className="text-sm text-text-secondary italic leading-relaxed">
            &ldquo;I stopped copy-pasting into four apps. Everything lives here now.&rdquo;
          </p>
          <footer className="text-xs text-text-tertiary mt-2">Beta creator</footer>
        </blockquote>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-[400px]">
          {!ready ? (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-text-secondary mt-4">{status}</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-8 lg:text-left">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-primary mb-2 lg:hidden">
                  Content OS
                </p>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">
                  Sign in
                </h2>
                <p className="text-[15px] text-text-secondary mt-2">
                  Use Google or GitHub. Takes about 10 seconds.
                </p>
              </div>

              <div className="space-y-3">
                <OAuthButton label="Continue with Google" onClick={() => signInWith("google")} icon="google" />
                <OAuthButton label="Continue with GitHub" onClick={() => signInWith("github")} icon="github" />
              </div>

              {error && (
                <div className="mt-4 px-4 py-3 rounded-md text-sm text-red-800 bg-red-50 border border-red-200">
                  {error}
                </div>
              )}

              <p className="text-center text-xs text-text-tertiary mt-8">
                By continuing, you agree to our terms.{" "}
                <Link href="/pricing" className="text-accent-primary hover:text-accent-dark font-medium">
                  View plans
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OAuthButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: "google" | "github";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-center gap-3 rounded-md py-3.5 min-h-[52px] text-[15px] font-medium text-text-primary bg-bg-secondary border border-border hover:border-border-hover hover:shadow-card transition-all"
    >
      {icon === "google" ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#1C1917" aria-hidden>
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
      )}
      {label}
    </button>
  );
}
