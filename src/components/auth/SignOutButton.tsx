'use client';

/**
 * Clears the httpOnly session cookie and returns the user to the marketing site.
 */
export default function SignOutButton({ className }: { className?: string }) {
  async function signOut() {
    await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
    window.location.href = '/';
  }

  return (
    <button type="button" onClick={signOut} className={className}>
      Sign out
    </button>
  );
}
