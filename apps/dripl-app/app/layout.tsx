import type { Metadata } from 'next';
import { Caveat, Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from '@/components/ThemeProvider';
import CookieConsent from '@/components/CookieConsent';
import { SWRegistration } from '@/components/SWRegistration';

export const metadata: Metadata = {
  title: 'Dripl — Think in public',
  description: 'A collaborative canvas for drawing, designing, and sharing ideas',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
});

const caveat = Caveat({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-handwritten',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${caveat.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>{children}</AuthProvider>
          <CookieConsent />
          <SWRegistration />
        </ThemeProvider>
      </body>
    </html>
  );
}
