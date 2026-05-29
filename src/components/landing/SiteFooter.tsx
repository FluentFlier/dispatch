import Link from 'next/link';
import { PlatformGlyph } from './primitives';

const cols = [
  {
    title: 'Product',
    links: [
      { label: 'The loop', href: '#loop' },
      { label: 'Voice', href: '#voice' },
      { label: 'Native everywhere', href: '#everywhere' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    title: 'Workspace',
    links: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Generate', href: '/generate' },
      { label: 'Voice Lab', href: '/voice-lab' },
      { label: 'Analytics', href: '/analytics' },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="relative border-t border-os-border py-12">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-os-coral/15 ring-1 ring-os-coral/30">
              <span className="h-2 w-2 rounded-sm bg-os-coral" />
            </span>
            <span className="os-mono text-[12px] font-medium uppercase tracking-[0.28em] text-os-text">
              Content&nbsp;OS
            </span>
          </div>
          <p className="mt-4 max-w-xs text-[13.5px] leading-6 text-os-muted">
            The content command center for creators and founders. Your engine,
            trained on you.
          </p>
          <div className="mt-5 flex items-center gap-2.5 text-os-muted">
            {(['x', 'linkedin', 'instagram', 'threads', 'youtube'] as const).map((p) => (
              <a
                key={p}
                href="#"
                aria-label={p}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-os-border transition-colors hover:border-os-border-strong hover:text-os-text"
              >
                <PlatformGlyph platform={p} className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        </div>

        {cols.map((c) => (
          <div key={c.title}>
            <p className="os-mono text-[10px] uppercase tracking-[0.18em] text-os-muted">
              {c.title}
            </p>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="text-[13.5px] text-os-soft transition-colors hover:text-os-text"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-col items-center justify-between gap-3 px-5 sm:flex-row sm:px-8">
        <span className="os-mono text-[11px] text-os-muted">
          © {new Date().getFullYear()} Content OS
        </span>
        <span className="os-mono text-[11px] text-os-muted">Made for people who post.</span>
      </div>
    </footer>
  );
}
