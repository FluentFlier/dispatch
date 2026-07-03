import Link from 'next/link';
import { PRODUCT_NAME } from './brand';

export default function Footer() {
  return (
    <footer className="border-t border-hair bg-paper">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-8 sm:px-10">
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-ink font-mono text-[11px] text-paper">
            /
          </span>
          <span className="font-mono text-[12px] tracking-[0.16em] text-ink2">
            {PRODUCT_NAME.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/book-demo" className="font-mono text-[11px] text-ink2 hover:text-ink">
            Book demo
          </Link>
          <Link href="/terms" className="font-mono text-[11px] text-ink2 hover:text-ink">
            Terms
          </Link>
          <Link href="/privacy" className="font-mono text-[11px] text-ink2 hover:text-ink">
            Privacy
          </Link>
          <Link href="/pricing" className="font-mono text-[11px] text-ink2 hover:text-ink">
            Pricing
          </Link>
          <Link href="/login" className="font-mono text-[11px] text-ink2 hover:text-ink">
            Sign in
          </Link>
          <span className="font-mono text-[11px] text-ink3">© 2026</span>
        </div>
      </div>
    </footer>
  );
}
