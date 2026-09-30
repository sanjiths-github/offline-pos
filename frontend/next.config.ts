import type { NextConfig } from 'next';
const development = process.env.NODE_ENV === 'development';
const nextConfig: NextConfig = {
  ...(development ? {} : { output: 'export' as const }),
  images: { unoptimized: true },
  assetPrefix: './',
  ...(development ? {
    async rewrites() { return [{ source: '/api/:path*', destination: 'http://127.0.0.1:5000/api/:path*' }]; }
  } : {})
};
export default nextConfig;
