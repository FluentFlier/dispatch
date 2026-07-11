// Conservative CSP that does NOT restrict script-src/style-src, since Next.js
// relies on inline hydration scripts that would break without per-request nonces.
// We only lock down framing, plugin objects, and the base URI.
const contentSecurityPolicy = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    // microphone=(self): allow the mic for our OWN origin only. An empty
    // allowlist (microphone=()) blocks getUserMedia site-wide before any prompt
    // and cannot be overridden by the user granting permission, which broke
    // Dictate + Voice Capture. camera/geolocation stay locked (unused).
    value: 'camera=(), microphone=(self), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: contentSecurityPolicy,
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@hello-pangea/dnd', '@insforge/sdk', 'lenis'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
