'use client';

import { CheckCircle2, Link2, Loader2 } from 'lucide-react';
import { COPY } from '../copy';

export interface ConnectedAccount {
  platform: string;
  account_name: string | null;
  unipile_account_id?: string | null;
}

interface StepConnectProps {
  accounts: ConnectedAccount[];
  gmailConnected: boolean;
  unipileReady: boolean | null;
  composioReady: boolean | null;
  connecting: boolean;
  connectingGmail: boolean;
  onConnectSocial: () => void;
  onConnectGmail: () => void;
  building: boolean;
  buildingLine: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: COPY.steps.connect.linkedinLabel,
  twitter: COPY.steps.connect.xLabel,
};

/**
 * Step 2 body. "Building" is a blocking state of this step rather than its own
 * step, so the progress dot count stays constant and Back can never navigate
 * into a running ingest.
 */
export function StepConnect({
  accounts,
  gmailConnected,
  unipileReady,
  composioReady,
  connecting,
  connectingGmail,
  onConnectSocial,
  onConnectGmail,
  building,
  buildingLine,
}: StepConnectProps) {
  const copy = COPY.steps.connect;

  if (building) {
    return (
      <div
        className="flex flex-col items-center rounded-lg border border-hair bg-paper2 px-8 py-16 text-center"
        aria-live="polite"
      >
        <Loader2 className="h-10 w-10 animate-spin text-accent-primary" />
        <p className="mt-6 text-lg text-ink">{buildingLine}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {unipileReady === false && (
        <div className="rounded-lg border border-hair bg-paper2 p-4 text-sm text-ink2">
          {copy.unipileUnavailable}
        </div>
      )}

      <ul className="space-y-2">
        {(['linkedin', 'twitter'] as const).map((platform) => {
          const connected = accounts.find((a) => a.platform === platform);
          return (
            <li
              key={platform}
              className="flex items-center justify-between rounded-md border border-hair bg-paper2 px-4 py-3"
            >
              <span className="text-sm font-medium text-ink">{PLATFORM_LABEL[platform]}</span>
              {connected ? (
                <span className="flex items-center gap-1.5 text-xs text-ink">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {connected.account_name ?? 'Connected'}
                </span>
              ) : (
                <span className="text-xs text-ink3">{copy.notConnected}</span>
              )}
            </li>
          );
        })}

        <li className="flex items-center justify-between rounded-md border border-hair bg-paper2 px-4 py-3">
          <div>
            <span className="text-sm font-medium text-ink">{copy.gmailLabel}</span>
            <p className="mt-0.5 text-[11px] text-ink3">{copy.gmailHint}</p>
          </div>
          {gmailConnected ? (
            <span className="flex items-center gap-1.5 text-xs text-ink">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected
            </span>
          ) : (
            <button
              type="button"
              onClick={onConnectGmail}
              disabled={connectingGmail || composioReady === false}
              className="text-xs font-medium text-accent-primary hover:underline disabled:opacity-50"
            >
              {connectingGmail ? copy.connecting : copy.connect}
            </button>
          )}
        </li>
      </ul>

      <button
        type="button"
        onClick={onConnectSocial}
        disabled={connecting || unipileReady === false}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-hair bg-paper2 py-3 text-sm text-ink transition-colors hover:border-accent-primary disabled:opacity-50"
      >
        {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        {accounts.length === 0 ? copy.connectCta : copy.connectAnother}
      </button>
    </div>
  );
}
