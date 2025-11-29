import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";


export const batangas = localFont({
  src: './fonts/BatangasBold700.otf',
  display: 'swap',
  variable: '--font-batangas',
});

export const metadata: Metadata = {
  title: "Dripl-App",
  description: "Collaborative platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${batangas.variable}`}>
        {children}
      </body>
    </html>
  );
}
