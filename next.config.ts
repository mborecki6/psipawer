import type { NextConfig } from "next";
const config: NextConfig = {
  // Keep the explicitly local production preview separate from cloud builds
  // and the running development server. The local launcher verifies provenance.
  distDir: process.env.PSI_LOCAL_PREVIEW === "1" ? ".next-local" : ".next",
  poweredByHeader: false,
  // Local authentication links contain one-time credentials. Development
  // request/function logs must not record them or submitted form arguments.
  logging: {
    incomingRequests: {
      ignore: [/\/auth\/(access|recovery|invitation|callback)(?:[/?]|$)/],
    },
    serverFunctions: false,
  },
  headers() {
    return [
      "/auth/access",
      "/auth/recovery",
      "/auth/invitation",
      "/forgot-password",
      "/account/security",
    ].map((source) => ({
      source,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    }));
  },
  experimental: { cpus: 2, serverActions: { bodySizeLimit: "2mb" } },
};
export default config;
