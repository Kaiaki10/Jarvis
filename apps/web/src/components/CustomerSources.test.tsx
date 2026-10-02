import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CustomerRecord } from "@jarvis/shared";
import { CustomerSources, referrerHost } from "./CustomerSources";

function customer(patch: Partial<CustomerRecord> & { id: string }): CustomerRecord {
  return {
    agentId: null, name: patch.id, email: null, company: null, notes: null,
    acquisitionChannel: null, utmSource: null, utmMedium: null, utmCampaign: null, referrer: null,
    revenueMinor: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    ...patch,
  };
}

describe("CustomerSources", () => {
  it("ranks channels by revenue and keeps unknown last", () => {
    render(<CustomerSources customers={[
      customer({ id: "a", acquisitionChannel: null, revenueMinor: 90_000 }),
      customer({ id: "b", acquisitionChannel: "x", revenueMinor: 4_900 }),
      customer({ id: "c", acquisitionChannel: "x" }),
      customer({ id: "d", acquisitionChannel: "search", revenueMinor: 12_000 }),
    ]} />);
    const rows = within(screen.getByRole("list", { name: "Customers by source" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Search1 customer$120",
      "X2 customers$49",
      "Unknown1 customer$900",
    ]);
  });

  it("leaves revenue out when nobody has paid yet", () => {
    render(<CustomerSources customers={[customer({ id: "a", acquisitionChannel: "direct" })]} />);
    expect(screen.getByRole("listitem").textContent).toBe("Direct1 customer");
  });

  it("shows an empty state with a way forward", () => {
    render(<CustomerSources customers={[]} />);
    expect(screen.getByText("No customers to attribute yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect a channel" }).getAttribute("href")).toBe("/under-the-hood/connections");
  });
});

describe("referrerHost", () => {
  it("shows a bare host and ignores anything that is not a URL", () => {
    expect(referrerHost("https://www.google.com/search?q=x")).toBe("google.com");
    expect(referrerHost("javascript:alert(1)")).toBeNull();
    expect(referrerHost("not a url")).toBeNull();
    expect(referrerHost(null)).toBeNull();
  });
});
