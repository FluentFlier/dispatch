'use client';

import {
  BarChart3,
  CalendarDays,
  FileText,
  Home,
  Inbox,
  MessageCircle,
  PenLine,
  Radio,
  Search,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';

const NAV = [
  { label: 'Home', icon: Home, active: true },
  { label: 'Signals', icon: Radio },
  { label: 'Create', icon: PenLine },
  { label: 'Calendar', icon: CalendarDays },
  { label: 'Replies', icon: MessageCircle },
  { label: 'Leads', icon: Target },
] as const;

const PIPELINE = [
  { label: 'Signals', value: '18', color: 'bg-[#315fe8]' },
  { label: 'Drafts', value: '7', color: 'bg-[#ef6a45]' },
  { label: 'Published', value: '12', color: 'bg-[#7a8f3f]' },
] as const;

export default function QuietProductScreen() {
  return (
    <div className="flex h-full w-full bg-[#f8f7f2] text-[#22201d]">
      <aside className="flex w-[112px] shrink-0 flex-col border-r border-[#dedbd2] bg-[#f0eee8] p-3">
        <div className="mb-4 flex items-center gap-2 px-1 text-[9px] font-semibold">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-[#22201d] text-[8px] text-[#f8f7f2]">
            C
          </span>
          Content OS
        </div>
        <nav className="space-y-0.5" aria-label="Product preview">
          {NAV.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[7px] ${
                'active' in item && item.active
                  ? 'bg-[#fcfbf8] font-semibold shadow-sm'
                  : 'text-[#6c6861]'
              }`}
            >
              <item.icon className="h-2.5 w-2.5" strokeWidth={1.8} />
              {item.label}
            </div>
          ))}
        </nav>
        <div className="mt-auto rounded-lg border border-[#dedbd2] bg-[#fcfbf8] p-2">
          <div className="flex items-center gap-1.5">
            <div className="grid h-4 w-4 place-items-center rounded-full bg-[#315fe8] text-[6px] font-semibold text-white">
              A
            </div>
            <div>
              <p className="m-0 text-[6px] font-semibold">Alex Morgan</p>
              <p className="m-0 text-[5px] text-[#8a857d]">Founder workspace</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 p-4">
        <header className="flex items-start justify-between">
          <div>
            <p className="m-0 text-[6px] font-semibold uppercase tracking-[0.12em] text-[#8a857d]">
              Tuesday, week 12
            </p>
            <h3 className="m-0 mt-1 text-[16px] font-semibold tracking-[-0.04em]">
              Good morning, Alex.
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="grid h-6 w-6 place-items-center rounded-md border border-[#dedbd2] bg-[#fcfbf8]"
              aria-hidden
            >
              <Search className="h-2.5 w-2.5" />
            </span>
            <span className="inline-flex h-6 items-center rounded-md bg-[#22201d] px-2.5 text-[6px] font-semibold text-[#f8f7f2]">
              New content
            </span>
          </div>
        </header>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {PIPELINE.map((item) => (
            <div key={item.label} className="rounded-lg border border-[#dedbd2] bg-[#fcfbf8] p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[6px] text-[#77726a]">{item.label}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${item.color}`} />
              </div>
              <p className="m-0 mt-2 text-[15px] font-semibold tracking-[-0.04em]">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-[1.25fr_0.75fr] gap-2">
          <section className="rounded-lg border border-[#dedbd2] bg-[#fcfbf8] p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="m-0 text-[7px] font-semibold">Today&apos;s loop</p>
                <p className="m-0 mt-0.5 text-[5px] text-[#8a857d]">Signal → ship → learn.</p>
              </div>
              <Sparkles className="h-3 w-3 text-[#ef6a45]" />
            </div>
            <div className="mt-3 space-y-1.5">
              {[
                ['Signal', 'Customer call insight', Radio],
                ['Draft', 'Founder lesson post', FileText],
                ['Publish', 'LinkedIn · 9:15 AM', CalendarDays],
                ['Reply', '6 high-intent comments', Inbox],
              ].map(([label, detail, Icon], index) => {
                const StageIcon = Icon as typeof Radio;
                return (
                  <div key={label as string} className="flex items-center gap-2">
                    <span className="grid h-4 w-4 place-items-center rounded-full border border-[#dedbd2] text-[5px] font-semibold">
                      {index + 1}
                    </span>
                    <StageIcon className="h-2.5 w-2.5 text-[#6c6861]" />
                    <span className="w-9 text-[6px] font-semibold">{label as string}</span>
                    <span className="truncate text-[6px] text-[#77726a]">{detail as string}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-[#dedbd2] bg-[#fcfbf8] p-3">
            <div className="flex items-center justify-between">
              <p className="m-0 text-[7px] font-semibold">Warm conversations</p>
              <Users className="h-3 w-3 text-[#7a8f3f]" />
            </div>
            <div className="mt-2 space-y-2">
              {[
                ['Maya Chen', 'Replied twice', '92'],
                ['Sam Rivera', 'Saved your post', '84'],
                ['Taylor Kim', 'ICP signal', '78'],
              ].map(([name, reason, score]) => (
                <div key={name} className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-[#e6e3da]" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-[6px] font-semibold">{name}</p>
                    <p className="m-0 truncate text-[5px] text-[#8a857d]">{reason}</p>
                  </div>
                  <span className="rounded bg-[#edf1e4] px-1 py-0.5 text-[5px] font-semibold text-[#596b2d]">
                    {score}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-end gap-1" aria-label="Engagement trend rising">
              {[24, 34, 28, 45, 54, 49, 68, 76].map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  className="flex-1 rounded-sm bg-[#315fe8]"
                  style={{ height: `${height / 4}px`, opacity: 0.35 + index * 0.08 }}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
