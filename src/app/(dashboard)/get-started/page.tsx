import AccessCodeForm from '@/components/billing/AccessCodeForm';
import { PRODUCT_NAME } from '@/lib/brand';

/**
 * Access-code gate: new users must redeem a trial code before the app unlocks.
 * The (dashboard) layout lets no-trial users sit here; on success the form
 * routes through /auth/continue into onboarding.
 */
export default function GetStartedPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink3">
        {PRODUCT_NAME}
      </p>
      <h1 className="mt-3 font-serif text-[clamp(26px,4vw,34px)] font-normal tracking-[-0.03em] text-ink">
        Enter your access code
      </h1>
      <p className="mt-3 text-[15px] leading-7 text-ink2">
        {PRODUCT_NAME} is invite-only right now. Enter the code you were given to
        start your free trial.
      </p>

      <div className="mt-8">
        <AccessCodeForm />
      </div>

      <p className="mt-6 text-[13px] text-ink3">
        Don&apos;t have a code?{' '}
        <a href="/book-demo" className="text-accent-primary hover:underline">
          Request access
        </a>
        .
      </p>
    </div>
  );
}
