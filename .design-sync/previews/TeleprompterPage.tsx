import { TeleprompterPage, PreviewShell } from 'content-os';

// Full-page screen preview. PreviewShell mocks the Next router and answers
// /api fetches with empty payloads, so the page renders its zero-data state.
export function Screen() {
  return (
    <PreviewShell pathname="/teleprompter">
      <TeleprompterPage />
    </PreviewShell>
  );
}
