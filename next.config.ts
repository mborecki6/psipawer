import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  experimental: { cpus: 2, serverActions: { bodySizeLimit: "2mb" } },
};
export default config;
