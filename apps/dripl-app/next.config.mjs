/** @type {import('next').NextConfig} */
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig = {
  transpilePackages: [
    "@dripl/common",
    "@dripl/element",
    "@dripl/math",
    "@dripl/dripl",
    "@dripl/utils"
  ],
  serverExternalPackages: ['@prisma/client', '@dripl/db'],
  experimental: {
    turbopack: {
      root: path.resolve(__dirname, '../..'),
    },
  },
};

export default nextConfig;
