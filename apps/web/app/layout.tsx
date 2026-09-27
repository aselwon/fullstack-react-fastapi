import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "HarborDesk — Customer support inbox",
  description: "A shared inbox for customer requests and conversations.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
