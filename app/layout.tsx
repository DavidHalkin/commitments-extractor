import type { Metadata } from "next";
import { Literata, Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const uiFont = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const quoteFont = Literata({ subsets: ["latin"], variable: "--font-quote", display: "swap" });

export const metadata: Metadata = {
  title: "Commitments from recordings",
  description: "Final tasks, owners, deadlines and open questions with timestamped evidence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${uiFont.variable} ${quoteFont.variable}`}>
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">Commitments</Link>
            <nav className="site-nav" aria-label="Main">
              <Link href="/">New upload</Link>
              <Link href="/history">History</Link>
            </nav>
            <p className="notice">Uploads are visible to everyone who opens this demo and are deleted after 30 days.</p>
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
