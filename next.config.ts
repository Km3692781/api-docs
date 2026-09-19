import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Keep sharp's native bindings out of the bundler (required on Vercel).
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
