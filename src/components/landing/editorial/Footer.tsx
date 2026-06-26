/**
 * Editorial footer: "/" mark + CONTENT OS wordmark, the product tagline, and a
 * private-beta copyright line. Hairline top border closes the page grid.
 */
export default function Footer() {
  return (
    <footer className="border-t border-hair bg-paper">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-6 p-10">
        <div className="flex items-center gap-[10px]">
          <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-ink font-mono text-[11px] text-paper">
            /
          </span>
          <span className="font-mono text-[12px] tracking-[0.16em] text-ink2">
            CONTENT OS
          </span>
        </div>
        <p className="m-0 font-mono text-[11.5px] text-ink3">
          The self-improving content command center for creators who ship.
        </p>
        <span className="font-mono text-[11px] text-ink3">© 2026 · Private beta</span>
      </div>
    </footer>
  );
}
