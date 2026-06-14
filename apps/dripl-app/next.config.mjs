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
  transpilePackages: [
    '@dripl/common',
    '@dripl/element',
    '@dripl/math',
    '@dripl/dripl',
    '@dripl/utils',
  ],
  serverExternalPackages: ['@prisma/client', '@dripl/db'],
};

export default nextConfig;