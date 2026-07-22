'use client';

import { useEffect, useState } from 'react';

const SECTIONS = [
  { id: 'performance', label: 'Performance' },
  { id: 'timing', label: 'Timing' },
  { id: 'algorithm-playbook', label: 'Playbook' },
  { id: 'posts-table', label: 'Posts' },
  { id: 'charts', label: 'Content performance' },
  { id: 'intelligence', label: 'Audience & leads' },
  { id: 'weekly-review', label: 'Reviews' },
  { id: 'hashtags', label: 'Hashtags' },
] as const;

export default function AnalyticsSectionNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5] },
    );

    for (const { id } of SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      className="sticky top-0 z-20 -mx-4 px-4 py-2 mb-6 bg-bg-primary/95 backdrop-blur-md border-b border-hair md:-mx-8 md:px-8"
      aria-label="Analytics sections"
    >
      <div className="flex gap-1 overflow-x-auto">
        {SECTIONS.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
              active === id
                ? 'bg-ink text-white'
                : 'text-ink2 hover:bg-bg-tertiary hover:text-ink'
            }`}
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
