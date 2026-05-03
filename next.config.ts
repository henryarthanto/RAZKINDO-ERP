import type { NextConfig } from "next";

const isSTB = process.env.STB_MODE === 'true' || process.env.STB_MODE === '1';

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ['pg', 'bcryptjs', '@prisma/client', 'prisma', 'ioredis', 'socket.io', '@sentry/nextjs'],
  // typescript: { ignoreBuildErrors: false }, // TODO: enable after fixing all TS errors
  typescript: {
    ignoreBuildErrors: true,
  },
  // reactStrictMode: true, // TODO: re-enable after fixing double-mount side effects in ERP components
  reactStrictMode: false,

  ...(isSTB ? {
    experimental: {
      workerThreads: false,
      optimizeCss: false,
    },
  } : {}),

  allowedDevOrigins: [
    "space.z.ai",
    "space.chatglm.site",
    ".space.z.ai",
    ".space.chatglm.site",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],

  async rewrites() {
    return [
      {
        source: '/favicon.ico',
        destination: '/api/pwa/icon?size=32',
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isSTB ? [
            { key: 'Cache-Control', value: 'no-store, max-age=0' },
          ] : []),
        ],
      },
      ...(!isSTB ? [{
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      }] : []),
    ];
  },
};

export default nextConfig;
