import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dripl - Collaborative Whiteboard",
  description: "Real-time collaborative whiteboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  );
}
