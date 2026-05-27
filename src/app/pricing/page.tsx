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
    <div className="min-h-screen bg-[#050507] text-[#FAFAFA]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="max-w-5xl mx-auto px-5 py-16">
        <div className="text-center mb-12">
          <Link href="/" className="text-[12px] text-[#818CF8] hover:text-[#A5B4FC] mb-6 inline-block">
            ← Dispatch
          </Link>
          <h1
            className="text-[36px] tracking-[-0.03em] mb-3"
            style={{ fontFamily: "'Instrument Serif', serif" }}
          >
            Publish everywhere. Bill once.
          </h1>
          <p className="text-[15px] text-[#71717A] max-w-lg mx-auto">
            Connect once, schedule reliably, and see every post&apos;s delivery status in one timeline.
          </p>
        </div>

        {error && (
          <p className="text-center text-[13px] text-[#FCA5A5] mb-6 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            {error}
          </p>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-2xl p-6 border ${
                plan.popular
                  ? 'border-[#818CF8]/40 bg-[rgba(129,140,248,0.06)]'
                  : 'border-[#FAFAFA]/10 bg-[rgba(255,255,255,0.02)]'
              }`}
            >
              {plan.popular && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#818CF8] mb-3">
                  <Zap size={12} /> Most popular
                </span>
              )}
              <h2 className="text-[18px] font-semibold">{plan.name}</h2>
              <p className="text-[28px] font-medium mt-1">
                {plan.price}
                <span className="text-[13px] text-[#71717A] font-normal">/mo</span>
              </p>
              <p className="text-[13px] text-[#71717A] mt-2 mb-5">{plan.description}</p>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-[#A1A1AA]">
                    <Check size={14} className="text-[#10B981] shrink-0 mt-0.5" />
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
                    ? 'bg-[#6366F1] hover:bg-[#5558E3] text-white'
                    : 'bg-[#18181B] hover:bg-[#27272A] text-[#FAFAFA] border border-[#FAFAFA]/12'
                }`}
              >
                {loading === plan.id && <Loader2 size={14} className="animate-spin" />}
                Start {plan.name}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-[12px] text-[#52525B] mt-10">
          Free tier includes drafts and previews. Publishing requires a paid plan.{' '}
          <Link href="/login" className="text-[#818CF8] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
