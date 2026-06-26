/**
 * "Voice Fingerprint" — paper2 band contrasting a generic-AI draft (41% match) with
 * the same idea routed through the creator's fingerprint (94%). Left column shows
 * three persistent trait bars; the bars are static by design (the fingerprint is a
 * stored profile, not an animated meter).
 */
const TRAITS: [string, string, string][] = [
  ['Directness', 'HIGH', '88%'],
  ['Punchiness', 'SHARP', '79%'],
  ['Warmth', 'MEASURED', '54%'],
];

export default function Voice() {
  return (
    <section id="voice" className="border-y border-hair bg-paper2">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-16 px-10 py-24 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">
            04 / VOICE FINGERPRINT
          </span>
          <h2 className="ed-serif my-[18px] text-[clamp(30px,3.8vw,50px)] font-normal leading-[1.0] tracking-[-0.025em] text-ink">
            Every draft routed through your voice.
          </h2>
          <p className="m-0 mb-[30px] max-w-[42ch] text-[17px] leading-[1.6] text-ink2">
            A persistent fingerprint of how you actually write — directness, pacing,
            punchiness, vocabulary, warmth. Not tone presets.{' '}
            <span className="font-medium text-ink">Your tone.</span>
          </p>
          <div className="flex max-w-[380px] flex-col gap-4">
            {TRAITS.map(([trait, label, pct]) => (
              <div key={trait}>
                <div className="mb-[7px] flex justify-between">
                  <span className="text-[13.5px] text-ink2">{trait}</span>
                  <span className="font-mono text-[11.5px] text-ink3">{label}</span>
                </div>
                <div className="h-1 bg-[rgba(23,23,23,0.08)]">
                  <div className="h-full bg-ink" style={{ width: pct }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="rounded-t-xl border border-hair bg-white p-[22px]">
            <div className="mb-3 flex items-center gap-[9px]">
              <span className="rounded-[5px] border border-hair px-[7px] py-[3px] font-mono text-[10px] text-ink3">
                GENERIC AI
              </span>
              <span className="font-mono text-[11px] text-ink3">Voice match · 41%</span>
            </div>
            <p className="m-0 text-[15px] italic leading-[1.55] text-ink3">
              “In today&apos;s fast-paced world, consistency is key to building a personal
              brand. Here are 5 tips to stay consistent…”
            </p>
          </div>
          <div className="border-x border-hair bg-paper2 p-[10px] text-center font-mono text-[10.5px] tracking-[0.08em] text-teal">
            ↓ ROUTED THROUGH YOUR FINGERPRINT
          </div>
          <div className="rounded-b-xl border border-ink bg-white p-[22px]">
            <div className="mb-3 flex items-center gap-[9px]">
              <span className="rounded-[5px] bg-ink px-[7px] py-[3px] font-mono text-[10px] text-white">
                YOUR VOICE
              </span>
              <span className="font-mono text-[11px] text-teal">Voice match · 94%</span>
            </div>
            <p className="ed-serif m-0 text-[19px] leading-[1.45] text-ink">
              “I stopped trying to be consistent. I built a system instead — and shipped 40
              posts in a month I almost skipped.”
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
