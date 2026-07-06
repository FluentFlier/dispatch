import type { ReactNode } from 'react';

interface Props {
  id?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  centered?: boolean;
}

/** Shared landing section rhythm: one headline, one line, one job. */
export default function LandingSection({
  id,
  title,
  subtitle,
  children,
  className = '',
  innerClassName = '',
  centered = false,
}: Props) {
  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      <div className={`mx-auto max-w-[1100px] px-5 py-16 sm:px-8 sm:py-20 ${innerClassName}`}>
        <div className={centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
          <h2 className="m-0 text-[clamp(26px,3.5vw,40px)] font-semibold tracking-[-0.03em] text-ink">
            {title}
          </h2>
          {subtitle ? <p className="m-0 mt-3 text-[15px] leading-relaxed text-ink2">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
