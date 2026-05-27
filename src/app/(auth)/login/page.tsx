"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { getInsforgeClient } from "@/lib/insforge/client";
import { getClientAccessToken } from "@/lib/auth-client";

async function syncTokenToCookie(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = getInsforgeClient();
    const token = getClientAccessToken(client);
    if (token) {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (res.ok) return true;
      } catch {
        // retry
      }
    }
    await new Promise((r) => setTimeout(r, (attempt + 1) * 300));
  }
  return false;
}

export default function LoginPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Checking session...");
  const spotRef = useRef<HTMLDivElement>(null!);

  const move = useCallback((e: MouseEvent) => {
    if (spotRef.current) {
      spotRef.current.style.setProperty("--mx", `${e.clientX}px`);
      spotRef.current.style.setProperty("--my", `${e.clientY}px`);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [move]);

  useEffect(() => {
    handleAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAuth() {
    const client = getInsforgeClient();
    const params = new URLSearchParams(window.location.search);

    if (params.has("insforge_code")) {
      setStatus("Completing sign-in...");
      const authReady = (client.auth as unknown as { authCallbackHandled?: Promise<void> }).authCallbackHandled;
      if (authReady) {
        try {
          await authReady;
        } catch {
          /* handled below */
        }
      }
      await new Promise((r) => setTimeout(r, 600));

      try {
        const { data } = await client.auth.getCurrentUser();
        if (data?.user) {
          setStatus("Syncing session...");
          await syncTokenToCookie();
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
        const synced = await syncTokenToCookie();
        if (!synced) {
          setError("Session found but cookie sync failed. Try signing in again.");
          setReady(true);
          return;
        }
        window.location.replace("/dashboard");
        return;
      }
    } catch {
      /* no session */
    }

    if (params.has("error")) {
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
    <div
      ref={spotRef}
      className="relative min-h-screen overflow-hidden flex"
      style={{ background: "#050507", fontFamily: "'DM Sans', sans-serif" }}
    >
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Left: brand panel */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 border-r border-[#FAFAFA]/06 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]" style={{ background: "radial-gradient(circle at 30% 20%, #6366F1, transparent 55%)" }} />
        <div className="relative">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#818CF8] mb-4">Dispatch</p>
          <h1 className="text-[32px] text-[#FAFAFA] leading-[1.15] tracking-[-0.02em]" style={{ fontFamily: "'Instrument Serif', serif" }}>
            One place to publish everywhere.
          </h1>
          <p className="text-[14px] text-[#71717A] mt-4 max-w-sm">
            Connect your accounts once. Schedule with confidence. See delivery status and retries in a single timeline.
          </p>
        </div>
        <blockquote className="relative border-l-2 border-[#818CF8]/40 pl-4">
          <p className="text-[14px] text-[#A1A1AA] italic">
            &ldquo;I stopped copy-pasting into four apps. Dispatch is my command center now.&rdquo;
          </p>
          <footer className="text-[12px] text-[#52525B] mt-2">— Beta creator</footer>
        </blockquote>
      </div>

      {/* Right: sign-in */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-[400px]" style={{ animation: ready ? "fadeUp 0.5s ease-out" : undefined }}>
          {!ready ? (
            <div className="text-center">
              <div className="w-7 h-7 border-2 border-[#818CF8] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-[13px] text-[#71717A] mt-3">{status}</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-8 lg:text-left">
                <h2 className="text-[24px] text-[#FAFAFA] font-normal tracking-[-0.02em]" style={{ fontFamily: "'Instrument Serif', serif" }}>
                  Welcome back
                </h2>
                <p className="text-[14px] text-[#71717A] mt-2">Sign in to your command center</p>
              </div>

              <div className="space-y-3">
                <OAuthButton label="Continue with Google" onClick={() => signInWith("google")} icon="google" />
                <OAuthButton label="Continue with GitHub" onClick={() => signInWith("github")} icon="github" />
              </div>

              {error && (
                <div className="mt-4 px-3 py-2.5 rounded-lg text-[13px] text-[#FCA5A5] bg-red-500/10 border border-red-500/20">
                  {error}
                </div>
              )}

              <p className="text-center text-[11px] text-[#52525B] mt-6">
                By continuing, you agree to our terms.{" "}
                <Link href="/pricing" className="text-[#818CF8] hover:underline">
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
      className="w-full flex items-center justify-center gap-3 rounded-xl py-3.5 text-[14px] font-medium text-[#FAFAFA] bg-[#18181B] border border-[#FAFAFA]/10 hover:border-[#FAFAFA]/20 transition-colors"
    >
      {icon === "google" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#FAFAFA">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
      )}
      {label}
    </button>
  );
}
