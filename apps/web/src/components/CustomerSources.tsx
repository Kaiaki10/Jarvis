"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import type { AcquisitionChannel, CustomerRecord } from "@jarvis/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export const ACQUISITION_LABELS: Record<Exclude<AcquisitionChannel, null>, string> = {
  website: "Website",
  email: "Email",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  search: "Search",
  referral: "Referral",
  direct: "Direct",
};

/** Host of a referrer URL for display. Text only, never rendered as a link: it comes from a public endpoint. */
export function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Customer revenue carries no currency of its own; Stripe receipts default to USD. */
function formatRevenue(minor: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

interface SourceRow {
  channel: AcquisitionChannel;
  customers: number;
  revenueMinor: number;
}

/**
 * Where customers came from, by first touch, with the revenue they brought.
 * Unattributed customers stay in the list as "Unknown" so the attributed rows
 * never look like the whole picture.
 */
export function CustomerSources({ customers }: { customers: CustomerRecord[] }) {
  const { rows, totalRevenue, maxCustomers } = useMemo(() => {
    const byChannel = new Map<AcquisitionChannel, SourceRow>();
    for (const customer of customers) {
      const row = byChannel.get(customer.acquisitionChannel) ?? { channel: customer.acquisitionChannel, customers: 0, revenueMinor: 0 };
      row.customers += 1;
      row.revenueMinor += customer.revenueMinor ?? 0;
      byChannel.set(customer.acquisitionChannel, row);
    }
    const rows = [...byChannel.values()].sort((a, b) => {
      // Unknown always sits last, whatever its size.
      if ((a.channel === null) !== (b.channel === null)) return a.channel === null ? 1 : -1;
      return b.revenueMinor - a.revenueMinor || b.customers - a.customers;
    });
    return {
      rows,
      totalRevenue: rows.reduce((sum, row) => sum + row.revenueMinor, 0),
      maxCustomers: Math.max(1, ...rows.map((row) => row.customers)),
    };
  }, [customers]);

  return (
    <Card elevation={1}>
      <CardHeader
        title="Where customers come from"
        description="First touch: UTM tags, then the referring site, then the platform they messaged on"
        icon={<Compass className="h-4 w-4" strokeWidth={1.75} />}
      />
      <CardBody>
        {rows.length === 0 ? (
          <div className="flex items-center gap-2.5 py-1 text-body text-muted">
            <Compass className="h-4 w-4" strokeWidth={1.75} />
            No customers to attribute yet.
            <Link href="/under-the-hood/connections" className="text-foreground hover:underline">
              Connect a channel
            </Link>
          </div>
        ) : (
          <ul className="space-y-2.5" aria-label="Customers by source">
            {rows.map((row) => (
              <li key={row.channel ?? "unknown"} className="grid grid-cols-[minmax(5.5rem,8rem)_1fr_auto] items-center gap-3">
                <span className={`truncate text-label ${row.channel ? "text-foreground" : "text-muted"}`}>
                  {row.channel ? ACQUISITION_LABELS[row.channel] : "Unknown"}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-white/[0.045]" aria-hidden>
                  <span
                    className={`block h-full rounded-full ${row.channel ? "bg-accent" : "bg-border-strong"}`}
                    style={{ width: `${(row.customers / maxCustomers) * 100}%` }}
                  />
                </span>
                <span className="text-right text-label tabular-nums text-foreground-secondary">
                  {row.customers} {row.customers === 1 ? "customer" : "customers"}
                  {totalRevenue > 0 && <span className="ml-2 text-muted">{formatRevenue(row.revenueMinor)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
