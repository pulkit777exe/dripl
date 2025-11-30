/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@dripl/common",
    "@dripl/element",
    "@dripl/math",
    "@dripl/state",
    "@dripl/storage",
    "@dripl/sync",
    "@dripl/utils"
  ],
  serverExternalPackages: ['@prisma/client', '@dripl/database']
};

module.exports = nextConfig;
