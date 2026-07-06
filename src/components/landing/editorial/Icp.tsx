import type { LucideIcon } from 'lucide-react';
import { Code2, Megaphone, Rocket, User } from 'lucide-react';
import LandingSectionHeader from '../LandingSectionHeader';
import LandingGlowOrb from '../LandingGlowOrb';
import { SECTION_THEME } from './theme';

const theme = SECTION_THEME.who;

const PEOPLE: { role: string; copy: string; icon: LucideIcon; accent: string }[] = [
  { role: 'Founder building in public', copy: 'Ship daily without losing your voice.', icon: Rocket, accent: '#2563EB' },
  { role: 'Solo creator', copy: 'High output. One system.', icon: User, accent: '#0F766E' },
  { role: 'Technical operator', copy: 'Deep work → public authority.', icon: Code2, accent: '#E8543A' },
  { role: 'Brand operator', copy: 'Consistent voice across the week.', icon: Megaphone, accent: '#8B7BB8' },
];

export default function Icp() {
  return (
    <section id="who" className="relative scroll-mt-24 overflow-hidden border-t border-hair/60 bg-white/40">
      <LandingGlowOrb tone={theme.glow} position="center" className="opacity-60" />
      <div className="relative mx-auto max-w-[1100px] px-5 py-16 sm:px-8 sm:py-20">
        <LandingSectionHeader
          tag={theme.tag}
          title="Built for people who ship."
          accent={theme.accent}
        />
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PEOPLE.map((person) => {
            const Icon = person.icon;
            return (
              <div
                key={person.role}
                className="group relative overflow-hidden rounded-2xl border border-hair bg-white/70 px-5 py-4 backdrop-blur-sm transition-shadow hover:shadow-[0_16px_40px_-24px_rgba(23,23,23,0.2)]"
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-30"
                  style={{ backgroundColor: person.accent }}
                  aria-hidden
                />
                <div className="relative flex items-start gap-3">
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-hair bg-white shadow-sm"
                    style={{ color: person.accent }}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3 className="m-0 text-[15px] font-semibold text-ink">{person.role}</h3>
                    <p className="m-0 mt-1 text-[13px] text-ink2">{person.copy}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
