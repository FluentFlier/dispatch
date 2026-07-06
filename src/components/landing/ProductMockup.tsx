'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import StatusBadge from '@/components/ui/StatusBadge';

type Tab = 'write' | 'calendar' | 'inbox';

const TABS = [
  { id: 'write' as const, label: 'Write' },
  { id: 'calendar' as const, label: 'Calendar' },
  { id: 'inbox' as const, label: 'Inbox' },
];

const DRAFT = 'I built a system instead of chasing consistency.';

const EASE = [0.16, 1, 0.3, 1] as const;

export default function ProductMockup() {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Tab>('write');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (tab !== 'write') return;
    if (reduce) {
      setTyped(DRAFT);
      return;
    }
    setTyped('');
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setTyped(DRAFT.slice(0, i));
      if (i >= DRAFT.length) clearInterval(t);
    }, 26);
    return () => clearInterval(t);
  }, [tab, reduce]);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => {
      setTab((current) => {
        const idx = TABS.findIndex((item) => item.id === current);
        return TABS[(idx + 1) % TABS.length].id;
      });
    }, 4800);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <div className="relative mx-auto w-full max-w-[500px]">
      <Image
        src="/landing/glow.png"
        alt=""
        width={420}
        height={420}
        className="pointer-events-none absolute -right-8 top-8 z-0 w-[min(72%,320px)] opacity-70 animate-land-drift-a"
        aria-hidden
      />
      <div className="relative z-10 overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-[0_24px_60px_-24px_rgba(23,23,23,0.28)] backdrop-blur-sm">
        <div className="border-b border-border px-4 py-3">
          <Tabs
            tabs={TABS}
            activeTab={tab}
            onChange={(id) => setTab(id as Tab)}
            variant="pill"
          />
        </div>

        <div className="min-h-[320px] bg-bg-secondary p-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: EASE }}
            >
          {tab === 'write' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-accent-light text-accent-primary">Founder</Badge>
                <Badge className="bg-bg-tertiary text-text-tertiary">LinkedIn</Badge>
                <Badge className="bg-bg-tertiary text-text-tertiary">X</Badge>
              </div>
              <Card elevated={false} className="!bg-bg-primary py-3">
                <p className="m-0 text-[15px] leading-relaxed text-text-primary">
                  {typed}
                  <span className="ml-0.5 inline-block h-4 w-0.5 animate-ed-blink bg-accent-primary align-middle" />
                </p>
              </Card>
              <div className="grid grid-cols-2 gap-3">
                <Card className="py-3">
                  <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                    Voice
                  </p>
                  <p className="m-0 mt-1 text-xl font-semibold text-teal">94%</p>
                </Card>
                <Card className="py-3">
                  <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                    Hook
                  </p>
                  <p className="m-0 mt-1 text-xl font-semibold text-coral">87</p>
                </Card>
              </div>
              <Button variant="primary" size="sm" className="w-full">
                Schedule · Tue 9:20
              </Button>
            </div>
          )}

          {tab === 'calendar' && (
            <div className="space-y-2">
              {[
                { title: 'System thread', time: '9:20 AM', platform: 'LinkedIn' },
                { title: 'Hook breakdown', time: '2:00 PM', platform: 'X' },
              ].map((row) => (
                <Card key={row.title} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[14px] font-medium text-text-primary">
                      {row.title}
                    </p>
                    <p className="m-0 text-[12px] text-text-tertiary">
                      {row.time} · {row.platform}
                    </p>
                  </div>
                  <StatusBadge status="scripted" />
                </Card>
              ))}
            </div>
          )}

          {tab === 'inbox' && (
            <Card className="space-y-3">
              <p className="m-0 text-[13px] text-text-secondary">
                @founder: &ldquo;How do you batch without losing your voice?&rdquo;
              </p>
              <div className="rounded-md border border-border bg-bg-primary p-3 text-[13px] leading-relaxed text-text-primary">
                I batch angles on Monday. The system drafts. I ship before lunch.
              </div>
              <div className="flex items-center gap-2 text-[12px] font-medium text-teal">
                <StatusBadge status="posted" />
                Saved as next idea
              </div>
            </Card>
          )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
