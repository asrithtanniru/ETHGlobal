import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source, not built JS.
  transpilePackages: ["@ghar/shared", "@ghar/ens", "@ghar/arkiv"],
  images: { unoptimized: true },
  devIndicators: false,
};

export default config;
