import withPWA from '@opensourceframework/next-pwa';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@dripl/common',
    '@dripl/element',
    '@dripl/math',
    '@dripl/dripl',
    '@dripl/utils',
  ],
  serverExternalPackages: ['@prisma/client', '@dripl/db'],
};

export default withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  scope: '/',
  sw: 'service-worker.js',
})(nextConfig);
