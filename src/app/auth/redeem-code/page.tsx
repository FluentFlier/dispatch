'use client';

import { useEffect, useState } from 'react';

export default function RedeemCodePage(): JSX.Element {
  const [message, setMessage] = useState('Starting your free trial…');

  useEffect(() => {
    let active = true;

    async function redeem(): Promise<void> {
      try {
        const response = await fetch('/api/billing/redeem-pending-code', {
          method: 'POST',
        });
        if (!active) return;
        window.location.replace(response.ok ? '/auth/continue' : '/get-started?code_error=1');
      } catch {
        if (active) setMessage('Could not start your trial. Retrying…');
        window.setTimeout(() => window.location.reload(), 1500);
      }
    }

    void redeem();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="editorial flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <p className="text-sm text-ink2" role="status">
        {message}
      </p>
    </div>
  );
}
