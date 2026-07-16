'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Check, Loader2, Zap } from 'lucide-react';
import { PRODUCT_NAME } from '@/lib/brand';

const PLANS = [
  {
    id: 'starter' as const,
    name: 'Starter',
    price: '$19',
    description: 'Solo creators shipping consistently',
    features: ['3 connected accounts', '60 publishes / month', 'Reliable scheduling', 'Publish status timeline', 'Basic Hook Intelligence (limited)'],
  },
  {
    id: 'growth' as const,
    name: 'Growth',
    price: '$49',
    description: 'Growing creators across platforms',
    popular: true,
    features: ['10 connected accounts', '300 publishes / month', 'Priority retries', 'Usage dashboard', 'Full Research Lab + Hook Lab', 'Lead categorization insights'],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$99',
    description: 'Agencies and power users',
    features: ['30 connected accounts', '1,500 publishes / month', 'Team-ready limits', 'Concierge onboarding', 'Unlimited intelligence runs', 'Custom watchlists + Apify mining', 'Advanced RL + analytics snapshots'],
  },
];

export default function PricingPage() {
  const [trialExpired, setTrialExpired] = useState(false);
  const [checkoutCanceled, setCheckoutCanceled] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTrialExpired(params.get('trial') === 'expired');
    setCheckoutCanceled(params.get('checkout') === 'canceled');
  }, []);

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
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-10">
          <Link href="/" className="text-[12px] text-accent-primary hover:text-accent-dark inline-block">
            ← {PRODUCT_NAME}
          </Link>
          <h1 className="mt-6 text-[clamp(32px,5vw,48px)] font-semibold leading-[1.02] tracking-[-0.04em] text-text-primary">
            {trialExpired ? 'Keep publishing' : 'Simple pricing'}
          </h1>
          <p className="mt-3 max-w-xl text-[16px] leading-7 text-text-secondary">
            {trialExpired
              ? `Your trial ended. Pick a plan to stay in ${PRODUCT_NAME}.`
              : '7-day free trial, then from $19/mo. No card to start.'}
          </p>
          {!trialExpired && (
            <Link href="/get-started" className="btn-primary inline-flex mt-6">
              Start free trial
            </Link>
          )}
        </div>

        {checkoutCanceled && (
          <p className="text-center text-[14px] text-text-secondary mb-6 px-4 py-3 rounded-lg bg-bg-secondary border border-border">
            Checkout canceled - pick a plan when you&apos;re ready.
          </p>
        )}

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
          7-day free trial, then paid plans from $19/mo.{' '}
          <Link href="/login" className="text-accent-primary hover:text-accent-dark hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
