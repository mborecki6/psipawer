import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Psi Pawer — spacery i psie sprawy",
  description: "Panel spacerów socjalizacyjnych Psi Pawer.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
