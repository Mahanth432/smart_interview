import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', '@xenova/transformers', 'bcryptjs'],
}

export default nextConfig
