// Browser shim: page code (and some deps) reads process.env.* at module
// scope. esbuild only defines process.env.NODE_ENV, so a bare `process`
// reference throws in the browser and takes the whole IIFE bundle down.
// Imported first from ds-entry.ts so it runs before any other module.
declare const globalThis: { process?: { env: Record<string, string | undefined> } };
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: {
      // Placeholder insforge credentials: the browser client throws at
      // construction without them (LoginPage). No request ever succeeds
      // against this host — previews stub /api/* and designs have no backend.
      NEXT_PUBLIC_INSFORGE_URL: 'https://preview-insforge.invalid',
      NEXT_PUBLIC_INSFORGE_ANON_KEY: 'preview-anon-key',
    },
  };
}
export {};
