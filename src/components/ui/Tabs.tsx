'use client';

interface Tab {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  variant?: 'default' | 'pill';
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, variant = 'default', className = '' }: TabsProps) {
  if (variant === 'pill') {
    return (
      <div className={`flex gap-1 overflow-x-auto scrollbar-hide ${className}`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-tab={tab.id}
            onClick={() => onChange(tab.id)}
            className={`whitespace-nowrap px-4 py-[7px] min-h-[44px] text-[13px] font-body font-medium rounded-pill border transition-all duration-100 shrink-0 ${
              activeTab === tab.id
                ? 'border-blue/25 text-blue bg-blue/10 shadow-sm'
                : 'border-hair text-ink2 hover:text-ink bg-white/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex gap-1 overflow-x-auto pb-[1px] scrollbar-hide border-b border-hair ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-tab={tab.id}
          onClick={() => onChange(tab.id)}
          className={`whitespace-nowrap px-4 py-2 min-h-[44px] font-body font-medium text-[13px] border-b-[1.5px] transition-colors duration-100 shrink-0 ${
            activeTab === tab.id
              ? 'border-blue text-ink'
              : 'border-transparent text-ink2 hover:text-ink'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export type { Tab, TabsProps };
