import type { NextConfig } from "next";

// Server-side env: where the web app proxies /api/* to (the passe•trou API).
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8477";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_INTERNAL_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
