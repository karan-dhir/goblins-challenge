/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@goblins/shared"],
  // Whiteboard PNGs arrive as data URLs in JSON bodies; allow larger payloads.
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
}
module.exports = nextConfig
