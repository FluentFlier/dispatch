'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Zap } from 'lucide-react';

const PLANS = [
  {
    id: 'starter' as const,
    name: 'Starter',
    price: '$19',
    description: 'Solo creators shipping consistently',
    features: ['3 connected accounts', '60 publishes / month', 'Reliable scheduling', 'Publish status timeline'],
  },
  {
    id: 'growth' as const,
    name: 'Growth',
    price: '$49',
    description: 'Growing creators across platforms',
    popular: true,
    features: ['10 connected accounts', '300 publishes / month', 'Priority retries', 'Usage dashboard'],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$99',
    description: 'Agencies and power users',
    features: ['30 connected accounts', '1,500 publishes / month', 'Team-ready limits', 'Concierge onboarding'],
  },
];

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function checkout(plan: 'starter' | 'growth' | 'pro') {
    setLoading(plan);
    setError('');
    try {
      const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' });
      const session = (await sessionRes.json()) as { authenticated?: boolean };
      if (!session.authenticated) {
        window.location.href = '/login';
        return;
      }

      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Checkout failed');
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      setError('Network error');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="max-w-5xl mx-auto px-5 py-16">
        <div className="text-center mb-12">
          <Link href="/" className="text-[12px] text-accent-primary hover:text-accent-dark mb-6 inline-block">
            ← Dispatch
          </Link>
          <h1
            className="text-[36px] tracking-[-0.03em] mb-3 text-text-primary"
            style={{ fontFamily: "'Instrument Serif', serif" }}
          >
            Publish everywhere. Bill once.
          </h1>
          <p className="text-[15px] text-text-secondary max-w-lg mx-auto">
            Connect once, schedule reliably, and see every post&apos;s delivery status in one timeline.
          </p>
        </div>

        {error && (
          <p className="text-center text-[13px] text-accent-dark mb-6 px-4 py-2 rounded-lg bg-coral-light border border-accent-primary/30">
            {error}
          </p>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-2xl p-6 border shadow-card ${
                plan.popular
                  ? 'border-accent-primary/40 bg-coral-light'
                  : 'border-border bg-bg-secondary'
              }`}
            >
              {plan.popular && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-accent-primary mb-3">
                  <Zap size={12} /> Most popular
                </span>
              )}
              <h2 className="text-[18px] font-semibold text-text-primary">{plan.name}</h2>
              <p className="text-[28px] font-medium mt-1 text-text-primary">
                {plan.price}
                <span className="text-[13px] text-text-secondary font-normal">/mo</span>
              </p>
              <p className="text-[13px] text-text-secondary mt-2 mb-5">{plan.description}</p>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-text-tertiary">
                    <Check size={14} className="text-accent-secondary shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={!!loading}
                onClick={() => checkout(plan.id)}
                className={`w-full py-3 rounded-xl text-[14px] font-medium transition-colors flex items-center justify-center gap-2 ${
                  plan.popular
                    ? 'bg-accent-primary hover:bg-accent-dark text-text-inverse shadow-soft'
                    : 'bg-bg-tertiary hover:bg-bg-elevated text-text-primary border border-border'
                }`}
              >
                {loading === plan.id && <Loader2 size={14} className="animate-spin" />}
                Start {plan.name}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-[12px] text-text-tertiary mt-10">
          Free tier includes drafts and previews. Publishing requires a paid plan.{' '}
          <Link href="/login" className="text-accent-primary hover:text-accent-dark hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
