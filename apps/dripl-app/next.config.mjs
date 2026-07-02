import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
  transpilePackages: ['@dripl/common', '@dripl/element', '@dripl/math', '@dripl/utils'],
  serverExternalPackages: ['@prisma/client', '@dripl/db'],
};

export default withSentryConfig(nextConfig, {
  org: "personal-2ao",
  project: "dripl",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: true,
});
