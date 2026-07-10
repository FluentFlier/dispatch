import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Many suites dynamically `await import()` Next.js route modules, which pull
    // in heavy dependency graphs. Individually these resolve in <2s, but under
    // full-suite CPU contention (120+ files) they can exceed the 5s default and
    // flake as timeouts even though the logic is fine. 30s gives headroom without
    // hiding a genuinely hung test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
