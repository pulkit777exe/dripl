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

// Validate server-side env at build/startup
const REQUIRED_SERVER_ENV = ['DATABASE_URL', 'JWT_SECRET'];

if (process.env.NODE_ENV === 'production') {
  for (const key of REQUIRED_SERVER_ENV) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
}

export default nextConfig;