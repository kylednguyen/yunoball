import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // nflverse player headshots
    remotePatterns: [{ protocol: "https", hostname: "static.www.nfl.com" }],
  },
};

export default nextConfig;
