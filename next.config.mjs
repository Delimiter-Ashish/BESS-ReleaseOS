/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app uses no image optimization; keep this unauthenticated processing endpoint disabled.
  images: { unoptimized: true },
  webpack: (config) => {
    // pdf.js (client-side evidence viewer) optionally requires node-canvas; never needed in the browser.
    config.resolve.alias = { ...(config.resolve.alias ?? {}), canvas: false };
    return config;
  },
};

export default nextConfig;
