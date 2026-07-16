import { createClient } from '@insforge/sdk';
import { verifyDraftToken } from '@/lib/sms/draft-token';
import { PRODUCT_NAME } from '@/lib/brand';

export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * Public, login-free draft view opened from an SMS magic link. The signed token
 * carries the draft id + owner + expiry, so we can render the draft without a
 * session. Editing/posting still happens in the authenticated app - this page
 * confirms the draft and links into it.
 */
export default async function DraftLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = verifyDraftToken(token);

  if (!payload) {
    return (
      <Shell>
        <h1 className="text-lg font-medium text-ink">Link expired</h1>
        <p className="mt-2 text-sm text-ink2">
          This draft link is invalid or has expired. Open {PRODUCT_NAME} to keep editing.
        </p>
      </Shell>
    );
  }

  // Read the draft with a service-role client (no user session on this page).
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;
  let content = '';
  let title = 'Your draft';
  if (url && serviceKey) {
    const admin = createClient({ baseUrl: url, anonKey: serviceKey, isServerMode: true });
    const { data } = await admin.database
      .from('posts')
      .select('title, script, caption')
      .eq('id', payload.postId)
      .eq('user_id', payload.userId)
      .maybeSingle();
    if (data) {
      title = (data.title as string) || title;
      content = (data.script as string) || (data.caption as string) || '';
    }
  }

  return (
    <Shell>
      <p className="text-xs uppercase tracking-wide text-ink3">Draft preview</p>
      <h1 className="mt-1 text-lg font-medium text-ink">{title}</h1>
      {content && (
        <pre className="mt-4 whitespace-pre-wrap font-body text-sm leading-6 text-ink2">{content}</pre>
      )}
      <a
        href="/generate"
        className="mt-6 inline-flex items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-white"
      >
        Open in {PRODUCT_NAME} to edit &amp; post
      </a>
      <p className="mt-4 text-xs text-ink3">
        Reply to the text message with edits or a photo and it attaches to this draft automatically.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <div className="rounded-lg border border-hair bg-paper2 p-6">{children}</div>
    </div>
  );
}
