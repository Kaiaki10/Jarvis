import type { NextConfig } from "next";

/**
 * Old top-level routes, kept alive after the Under the Hood split so bookmarks,
 * notification deep links, and anything else holding an old URL still land.
 * Permanent because the move is intended to be permanent — see
 * UNDER_THE_HOOD_PLAN.md.
 */
const MOVED_ROUTES: Array<[from: string, to: string]> = [
  ["/connections", "/under-the-hood/connections"],
  ["/automations", "/under-the-hood/automations"],
  ["/settings", "/under-the-hood/settings"],
  ["/memory", "/under-the-hood/brain/memory"],
  ["/agents", "/under-the-hood/brain/agents"],
  ["/evolution", "/under-the-hood/brain/evolution"],
  ["/sessions", "/under-the-hood/brain/runs"],
  ["/campaigns", "/under-the-hood/workflows"],
];

const nextConfig: NextConfig = {
  // Lets the recovery dashboard keep its own immutable build while the
  // production `.next` directory remains pointed at the production API.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return MOVED_ROUTES.flatMap(([source, destination]) => [
      { source, destination, permanent: true },
      // Carries the dynamic children too: /sessions/:id, /connections/:platformId.
      { source: `${source}/:path*`, destination: `${destination}/:path*`, permanent: true },
    ]);
  },
};

export default nextConfig;
