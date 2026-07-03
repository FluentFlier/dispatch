const TRAITS: [string, string][] = [
  ['Directness', '88%'],
  ['Punchiness', '79%'],
  ['Warmth', '54%'],
];

export default function Voice() {
  return (
    <section id="voice" className="scroll-mt-24 border-y border-hair bg-paper2">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-10 px-5 py-14 sm:gap-12 sm:px-10 sm:py-20 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">04 / VOICE</span>
          <h2 className="ed-serif my-4 text-[clamp(28px,3.6vw,44px)] font-normal leading-[1.02] tracking-[-0.025em] text-ink">
            Sounds like you. Not ChatGPT.
          </h2>
          <div className="flex max-w-[320px] flex-col gap-3">
            {TRAITS.map(([trait, pct]) => (
              <div key={trait}>
                <div className="mb-1 flex justify-between text-[13px] text-ink2">
                  <span>{trait}</span>
                  <span className="font-mono text-[11px] text-ink3">{pct}</span>
                </div>
                <div className="h-1 bg-[rgba(23,23,23,0.08)]">
                  <div className="h-full bg-ink" style={{ width: pct }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="rounded-t-xl border border-hair bg-white p-5">
            <span className="font-mono text-[10px] text-ink3">GENERIC · 41%</span>
            <p className="m-0 mt-2 text-[15px] italic leading-snug text-ink3">
              “In today&apos;s fast-paced world, consistency is key…”
            </p>
          </div>
          <div className="border-x border-hair bg-paper2 py-2 text-center font-mono text-[10px] text-teal">
            ↓ YOUR FINGERPRINT
          </div>
          <div className="rounded-b-xl border border-ink bg-white p-5">
            <span className="font-mono text-[10px] text-teal">YOUR VOICE · 94%</span>
            <p className="ed-serif m-0 mt-2 text-[18px] leading-snug text-ink">
              “I stopped trying to be consistent. I built a system instead.”
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
