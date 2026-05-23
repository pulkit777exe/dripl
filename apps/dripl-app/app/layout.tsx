import type { Metadata } from 'next';
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>{children}</AuthProvider>
          <CookieConsent />
          <SWRegistration />
        </ThemeProvider>
      </body>
    </html>
  );
}
