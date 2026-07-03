/**
 * "Who it's for" — a four-up grid of ICP personas separated by vertical hairlines,
 * each with a mono index in a rotating accent (coral / blue / teal / ink).
 */
const PEOPLE: { num: string; color: string; role: string; copy: string }[] = [
  {
    num: '01',
    color: 'text-flame',
    role: 'Founder building in public',
    copy: 'Turning the messy work of building into a compounding audience.',
  },
  {
    num: '02',
    color: 'text-blue',
    role: 'Solo creator publishing daily',
    copy: 'High output without burning out or losing their voice.',
  },
  {
    num: '03',
    color: 'text-teal',
    role: 'Technical operator growing authority',
    copy: 'Translating deep work into credibility on a tight time budget.',
  },
  {
    num: '04',
    color: 'text-ink',
    role: 'Operator on a founder-led brand',
    copy: 'Keeping a consistent voice across a busy publishing week.',
  },
];

export default function Icp() {
  return (
    <section id="icp" className="scroll-mt-24 mx-auto max-w-[1180px] px-5 pb-10 pt-16 sm:px-10 sm:pt-24">
      <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">
        08 / WHO IT&apos;S FOR
      </span>
      <h2 className="ed-serif mb-10 mt-[18px] text-[clamp(28px,3.4vw,44px)] font-normal leading-[1.0] tracking-[-0.025em] text-ink">
        Built for operators, founders, and solo creators.
      </h2>
      <div className="grid grid-cols-1 border-t border-ink sm:grid-cols-2 lg:grid-cols-4">
        {PEOPLE.map((p, i) => (
          <div
            key={p.num}
            className={`border-b border-hair px-[22px] py-[26px] sm:border-b-0 ${
              i < PEOPLE.length - 1 ? 'lg:border-r lg:border-hair' : ''
            }`}
          >
            <span className={`font-mono text-[11px] ${p.color}`}>{p.num}</span>
            <h3 className="ed-serif mb-2 mt-[14px] text-[20px] font-medium leading-[1.15] text-ink">
              {p.role}
            </h3>
            <p className="m-0 text-[13.5px] leading-[1.5] text-ink2">{p.copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
