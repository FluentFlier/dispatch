import Link from 'next/link';
import { PRODUCT_NAME } from './brand';

export default function Footer() {
  return (
    <footer className="border-t border-hair/60">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="m-0 text-[14px] font-medium text-ink">{PRODUCT_NAME.toLowerCase()}.</p>
        <div className="flex gap-5 text-[13px] text-ink3">
          <Link href="/pricing" className="hover:text-ink">
            Pricing
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
