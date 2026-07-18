import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages that must not be bundled into client/edge code.
  serverExternalPackages: ["bullmq", "ioredis", "@prisma/client", "googleapis"],
  images: {
    remotePatterns: [
      // Company logos fetched from public sources (e.g. Clearbit-style CDNs, favicons).
      { protocol: "https", hostname: "**" },
    ],
  },
  experimental: {
    // Keep server actions payloads small; large payloads (resumes) go through Supabase Storage.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
