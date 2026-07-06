const STEPS = ['Capture', 'Draft', 'Ship'] as const;

export default function LandingFlow() {
  return (
    <section id="flow" className="scroll-mt-24 border-t border-hair/60">
      <div className="mx-auto max-w-[1100px] px-5 py-16 sm:px-8 sm:py-20">
        <p className="m-0 text-center text-[clamp(22px,3vw,32px)] font-medium tracking-[-0.02em] text-ink2">
          {STEPS.join(' · ')}
        </p>
      </div>
    </section>
  );
}
