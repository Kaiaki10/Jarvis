"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { featureHref, moduleForPath } from "@/lib/underTheHood";

/**
 * Sub-navigation for whichever module is open.
 *
 * Renders nothing for single-page modules — a tab strip with one tab is noise,
 * and Connections and Settings are exactly that until they grow features.
 */
export function UnderTheHoodNav() {
  const pathname = usePathname();
  const module = moduleForPath(pathname);
  if (!module || module.features.length === 0) return null;

  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b border-border px-8 pb-3"
      aria-label={`${module.label} sections`}
    >
      {module.features.map((feature) => {
        const href = featureHref(module, feature);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={feature.slug}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-label transition-colors ${
              active
                ? "bg-accent/10 text-foreground ring-1 ring-inset ring-accent/30"
                : "text-muted hover:bg-white/[0.06] hover:text-foreground"
            }`}
          >
            {feature.label}
          </Link>
        );
      })}
    </nav>
  );
}
