import type { NextConfig } from "next";

const isSTB = process.env.STB_MODE === 'true' || process.env.STB_MODE === '1';

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true, // ✅ Enable gzip/brotli compression
  serverExternalPackages: ['pg', 'bcryptjs', '@prisma/client', 'prisma', 'ioredis'],
  typescript: {
    ignoreBuildErrors: true, // TODO: enable after fixing all 82 TS errors
  },
  reactStrictMode: false, // TODO: re-enable after fixing double-mount side effects

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
      // Security headers — apply to all routes
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      // ✅ STB: no-store only for API routes, not static assets
      ...(isSTB ? [{
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      }] : []),
      // ✅ Static assets — always cache with immutable (both STB and standard)
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
