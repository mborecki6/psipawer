import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Psi Pawer",
    short_name: "Psi Pawer",
    lang: "pl",
    description: "Twoje spotkania, zalecenia i wiadomości w Psi Pawer.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fff9ee",
    theme_color: "#28231f",
    icons: [
      {
        src: "/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
