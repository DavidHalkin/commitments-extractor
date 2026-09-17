import type { Metadata } from "next";
import { Fredoka, Inter } from "next/font/google";
import Link from "next/link";
import { HeaderRunBadge } from "@/app/components/HeaderRunBadge";
import { RunSessionProvider } from "@/app/components/RunSession";
import "./globals.css";

const displayFont = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const bodyFont = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Commitments from recordings",
  description: "Final tasks, owners, deadlines and open questions with timestamped evidence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <RunSessionProvider>
          <header className="site-header">
            <div className="site-header-inner">
              <Link href="/" className="brand">Commitments</Link>
              <nav className="site-nav" aria-label="Main">
                <Link href="/">New upload</Link>
                <Link href="/history">History</Link>
                <HeaderRunBadge />
              </nav>
            </div>
            <p className="notice">Uploads are visible to everyone who opens this demo and are deleted after 30 days.</p>
          </header>
          <main className="page">{children}</main>
        </RunSessionProvider>
      </body>
    </html>
  );
}
