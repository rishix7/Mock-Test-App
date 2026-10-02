import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minute — Timed Tests",
  description: "Create, take, and review focused timed tests.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
