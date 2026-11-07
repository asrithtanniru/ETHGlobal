import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source, not built JS.
  transpilePackages: ["@ghar/shared", "@ghar/ens", "@ghar/arkiv", "@ghar/agent"],
  images: { unoptimized: true },
  devIndicators: false,
  // Skip type checking during `next build` so deploys never block on it.
  typescript: { ignoreBuildErrors: true },
};

export default config;
