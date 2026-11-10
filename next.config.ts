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
  serverExternalPackages: ['unpdf', '@xenova/transformers', 'bcryptjs'],
  outputFileTracingExcludes: {
    '*': [
      './storage/**',
      './storage/**/*',
      './node_modules/onnxruntime-node/bin/napi-v3/win32/**',
      './node_modules/onnxruntime-node/bin/napi-v3/darwin/**',
      './node_modules/@napi-rs/**',
    ],
  },
}

export default nextConfig
