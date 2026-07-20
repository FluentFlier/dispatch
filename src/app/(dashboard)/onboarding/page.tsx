import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import OnboardingWizard from './OnboardingWizard';

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
        </div>
      }
    >
      <OnboardingWizard />
    </Suspense>
  );
}
