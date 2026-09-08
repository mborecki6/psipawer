import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  headers() {
    return [
      {
        source: "/auth/access",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
  experimental: { cpus: 2, serverActions: { bodySizeLimit: "2mb" } },
};
export default config;
