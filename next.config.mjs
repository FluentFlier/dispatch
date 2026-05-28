/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@hello-pangea/dnd', '@insforge/sdk'],
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
