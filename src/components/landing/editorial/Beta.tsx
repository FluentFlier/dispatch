'use client';

import { useState } from 'react';

const PLATFORMS = ['X / Twitter', 'LinkedIn', 'Instagram', 'Threads'];
const CADENCES = ['Daily', 'A few times a week', 'Weekly', 'Sporadically'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Private-beta waitlist. Fields are controlled; platforms multi-select and cadence
 * single-select via chips. Validation runs only after a submit attempt (name present,
 * valid email, ≥1 platform) and shows inline coral errors under the offending fields.
 * On success the form swaps to a confirmation panel echoing the entered name + email.
 * Submission is client-side only, matching the design handoff (no backend wired here).
 */
export default function Beta() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [bottleneck, setBottleneck] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [cadence, setCadence] = useState('');
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<{ name: string; email: string } | null>(null);

  function togglePlatform(p: string) {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  function submit() {
    const ok = name.trim() && EMAIL_RE.test(email) && platforms.length > 0;
    if (!ok) {
      setTried(true);
      return;
    }
    setDone({ name: name.trim(), email: email.trim() });
  }

  const errName = tried && !name.trim();
  const errEmail = tried && !EMAIL_RE.test(email);
  const errPlatforms = tried && platforms.length === 0;

  const labelCls =
    'mb-2 block font-mono text-[11px] tracking-[0.04em] text-ink3';
  const inputCls =
    'w-full rounded-md border border-hair2 bg-white px-[13px] py-[11px] text-[14.5px] text-ink outline-none transition-colors focus:border-blue';
  const errCls = 'mt-[7px] block font-mono text-[11px] text-flame';

  return (
    <section id="beta" className="mt-14 border-t border-hair bg-paper2">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 items-start gap-16 px-10 py-24 lg:grid-cols-2">
        <div className="lg:sticky lg:top-[100px]">
          <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">
            09 / PRIVATE BETA
          </span>
          <h2 className="ed-serif my-[18px] mb-5 text-[clamp(34px,4.6vw,62px)] font-normal leading-[0.96] tracking-[-0.03em] text-ink">
            Join the private beta.
          </h2>
          <p className="m-0 mb-7 max-w-[38ch] text-[17px] leading-[1.6] text-ink2">
            We&apos;re onboarding creators who already publish consistently and want their
            workflow to compound. Tell us how you work and we&apos;ll get you in.
          </p>
          <div className="flex flex-col gap-[11px]">
            {[
              'Your Creator Brain, trained on your real content',
              'Native publishing to X, LinkedIn, Instagram & Threads',
              'Founding-creator pricing, locked for life',
            ].map((benefit) => (
              <div key={benefit} className="flex items-baseline gap-[11px]">
                <span className="font-mono text-[12px] text-teal">✓</span>
                <span className="text-[14.5px] text-ink2">{benefit}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[14px] border border-hair bg-white p-[30px] shadow-[0_24px_60px_-38px_rgba(23,23,23,0.4)]">
          {done ? (
            <div className="px-[6px] py-[26px] text-center">
              <div className="mx-auto mb-5 grid h-[52px] w-[52px] place-items-center rounded-full bg-[rgba(15,118,110,0.1)] text-[22px] text-teal">
                ✓
              </div>
              <h3 className="ed-serif m-0 mb-3 text-[28px] font-medium tracking-[-0.02em] text-ink">
                You&apos;re on the list.
              </h3>
              <p className="mx-auto m-0 max-w-[320px] text-[15px] leading-[1.6] text-ink2">
                Thanks{done.name ? `, ${done.name.split(' ')[0]}` : ''} — we&apos;ll review
                your workflow and email{' '}
                <span className="font-medium text-ink">{done.email}</span> when your seat
                opens. Keep shipping.
              </p>
              <div className="mt-[22px] inline-flex items-center gap-[9px] rounded-full border border-hair px-[15px] py-2">
                <span className="h-[7px] w-[7px] rounded-full bg-teal animate-ed-pulse" />
                <span className="font-mono text-[11px] text-ink2">
                  Creator Brain warming up
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[18px]">
              <div>
                <label className={labelCls}>NAME</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className={inputCls}
                />
                {errName && <span className={errCls}>Please enter your name</span>}
              </div>
              <div>
                <label className={labelCls}>EMAIL</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  className={inputCls}
                />
                {errEmail && <span className={errCls}>Enter a valid email address</span>}
              </div>
              <div>
                <label className={labelCls}>PLATFORMS YOU POST ON</label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => {
                    const sel = platforms.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePlatform(p)}
                        className={`rounded-md border px-[14px] py-2 text-[13px] font-medium transition-all ${
                          sel
                            ? 'border-ink bg-ink text-paper'
                            : 'border-hair2 bg-white text-ink2'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                {errPlatforms && <span className={errCls}>Pick at least one platform</span>}
              </div>
              <div>
                <label className={labelCls}>HOW OFTEN DO YOU PUBLISH?</label>
                <div className="flex flex-wrap gap-2">
                  {CADENCES.map((c) => {
                    const sel = cadence === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCadence(c)}
                        className={`rounded-md border px-[14px] py-2 text-[13px] font-medium transition-all ${
                          sel
                            ? 'border-ink bg-ink text-paper'
                            : 'border-hair2 bg-white text-ink2'
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className={labelCls}>BIGGEST CONTENT BOTTLENECK?</label>
                <textarea
                  value={bottleneck}
                  onChange={(e) => setBottleneck(e.target.value)}
                  placeholder="e.g. I run out of ideas / my drafts sound generic / I can't keep up"
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>
              <button
                type="button"
                onClick={submit}
                className="w-full rounded-md bg-blue py-[14px] text-[15px] font-medium text-white shadow-[0_1px_2px_rgba(23,23,23,0.1)] transition-colors hover:bg-blue-dark"
              >
                Request access
              </button>
              <p className="m-0 text-center font-mono text-[10.5px] text-ink3">
                No credit card. We review every application personally.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
