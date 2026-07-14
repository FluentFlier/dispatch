import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import LandingSectionHeader from '../LandingSectionHeader';
import LandingGlowOrb from '../LandingGlowOrb';
import { SECTION_THEME } from './theme';

const theme = SECTION_THEME.leads;

const WARM = {
  name: 'Maya Chen',
  role: 'Head of Growth · Relay',
  reason: 'Commented on your posts 3× this month',
  note: 'Maya - loved your thread on founder-led sales. Would be great to swap notes on GTM.',
};

const SIGNAL = {
  company: 'NovaPay',
  detail: 'Series A fintech · YC W24',
  reason: 'Matches your ICP: B2B fintech, US, seed–A',
  step: 'Research → comment → connect',
};

export default function Leads() {
  return (
    <section id="leads" className="relative scroll-mt-24 overflow-hidden border-t border-hair/60 bg-white/50">
      <LandingGlowOrb tone={theme.glow} position="left" />
      <div className="relative mx-auto max-w-[1100px] px-5 py-12 sm:px-8 sm:py-14">
        <LandingSectionHeader
          tag={theme.tag}
          title="Reach people worth talking to."
          subtitle="Warm contacts from your network and signal leads that match your ICP - with drafts ready to send."
          accent={theme.accent}
        />

        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="space-y-4 !bg-white/90">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.12em] text-ink3">
                Warm contacts
              </p>
              <Badge className="bg-teal/10 text-teal">From your graph</Badge>
            </div>
            <div>
              <p className="m-0 text-[16px] font-semibold text-ink">{WARM.name}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink2">{WARM.role}</p>
              <p className="m-0 mt-2 text-[12px] text-ink3">{WARM.reason}</p>
            </div>
            <div className="rounded-lg border border-hair bg-paper2/50 px-3 py-2.5 text-[13px] leading-relaxed text-ink2">
              {WARM.note}
            </div>
            <p className="m-0 text-[11px] font-medium text-teal">Connect note drafted</p>
          </Card>

          <Card className="space-y-4 !bg-white/90">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.12em] text-ink3">
                Signal leads
              </p>
              <Badge className="bg-blue/10 text-blue">ICP match</Badge>
            </div>
            <div>
              <p className="m-0 text-[16px] font-semibold text-ink">{SIGNAL.company}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink2">{SIGNAL.detail}</p>
              <p className="m-0 mt-2 text-[12px] text-ink3">{SIGNAL.reason}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SIGNAL.step.split(' → ').map((step) => (
                <span
                  key={step}
                  className="rounded-full border border-hair bg-white px-2.5 py-1 text-[11px] font-medium text-ink2"
                >
                  {step}
                </span>
              ))}
            </div>
            <p className="m-0 text-[11px] font-medium text-blue">Nurture playbook ready</p>
          </Card>
        </div>
      </div>
    </section>
  );
}
