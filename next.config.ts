import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};
export default config;
