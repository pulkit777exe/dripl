import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Dripl — Think in public",
  description:
    "A collaborative canvas for drawing, designing, and sharing ideas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        style={
          {
            "--font-dm-serif": '"Georgia", "Times New Roman", serif',
            "--font-source-sans":
              '"Segoe UI", "Helvetica Neue", "Arial", sans-serif',
            "--font-caveat": '"Comic Sans MS", "Marker Felt", cursive',
          } as CSSProperties
        }
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
