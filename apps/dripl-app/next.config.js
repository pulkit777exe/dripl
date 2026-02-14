/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@dripl/common",
    "@dripl/element",
    "@dripl/math",
    "@dripl/dripl",
    "@dripl/utils"
  ],
  serverExternalPackages: ['@prisma/client', '@dripl/db']
};

module.exports = nextConfig;
