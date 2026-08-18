import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the recovery dashboard keep its own immutable build while the
  // production `.next` directory remains pointed at the production API.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
