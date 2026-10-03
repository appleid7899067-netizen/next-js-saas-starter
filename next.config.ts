import type { NextConfig } from 'next';

/**
 * `BUILD_STANDALONE=1 pnpm build` (see `pnpm build:standalone`) additionally
 * emits the self-contained `.next/standalone` output used by the Render
 * blueprint. Plain `pnpm build` keeps the default output that `pnpm start`
 * and Vercel expect.
 */
const standaloneBuild = process.env.BUILD_STANDALONE === '1';

const nextConfig: NextConfig = {
  ...(standaloneBuild ? { output: 'standalone' as const } : {}),
  experimental: {
    ppr: true,
    clientSegmentCache: true
  },
  // The embedded Postgres used when POSTGRES_URL is missing ships WASM, so it
  // must not be bundled by Turbopack/webpack.
  serverExternalPackages: ['@electric-sql/pglite'],
  // Allow the dev server to be reached through a proxied preview host
  // (Arena/E2B preview URLs, ngrok tunnels, …) without cross-origin warnings.
  allowedDevOrigins: [
    '*.e2b.app',
    '*.e2b.dev',
    '*.arena.ai',
    '*.ngrok-free.app',
    '*.trycloudflare.com'
  ]
};

export default nextConfig;
