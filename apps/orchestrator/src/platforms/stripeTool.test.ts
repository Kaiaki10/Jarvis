import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db.js";
import { saveConnection, recordTestResult, listConnections } from "../db/connectionsRepo.js";
import { buildPlatformToolset } from "./actions.js";

/**
 * Whether Stripe contributed tools to this session.
 *
 * Asserted through the capability summary rather than by reaching into the MCP
 * server: `buildPlatformToolset` records a platform's name only *after* its
 * builder has pushed its tools, so a name in the summary is proof the builder
 * ran. See walletTool.test.ts for the precedent.
 */
function stripeToolsPresent(): boolean {
  return buildPlatformToolset().capabilitySummary.includes("Stripe");
}

function connectStripe(passedTest: boolean) {
  const connection = saveConnection("stripe", {
    secretKey: "rk_test_abc",
    publishableKey: "pk_test_abc",
    cardholderId: "ich_test_abc",
  });
  recordTestResult(connection.id, passedTest, null, null);
}

describe("the payment link tool", () => {
  beforeEach(() => {
    for (const connection of listConnections()) {
      db.prepare("DELETE FROM connections WHERE id = ?").run(connection.id);
    }
  });

  it("does not exist at all until Stripe is connected", () => {
    expect(stripeToolsPresent()).toBe(false);
  });

  it("does not exist for Stripe credentials that failed their test", () => {
    connectStripe(false);
    expect(stripeToolsPresent()).toBe(false);
  });

  it("appears once Stripe is connected", () => {
    connectStripe(true);
    expect(stripeToolsPresent()).toBe(true);
  });

  it("is never auto-approved, so issuing a link always asks first", () => {
    connectStripe(true);
    const toolset = buildPlatformToolset();
    for (const name of toolset.autoAllowTools) {
      expect(name).toMatch(/list_available_images/);
    }
    expect(toolset.autoAllowTools).not.toContain("mcp__jarvis__create_payment_link");
  });
});
