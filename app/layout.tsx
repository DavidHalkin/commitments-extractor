import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Commitments from recordings",
  description: "Final tasks, owners, deadlines and open questions with timestamped evidence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Commitments</Link>
          <nav>
            <Link href="/">New upload</Link>
            <Link href="/history">History</Link>
          </nav>
        </header>
        <p className="notice">Uploads are visible to everyone who opens this demo and are deleted after 30 days.</p>
        <main>{children}</main>
      </body>
    </html>
  );
}
