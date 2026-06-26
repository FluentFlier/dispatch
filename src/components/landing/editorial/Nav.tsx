import Link from 'next/link';

/**
 * Sticky editorial nav: ink "/" mark + CONTENT OS wordmark, mono section anchors,
 * and an ink pill CTA. Translucent paper background with a blur and bottom hairline
 * so content scrolls under it without losing the editorial grid line.
 */
export default function Nav({ loggedIn }: { loggedIn: boolean }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-hair bg-[rgba(251,250,247,0.82)] backdrop-blur-[14px]">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-10 py-[18px]">
        <Link href="/" className="flex items-center gap-[11px]">
          <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-ink font-mono text-[12px] font-medium text-paper">
            /
          </span>
          <span className="font-mono text-[12.5px] font-medium tracking-[0.18em] text-ink">
            CONTENT&nbsp;OS
          </span>
        </Link>

        <div className="hidden items-center gap-[34px] md:flex">
          {[
            ['#problem', 'Problem'],
            ['#loop', 'The Loop'],
            ['#voice', 'Voice'],
            ['#different', 'Different'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="font-mono text-[12px] tracking-[0.04em] text-ink2 transition-colors hover:text-ink"
            >
              {label}
            </a>
          ))}
        </div>

        <Link
          href={loggedIn ? '/dashboard' : '#beta'}
          className="inline-flex items-center gap-2 rounded-md bg-ink px-[17px] py-[10px] text-[13.5px] font-medium text-paper transition-colors hover:bg-black"
        >
          {loggedIn ? 'Open Content OS' : 'Join private beta'}
        </Link>
      </div>
    </nav>
  );
}
